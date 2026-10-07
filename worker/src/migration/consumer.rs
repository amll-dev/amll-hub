use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use serde::Deserialize;
use tracing::{info, warn};

use crate::app::AppState;
use crate::config::{CasdoorConfig, MIGRATION_CLOSE_ROUTING, MIGRATION_EXCHANGE};
use crate::infra::casdoor::CasdoorClient;
use crate::infra::github_app::GithubAppClient;
use crate::infra::rabbitmq;
use crate::migration::github_api::{GithubApi, extract_body_authors};
use crate::migration::mapper;
use crate::migration::store::{
    CommentInsert, FileHistoryInsert, MigrationStore, ReviewHistoryInsert, SubmissionInsert,
};

/// 待审核 TTML 对象存储前缀（与 backend file_service.go 约定一致）
const PENDING_PREFIX: &str = "tg-lyrics/";
/// 已通过 TTML 对象存储前缀
const APPROVED_PREFIX: &str = "shtg-lyrics/";
/// TTML 对象存储 content-type
const TTML_CONTENT_TYPE: &str = "application/ttml+xml";
/// 关闭 PR：每批数量与批间隔
const CLOSE_BATCH_SIZE: usize = 50;
const CLOSE_BATCH_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Debug, Deserialize)]
struct MigrationUserMessage {
    task_id: i64,
    username: String,
    #[serde(default)]
    submitter_info: SubmitterInfo,
    github_login: String,
    #[serde(default)]
    since_pr_number: i64,
}

#[derive(Debug, Deserialize, Default, Clone)]
struct SubmitterInfo {
    #[serde(default)]
    username: String,
    #[serde(default, rename = "displayName")]
    display_name: String,
    #[serde(default)]
    avatar: String,
}

impl SubmitterInfo {
    /// 转换为站点 UserInfo JSON（字段缺失时用站点 username 兜底）
    fn to_json(&self, fallback: &str) -> serde_json::Value {
        let username = if self.username.is_empty() {
            fallback.to_string()
        } else {
            self.username.clone()
        };
        let display_name = if self.display_name.is_empty() {
            username.clone()
        } else {
            self.display_name.clone()
        };
        serde_json::json!({
            "username": username,
            "displayName": display_name,
            "avatar": self.avatar,
        })
    }
}

#[derive(Debug, Deserialize)]
struct ClosePrMessage {
    task_id: i64,
    username: String,
}

/// 单条 PR 处理结果
enum Outcome {
    Created,
    Skipped,
}

/// 解析后的身份：站点用户名 + UserInfo
#[derive(Clone)]
struct ResolvedIdentity {
    username: String,
    info: serde_json::Value,
}

impl ResolvedIdentity {
    /// 未绑定 hub 用户时保持 GitHub 原样
    fn raw(login: &str) -> Self {
        let login = login.trim();
        Self {
            username: login.to_string(),
            info: mapper::user_info(login, None),
        }
    }
}

/// GitHub login → 站点用户身份的解析器
struct LoginResolver {
    store: MigrationStore,
    casdoor: Option<CasdoorClient>,
    organization: String,
    cache: HashMap<String, ResolvedIdentity>,
}

impl LoginResolver {
    fn new(store: MigrationStore, cfg: &CasdoorConfig) -> Self {
        let casdoor = if cfg.enabled() {
            match CasdoorClient::new(cfg.clone()) {
                Ok(client) => Some(client),
                Err(e) => {
                    warn!(error = %e, "Casdoor 客户端初始化失败，回退为 GitHub 原始信息");
                    None
                }
            }
        } else {
            warn!("Casdoor 未配置（CASDOOR_ENDPOINT/CLIENT_ID/CLIENT_SECRET/ORGANIZATION），回退为 GitHub 原始信息");
            None
        };
        Self {
            store,
            casdoor,
            organization: cfg.organization.clone(),
            cache: HashMap::new(),
        }
    }

    /// 预热一批 GitHub login（结果进缓存；查询失败静默降级为 GitHub 原样）
    async fn warm(&mut self, logins: &[String]) {
        let mut wanted: Vec<String> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        for login in logins {
            let key = login.trim().to_ascii_lowercase();
            if key.is_empty() || self.cache.contains_key(&key) || !seen.insert(key.clone()) {
                continue;
            }
            wanted.push(key);
        }
        if wanted.is_empty() {
            return;
        }

        let bindings = match self.store.find_bindings(&wanted).await {
            Ok(rows) => rows,
            Err(e) => {
                warn!(error = %e, "查询 GitHub 绑定失败，回退为 GitHub 原始信息");
                return;
            }
        };

        let mut resolved: Vec<(String, ResolvedIdentity)> = Vec::with_capacity(bindings.len());
        for row in bindings {
            let identity = self.hub_identity(&row.username).await;
            resolved.push((row.github_login.trim().to_ascii_lowercase(), identity));
        }
        for (key, identity) in resolved {
            self.cache.insert(key, identity);
        }
    }

    /// 取某 GitHub login 对应的站点身份；未绑定 hub 用户时保持 GitHub 原样
    fn lookup(&self, login: &str) -> ResolvedIdentity {
        let trimmed = login.trim();
        self.cache
            .get(&trimmed.to_ascii_lowercase())
            .cloned()
            .unwrap_or_else(|| ResolvedIdentity::raw(trimmed))
    }

    /// UserInfo JSON（写库用）
    fn get(&self, login: &str) -> serde_json::Value {
        self.lookup(login).info
    }

    /// 站点用户名（写库用）
    fn username(&self, login: &str) -> String {
        self.lookup(login).username
    }

    /// 用 hub username 查 Casdoor，得到展示名与头像
    async fn hub_identity(&self, username: &str) -> ResolvedIdentity {
        let info = match self.casdoor.as_ref() {
            None => mapper::hub_user_info(username, username, ""),
            Some(casdoor) => match casdoor.get_user(&self.organization, username).await {
                Ok(Some(user)) => {
                    let display = if user.display_name.trim().is_empty() {
                        user.name.as_str()
                    } else {
                        user.display_name.as_str()
                    };
                    mapper::hub_user_info(username, display, user.avatar.trim())
                }
                Ok(None) => mapper::hub_user_info(username, username, ""),
                Err(e) => {
                    warn!(username, error = %e, "查询 Casdoor 用户失败，仅替换用户名");
                    mapper::hub_user_info(username, username, "")
                }
            },
        };
        ResolvedIdentity {
            username: username.to_string(),
            info,
        }
    }
}

// ===== migration.user 消费者 =====

pub async fn consume_user_loop(
    channel: lapin::Channel,
    publish_channel: lapin::Channel,
    queue: String,
    app: Arc<AppState>,
    github_app: Arc<GithubAppClient>,
    shutdown: Arc<tokio::sync::Notify>,
) -> Result<()> {
    rabbitmq::consume_loop(
        channel,
        queue,
        "ttml-migration-worker",
        shutdown,
        move |delivery| {
            let app = app.clone();
            let github_app = github_app.clone();
            let publish_channel = publish_channel.clone();
            async move { handle_user_message(delivery, &app, &github_app, &publish_channel).await }
        },
    )
    .await
}

async fn handle_user_message(
    delivery: lapin::message::Delivery,
    app: &Arc<AppState>,
    github_app: &Arc<GithubAppClient>,
    publish_channel: &lapin::Channel,
) -> Result<()> {
    let msg: MigrationUserMessage =
        serde_json::from_slice(&delivery.data).context("解析 migration.user 消息失败")?;

    info!(
        task_id = msg.task_id,
        username = %msg.username,
        github_login = %msg.github_login,
        "开始处理迁移任务"
    );

    let store = MigrationStore::new(app.db.clone());
    match run_user_task(&msg, app, github_app).await {
        Ok(()) => {
            // 自动关闭 PR 功能默认关闭（MIGRATION_CLOSE_PR_ENABLED=true 可重新开启）
            if app.cfg.migration.close_pr_enabled {
                if let Err(e) = publish_close_pr(publish_channel, &msg).await {
                    warn!(error = %e, task_id = msg.task_id, "投递 migration.close_pr 失败（可稍后重试）");
                }
            } else {
                info!(task_id = msg.task_id, "自动关闭 PR 已禁用，跳过 migration.close_pr");
            }
            Ok(())
        }
        Err(e) => {
            let message = format!("{:#}", e);
            warn!(error = %message, task_id = msg.task_id, "迁移任务失败");
            if let Err(err) = store.mark_failed(msg.task_id, &message).await {
                warn!(error = %err, "标记迁移任务失败状态时出错");
            }
            Err(e)
        }
    }
}

/// 执行一次用户迁移（支持基于 cursor 的断点续传）
async fn run_user_task(
    msg: &MigrationUserMessage,
    app: &Arc<AppState>,
    github_app: &Arc<GithubAppClient>,
) -> Result<()> {
    let store = MigrationStore::new(app.db.clone());
    let task = store
        .get_task(msg.task_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("迁移任务不存在: {}", msg.task_id))?;

    let since = if msg.since_pr_number > 0 {
        msg.since_pr_number
    } else {
        app.cfg.migration.start_pr_number
    };

    // 断点续传：cursor 记录上一条已处理的 PR 号，续传时只处理 < cursor 的部分
    let resume_below = task.cursor.as_ref().and_then(|c| c.parse::<i64>().ok());
    let mut processed = task.processed_prs;
    let mut created = task.created_count;
    let mut skipped = task.skipped_count;
    let mut failed = task.failed_count;

    store.mark_running(msg.task_id).await?;

    let api = GithubApi::new(
        app.http_client_long.clone(),
        github_app.clone(),
        app.cfg.github.repo.clone(),
        app.cfg.github.token.clone(),
        app.cfg.migration.concurrency,
    );

    // 1. 发现该用户的 PR：来源 A（直接投稿）+ 来源 B（bot 代提交）
    let direct = api
        .search_pr_numbers_by_author(&msg.github_login, since)
        .await
        .context("搜索直接投稿 PR 失败")?;
    let bot = api
        .search_bot_pr_numbers(&msg.github_login, since)
        .await
        .context("搜索 bot 代提交 PR 失败")?;

    let direct_count = direct.len();
    let mut numbers = direct;
    let mut seen: std::collections::HashSet<i64> = numbers.iter().copied().collect();
    for number in bot {
        if seen.insert(number) {
            numbers.push(number);
        }
    }

    // 按 PR 号倒序处理，并应用断点续传过滤
    numbers.sort_unstable_by(|a, b| b.cmp(a));
    numbers.dedup();
    if let Some(cursor) = resume_below {
        numbers.retain(|n| *n < cursor);
    }

    info!(
        task_id = msg.task_id,
        direct = direct_count,
        total = numbers.len(),
        resume_below = ?resume_below,
        "PR 发现完成"
    );

    store
        .set_total(msg.task_id, processed + numbers.len() as i32)
        .await?;

    let flush_every = app.cfg.migration.batch_size.max(1);

    // GitHub login → 站点用户信息解析器（整轮任务复用缓存）
    let mut resolver = LoginResolver::new(store.clone(), &app.cfg.casdoor);

    for (idx, number) in numbers.iter().enumerate() {
        let cursor = number.to_string();
        match process_one_pr(&api, app, &store, msg, *number, &mut resolver).await {
            Ok(Outcome::Created) => created += 1,
            Ok(Outcome::Skipped) => skipped += 1,
            Err(e) => {
                failed += 1;
                warn!(
                    task_id = msg.task_id,
                    pr_number = number,
                    error = %format!("{:#}", e),
                    "单条 PR 迁移失败，继续处理"
                );
            }
        }
        processed += 1;

        if (idx + 1) % flush_every == 0 {
            store
                .update_progress(
                    msg.task_id,
                    processed,
                    created,
                    skipped,
                    failed,
                    Some(&cursor),
                )
                .await?;
        }
    }

    store
        .mark_completed(msg.task_id, processed, created, skipped, failed)
        .await?;

    info!(
        task_id = msg.task_id,
        processed, created, skipped, failed, "迁移任务完成"
    );
    Ok(())
}

/// 投递 migration.close_pr
async fn publish_close_pr(channel: &lapin::Channel, msg: &MigrationUserMessage) -> Result<()> {
    let payload = serde_json::json!({
        "task_id": msg.task_id,
        "username": msg.username,
        "github_login": msg.github_login,
    });
    let body = serde_json::to_vec(&payload).context("序列化 migration.close_pr 消息失败")?;
    rabbitmq::publish_json(
        channel,
        MIGRATION_EXCHANGE,
        MIGRATION_CLOSE_ROUTING,
        &body,
        &format!("migration.close_pr:{}", msg.task_id),
    )
    .await
}

/// 单条 PR → 站点投稿
async fn process_one_pr(
    api: &GithubApi,
    app: &Arc<AppState>,
    store: &MigrationStore,
    msg: &MigrationUserMessage,
    number: i64,
    resolver: &mut LoginResolver,
) -> Result<Outcome> {
    // 2. 去重：命中已迁移记录直接跳过
    if store.has_migrated_pr(number).await? {
        return Ok(Outcome::Skipped);
    }

    let pr = api.get_pr(number).await?;

    // 定位并下载 TTML
    let files = api.list_pr_files(number).await?;
    let (path, file_name) = mapper::find_ttml_file(&files)
        .ok_or_else(|| anyhow::anyhow!("PR #{} 未找到 raw-lyrics/*.ttml 文件", number))?;
    let bytes = api.download_file(&path, &pr.head_sha).await?;
    let meta = mapper::parse_ttml_meta(&bytes)?;

    // 审核过程（缺失时降级处理，不阻断迁移）
    let timeline = api.list_timeline(number).await.unwrap_or_else(|e| {
        warn!(pr_number = number, error = %e, "拉取 timeline 失败，按无 timeline 处理");
        Vec::new()
    });
    let reviews = api.list_pr_reviews(number).await.unwrap_or_else(|e| {
        warn!(pr_number = number, error = %e, "拉取 reviews 失败，按无 review 处理");
        Vec::new()
    });
    let comments = api.list_issue_comments(number).await.unwrap_or_else(|e| {
        warn!(pr_number = number, error = %e, "拉取评论失败，按无评论处理");
        Vec::new()
    });

    let mapping = mapper::map_status(&pr, &timeline, &reviews);

    // 3. 上传 TTML：待审核区；approved 额外复制到已通过区
    let bucket = app.cfg.minio.bucket.clone();
    let pending_key = format!("{}{}", PENDING_PREFIX, file_name);
    crate::sync::downloader::upload_to_minio(
        &app.s3,
        &bucket,
        &pending_key,
        &bytes,
        TTML_CONTENT_TYPE,
    )
    .await
    .with_context(|| format!("上传 {} 到 MinIO 失败", pending_key))?;

    if mapping.status == mapper::STATUS_APPROVED {
        let approved_key = format!("{}{}", APPROVED_PREFIX, file_name);
        crate::sync::downloader::upload_to_minio(
            &app.s3,
            &bucket,
            &approved_key,
            &bytes,
            TTML_CONTENT_TYPE,
        )
        .await
        .with_context(|| format!("上传 {} 到 MinIO 失败", approved_key))?;
    }

    // 4. bot 代提交 PR 的归属标注（用于溯源）
    let body_author = pr
        .body
        .as_deref()
        .and_then(|body| {
            extract_body_authors(body)
                .into_iter()
                .find(|a| a.eq_ignore_ascii_case(&msg.github_login))
        })
        .unwrap_or_default();

    let now = chrono::Utc::now();
    let pr_state = if pr.merged {
        "merged".to_string()
    } else {
        pr.state.clone()
    };
    let metadata = serde_json::json!({
        "source": "github_migration",
        "github_pr_number": pr.number,
        "github_pr_title": pr.title,
        "github_pr_url": pr.url,
        "github_pr_author": pr.author_login,
        "github_pr_body_author": body_author,
        "github_pr_state": pr_state,
        "merged_at": pr.merged_at.map(|t| t.to_rfc3339()),
        "labels": pr.labels,
        "ttml_author_github": meta.ttml_author_github,
        "migrated_at": now.to_rfc3339(),
        "data_cutoff_at": now.to_rfc3339(),
    });

    // 5. 审核历史：逐条 review + 最终结论
    let mut logins: Vec<String> = Vec::new();
    for review in &reviews {
        let login = review.reviewer();
        if !login.is_empty() {
            logins.push(login.to_string());
        }
    }
    for comment in &comments {
        if let Some(user) = comment.user.as_ref() {
            logins.push(user.login.clone());
        }
    }
    logins.push(pr.author_login.clone());
    logins.push(body_author.clone());
    if let Some(login) = mapping.reviewer.as_ref() {
        logins.push(login.clone());
    }
    if let Some(login) = mapping.closed_by.as_ref() {
        logins.push(login.clone());
    }
    resolver.warm(&logins).await;

    let mut histories: Vec<ReviewHistoryInsert> = Vec::new();
    for review in &reviews {
        let reviewer = review.reviewer();
        let submitted_at = review.submitted_at;
        if reviewer.is_empty() || submitted_at.is_none() {
            continue;
        }
        let status = if review.state.eq_ignore_ascii_case("APPROVED") {
            mapper::STATUS_APPROVED
        } else if review.state.eq_ignore_ascii_case("CHANGES_REQUESTED") {
            mapper::STATUS_NEED_REVISION
        } else {
            continue;
        };
        histories.push(ReviewHistoryInsert {
            reviewer: resolver.username(reviewer),
            reviewer_info: resolver.get(reviewer),
            status: status.to_string(),
            comment: review.body.trim().to_string(),
            reviewed_at: submitted_at.expect("submitted_at checked"),
        });
    }
    if let Some(conclusion) = build_conclusion(&mapping, &pr, &histories, resolver) {
        histories.push(conclusion);
    }

    // 6. 评论：PR issue 评论 + review 正文
    let mut comments_insert: Vec<CommentInsert> = comments
        .iter()
        .filter(|c| !c.body.trim().is_empty())
        .map(|c| {
            let login = c.user.as_ref().map(|u| u.login.clone()).unwrap_or_default();
            CommentInsert {
                author: resolver.get(&login),
                content: c.body.clone(),
                created_at: c.created_at.unwrap_or(pr.created_at),
            }
        })
        .collect();
    for review in &reviews {
        let body = review.body.trim();
        let reviewer = review.reviewer();
        if body.is_empty() || reviewer.is_empty() {
            continue;
        }
        comments_insert.push(CommentInsert {
            author: resolver.get(reviewer),
            content: body.to_string(),
            created_at: review.submitted_at.unwrap_or(pr.created_at),
        });
    }

    // 7. 文件更新历史（PR 创建即提交该 TTML）
    let file_uploader = if body_author.is_empty() {
        pr.author_login.clone()
    } else {
        body_author
    };
    let file_history = if file_uploader.is_empty() {
        None
    } else {
        Some(FileHistoryInsert {
            uploader: resolver.username(&file_uploader),
            uploader_info: resolver.get(&file_uploader),
            file_name: file_name.clone(),
            uploaded_at: pr.created_at,
        })
    };

    let closed_by = mapping
        .closed_by
        .as_ref()
        .map(|login| resolver.username(login));
    let closed_by_info = mapping.closed_by.as_ref().map(|login| resolver.get(login));
    let reviewer = mapping
        .reviewer
        .as_ref()
        .map(|login| resolver.username(login));

    let data = SubmissionInsert {
        pr_number: pr.number,
        username: msg.username.clone(),
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        ncm_id: meta.ncm_id,
        qq_id: meta.qq_id,
        am_id: meta.am_id,
        spotify_id: meta.spotify_id,
        file_name,
        tags: serde_json::json!(pr.labels),
        metadata,
        language: meta.language,
        languages: serde_json::json!(meta.languages),
        status: mapping.status.clone(),
        submitter: msg.username.clone(),
        submitter_info: msg.submitter_info.to_json(&msg.username),
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        revision_requested_at: mapping.revision_requested_at,
        closed_at: mapping.closed_at,
        closed_by,
        closed_by_info,
        reviewer,
        reviewed_at: mapping.reviewed_at,
        review_comment: mapping.review_comment.clone(),
        reviews: histories,
        comments: comments_insert,
        file_history,
    };

    match store.insert_submission(&data).await? {
        Some(_) => Ok(Outcome::Created),
        None => Ok(Outcome::Skipped),
    }
}

/// 构造 PR 最终结论对应的审核历史（已有同状态记录时不重复写）
fn build_conclusion(
    mapping: &mapper::StatusMapping,
    pr: &crate::migration::github_api::PrInfo,
    existing: &[ReviewHistoryInsert],
    resolver: &LoginResolver,
) -> Option<ReviewHistoryInsert> {
    if mapping.status == mapper::STATUS_PENDING {
        return None;
    }
    if existing
        .iter()
        .any(|h| h.status == mapping.status && h.comment == mapping.review_comment.clone().unwrap_or_default())
    {
        return None;
    }

    let reviewer = mapping
        .reviewer
        .clone()
        .or_else(|| mapping.closed_by.clone())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| pr.author_login.clone());
    if reviewer.is_empty() {
        return None;
    }

    Some(ReviewHistoryInsert {
        reviewer: resolver.username(&reviewer),
        reviewer_info: resolver.get(&reviewer),
        status: mapping.status.clone(),
        comment: mapping.review_comment.clone().unwrap_or_default(),
        reviewed_at: mapping
            .reviewed_at
            .or(mapping.closed_at)
            .or(mapping.revision_requested_at)
            .unwrap_or(pr.updated_at),
    })
}

// ===== migration.close_pr 消费者 =====

pub async fn consume_close_pr_loop(
    channel: lapin::Channel,
    queue: String,
    app: Arc<AppState>,
    github_app: Arc<GithubAppClient>,
    shutdown: Arc<tokio::sync::Notify>,
) -> Result<()> {
    rabbitmq::consume_loop(
        channel,
        queue,
        "ttml-migration-close-worker",
        shutdown,
        move |delivery| {
            let app = app.clone();
            let github_app = github_app.clone();
            async move { handle_close_message(delivery, &app, &github_app).await }
        },
    )
    .await
}

async fn handle_close_message(
    delivery: lapin::message::Delivery,
    app: &Arc<AppState>,
    github_app: &Arc<GithubAppClient>,
) -> Result<()> {
    let msg: ClosePrMessage =
        serde_json::from_slice(&delivery.data).context("解析 migration.close_pr 消息失败")?;

    let store = MigrationStore::new(app.db.clone());
    let task = store
        .get_task(msg.task_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("迁移任务不存在: {}", msg.task_id))?;

    // 幂等：已完成则直接跳过
    if task.close_pr_status == "completed" {
        info!(task_id = msg.task_id, "关闭 PR 已完成，跳过");
        return Ok(());
    }

    store.mark_close_running(msg.task_id).await?;

    let api = GithubApi::new(
        app.http_client_long.clone(),
        github_app.clone(),
        app.cfg.github.repo.clone(),
        app.cfg.github.token.clone(),
        app.cfg.migration.concurrency,
    );

    let prs = store
        .list_migrated_prs(&msg.username, app.cfg.migration.start_pr_number)
        .await?;

    let site_url = app.cfg.migration.site_url.trim_end_matches('/').to_string();
    let mut closed = 0usize;
    let mut failed = 0usize;

    for chunk in prs.chunks(CLOSE_BATCH_SIZE) {
        for pr in chunk {
            match close_one_pr(&api, pr.number, pr.file_name.as_deref(), &site_url).await {
                Ok(true) => {
                    closed += 1;
                    store.add_closed_count(msg.task_id, 1).await?;
                }
                Ok(false) => {}
                Err(e) => {
                    failed += 1;
                    warn!(
                        task_id = msg.task_id,
                        pr_number = pr.number,
                        error = %format!("{:#}", e),
                        "关闭 PR 失败，继续处理"
                    );
                }
            }
        }
        tokio::time::sleep(CLOSE_BATCH_INTERVAL).await;
    }

    let status = if failed > 0 && closed == 0 {
        "failed"
    } else {
        "completed"
    };
    store.set_close_status(msg.task_id, status).await?;

    info!(task_id = msg.task_id, closed, failed, status, "关闭 PR 阶段完成");
    Ok(())
}

/// 关闭单个 PR 并评论迁移地址；返回是否实际执行了关闭
async fn close_one_pr(
    api: &GithubApi,
    number: i64,
    file_name: Option<&str>,
    site_url: &str,
) -> Result<bool> {
    let pr = api.get_pr(number).await?;
    if pr.state != "open" {
        return Ok(false);
    }

    api.close_pr(number).await?;

    let comment = match file_name {
        Some(name) if !site_url.is_empty() => format!(
            "该投稿已迁移至 amll-hub，请前往 {}/lyric/{} 查看",
            site_url, name
        ),
        _ if !site_url.is_empty() => format!("该投稿已迁移至 amll-hub，请前往 {} 查看", site_url),
        _ => "该投稿已迁移至 amll-hub。".to_string(),
    };
    if let Err(e) = api.create_issue_comment(number, &comment).await {
        warn!(pr_number = number, error = %e, "评论迁移地址失败（PR 已关闭）");
    }
    Ok(true)
}
