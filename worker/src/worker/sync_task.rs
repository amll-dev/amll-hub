use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Arc;

use anyhow::{Context, Result};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tracing::{debug, error, info, warn};

use crate::app::AppState;
use crate::db::repository::{Repository, SongUpsert};
use crate::db::types::SyncSummary;
use crate::search::meilisearch::{self, MeiliDocument};
use crate::storage::redis::SyncLock;
use crate::sync::{
    diff::{self, Diff},
    downloader, github, index_parser, ttml_parser,
};

use super::latest_song_recorder;

/// 取 commit sha 前 7 位（不足 7 位时取全部）
fn short_sha(s: &str) -> &str {
    &s[..7.min(s.len())]
}

/// 同步任务主流程
pub struct SyncTaskRunner {
    app: Arc<AppState>,
}

impl SyncTaskRunner {
    pub fn new(app: Arc<AppState>) -> Self {
        Self { app }
    }

    /// 执行同步
    /// 返回 true 表示跳过（本地已最新），false 表示执行了同步
    pub async fn run(
        &self,
        request_id: &str,
        triggered_by: &str,
        _payload: &serde_json::Value,
    ) -> Result<bool> {
        info!(request_id, triggered_by, "开始执行同步任务");
        let repo = Repository::new(self.app.db.clone());

        // 1. 获取远程 commit（长超时共享 client）
        let http = self.app.http_client_long.clone();
        let remote_commit = github::fetch_latest_commit(&http, &self.app.cfg.github).await?;
        info!(remote_commit = %remote_commit, "获取到远程 commit");

        // 2. 与本地对比
        let local_state = repo.get_sync_state_all().await?;
        debug!(
            last_commit = %local_state.last_synced_commit,
            last_at = %local_state.last_synced_at,
            "本地同步状态"
        );

        if !local_state.last_synced_commit.is_empty()
            && local_state.last_synced_commit == remote_commit
        {
            let local_count = repo.count_songs().await.unwrap_or(0);
            if local_count > 0 {
                info!(
                    commit = short_sha(&remote_commit),
                    songs = local_count,
                    "本地已是最新，跳过同步"
                );
                return Ok(true);
            }
            warn!("commit 一致但本地歌曲数为 0，可能数据丢失，强制同步");
        }
        let is_first_sync = local_state.last_synced_commit.is_empty();
        info!(
            remote_commit = %remote_commit,
            is_first_sync,
            "需要同步"
        );

        // 3. 获取 Redis 锁
        let mut lock = SyncLock::new(
            self.app.redis.clone(),
            "sync_lock",
            request_id,
            self.app.cfg.worker.sync_lock_ttl,
        );
        if !lock.try_acquire().await? {
            warn!(request_id, "同步锁被占用，等待 RabbitMQ 重新投递");
            anyhow::bail!("sync lock busy");
        }

        // 4. 创建同步历史
        let history_id = repo
            .create_sync_history(
                &remote_commit,
                if local_state.last_synced_commit.is_empty() {
                    None
                } else {
                    Some(&local_state.last_synced_commit)
                },
                triggered_by,
            )
            .await?;
        debug!(history_id, "创建同步历史记录成功");

        // 5. 执行同步主流程
        let result = self
            .execute_sync(&http, &repo, history_id, &remote_commit, is_first_sync)
            .await;

        match result {
            Ok(summary) => {
                // 更新 sync_state
                repo.set_sync_state("last_synced_commit", &remote_commit)
                    .await?;
                let now = chrono::Utc::now().to_rfc3339();
                repo.set_sync_state("last_synced_at", &now).await?;
                repo.finish_sync_history(history_id, &summary, None).await?;
                info!(request_id, history_id, "同步完成");
                let _ = lock.release().await;
                // 非首次同步时，记录最新收录歌曲快照
                if !is_first_sync {
                    latest_song_recorder::record_latest_songs(&self.app, &repo, history_id).await;
                }
                Ok(false)
            }
            Err(e) => {
                error!(request_id, history_id, error = %e, "同步失败");
                let msg = e.to_string();
                repo.finish_sync_history(history_id, &SyncSummary::default(), Some(&msg))
                    .await?;
                let _ = lock.release().await;
                Err(e)
            }
        }
    }

    /// 实际同步流程：下载索引 -> diff -> 下载文件 -> 入库 -> 索引
    async fn execute_sync(
        &self,
        http: &reqwest::Client,
        repo: &Repository,
        history_id: i64,
        _target_commit: &str,
        is_first_sync: bool,
    ) -> Result<SyncSummary> {
        // 1. 下载 raw-lyrics-index.jsonl
        let index_url = self.app.cfg.github.raw_url("metadata/raw-lyrics-index.jsonl");
        let text = github::download_raw_text(http, &index_url, &self.app.cfg.github).await?;
        let entries = index_parser::parse_index(&text)?;
        info!("索引解析完成，共 {} 个条目", entries.len());

        // 2. 本地已有 raw 列表
        let local = repo.list_raw_lyric_files().await?;
        debug!("本地已有 {} 个文件", local.len());

        // 3. 计算差异
        let Diff { to_add, to_delete } = diff::compute_diff(entries, local);
        info!(
            "差异计算完成：新增 {}，删除 {}",
            to_add.len(),
            to_delete.len()
        );

        let total = to_add.len();

        // 3.5 空差集短路：无新增文件时跳过下载和处理阶段，
        // 但仍需处理删除（本地有、远程已移除的文件）
        if total == 0 {
            info!("无新增文件，跳过下载和处理阶段");
            let (deleted_count, deleted_meili_ids) = self.process_deletions(repo, &to_delete).await;
            if !deleted_meili_ids.is_empty() {
                self.delete_meili_docs(deleted_meili_ids).await;
            }
            // 仍同步索引文件到 MinIO（jsonl 可能含 metadata 变更）
            // 索引/zip 同步为关键流程，失败则本次同步失败，由上层重试机制重新触发
            sync_index_files(http, &self.app).await?;
            return Ok(SyncSummary {
                added: 0,
                updated: 0,
                deleted: deleted_count,
            });
        }

        let progress_id = repo.create_sync_progress(history_id, total as i32).await?;

        // 4. 待处理列表 = to_add
        let mut all = to_add;

        // 进度状态（无锁 atomic 计数，DB 写入限流）
        let progress_state = Arc::new(ProgressState::new());
        let repo_arc = repo_db_arc(self);
        let progress_id_inner = progress_id;

        // 5. 下载与上传：首次同步或差集超阈值走 zip；否则逐文件，失败降级 zip
        let threshold = self.app.cfg.worker.incremental_threshold;
        let use_zip = is_first_sync || total > threshold;

        info!(
            "开始下载和上传文件，模式: {}, total: {}, threshold: {}",
            if use_zip { "zip" } else { "per-file" },
            total,
            threshold,
        );

        let downloaded = if use_zip {
            if is_first_sync {
                info!("首次同步: 下载 raw-lyrics.zip");
            } else {
                info!("差集 {} > 阈值 {}, 降级为全量 zip 下载", total, threshold);
            }
            let zip_bytes = github::download_zip(http, &self.app.cfg.github).await?;
            debug!(size = zip_bytes.len(), "zip 下载完成");
            downloader::download_and_upload_from_zip(
                self.app.clone(),
                std::mem::take(&mut all),
                zip_bytes,
                make_progress_callback(progress_state.clone(), repo_arc.clone(), progress_id_inner),
                make_failure_callback(progress_state.clone(), repo_arc.clone(), progress_id_inner, "zip extract/upload failed"),
            )
            .await?
        } else {
            info!("增量同步: 逐文件下载 {} 个文件", total);
            let entries_backup = all.clone();
            match downloader::download_and_upload_all(
                self.app.clone(),
                std::mem::take(&mut all),
                make_progress_callback(progress_state.clone(), repo_arc.clone(), progress_id_inner),
                make_failure_callback(progress_state.clone(), repo_arc.clone(), progress_id_inner, "download failed"),
            )
            .await
            {
                Ok(d) => d,
                Err(e) => {
                    warn!("增量同步失败: {}, 降级为全量 zip 下载", e);
                    let zip_bytes = github::download_zip(http, &self.app.cfg.github).await?;
                    debug!(size = zip_bytes.len(), "zip 下载完成");
                    downloader::download_and_upload_from_zip(
                        self.app.clone(),
                        entries_backup,
                        zip_bytes,
                        make_progress_callback(progress_state.clone(), repo_arc.clone(), progress_id_inner),
                        make_failure_callback(progress_state.clone(), repo_arc.clone(), progress_id_inner, "zip extract/upload failed"),
                    )
                    .await?
                }
            }
        };
        info!("下载完成，成功下载 {} 个文件", downloaded.len());

        // 5.5 强制 flush 最终下载进度到 DB（最终刷新直接 await，确保落库）
        let final_failed;
        {
            let final_downloaded = progress_state.downloaded();
            final_failed = progress_state.failed();
            debug!(final_downloaded, final_failed, "flush 最终下载进度");
            run_progress_flush(
                repo_arc.clone(),
                progress_id_inner,
                final_downloaded,
                final_failed,
                None,
            )
            .await;
        }

        // 下载/上传存在失败文件时同步失败（不更新 last_synced_commit），
        // 由消费者层重试；下次同步 diff 会重新包含这些文件，避免静默丢失
        if final_failed > 0 {
            anyhow::bail!("{} 个文件下载/上传失败，本次同步标记失败以待重试", final_failed);
        }

        // 6. 并发解析 + 入库 + 累积 MeiliSearch 文档
        let concurrency = self.app.cfg.worker.concurrency.max(1);
        let mut meili_docs: Vec<MeiliDocument> = Vec::with_capacity(downloaded.len());
        let mut summary = SyncSummary {
            added: 0,
            updated: 0,
            deleted: 0,
        };

        let inner_total = downloaded.len();
        let downloaded_arc = Arc::new(downloaded);
        let semaphore = Arc::new(Semaphore::new(concurrency));
        let mut join_set = JoinSet::new();

        for idx in 0..downloaded_arc.len() {
            let permit = semaphore.clone().acquire_owned().await?;
            let repo_clone = repo.clone();
            let downloaded_clone = downloaded_arc.clone();
            join_set.spawn(async move {
                let _permit = permit;
                let d = &downloaded_clone[idx];
                let result = process_one_with_retry(repo_clone, d).await;
                (idx, result)
            });
        }

        while let Some(res) = join_set.join_next().await {
            let (idx, result) = res?;
            match result {
                Ok((true, doc)) => {
                    summary.added += 1;
                    meili_docs.push(doc);
                }
                Ok((false, doc)) => {
                    summary.updated += 1;
                    meili_docs.push(doc);
                }
                Err(e) => {
                    let d = &downloaded_arc[idx];
                    warn!(
                        file = %d.raw_lyric_file,
                        music_names = ?d.entry.music_names(),
                        platform_mappings = ?d.entry.platform_mappings(),
                        ttml_author = ?d.entry.ttml_author_github_login(),
                        error = %e,
                        "入库最终失败（重试耗尽）",
                    );
                }
            }
            if (idx + 1) % 100 == 0 {
                info!("已入库 {}/{}", idx + 1, inner_total);
            }
        }
        info!(
            "入库完成，新增 {}，更新 {}，失败 {}",
            summary.added,
            summary.updated,
            inner_total - summary.added - summary.updated
        );
        // 7. 写入 MeiliSearch
        if !meili_docs.is_empty() {
            let doc_count = meili_docs.len();
            meilisearch::add_documents_in_batches(
                &self.app.meili,
                &self.app.cfg.meilisearch.index,
                meili_docs,
                self.app.cfg.worker.batch_size,
            )
            .await?;
            info!(count = doc_count, "MeiliSearch 写入完成");
        }

        // 7.1 处理删除：本地有但远程索引已移除的文件
        let (deleted_count, deleted_meili_ids) = self.process_deletions(repo, &to_delete).await;
        if !deleted_meili_ids.is_empty() {
            self.delete_meili_docs(deleted_meili_ids).await;
        }
        summary.deleted = deleted_count;

        // 7.2 同步索引文件到 MinIO（关键流程，失败则本次同步失败，由上层重试机制重新触发）
        sync_index_files(http, &self.app).await?;

        Ok(summary)
    }

    /// 处理删除路径：远程索引中已不存在的本地文件。
    /// DB 软删除 + 删除 MinIO 对象，返回 (删除数量, 待删除的 MeiliSearch 文档 ID)
    async fn process_deletions(
        &self,
        repo: &Repository,
        to_delete: &[String],
    ) -> (usize, Vec<String>) {
        if to_delete.is_empty() {
            return (0, Vec::new());
        }
        info!("处理删除文件, 数量={}", to_delete.len());
        let mut meili_ids = Vec::with_capacity(to_delete.len());
        for raw in to_delete {
            match repo.soft_delete_song_by_raw(raw).await {
                Ok(Some(song_id)) => {
                    meili_ids.push(format!("song_{}", song_id));
                    // 删除 MinIO 对象（best-effort，失败仅记录，不影响主流程）
                    if let Err(e) = self
                        .app
                        .s3
                        .delete_object()
                        .bucket(&self.app.cfg.minio.bucket)
                        .key(format!("raw-lyrics/{}", raw))
                        .send()
                        .await
                    {
                        warn!(raw, error = %e, "删除 MinIO 对象失败");
                    }
                }
                Ok(None) => {
                    // 已软删除或不存在，幂等跳过
                }
                Err(e) => {
                    warn!(raw, error = %e, "软删除歌曲失败");
                }
            }
        }
        let count = meili_ids.len();
        (count, meili_ids)
    }

    /// 从 MeiliSearch 删除文档（失败仅告警，下次同步会重试）
    async fn delete_meili_docs(&self, ids: Vec<String>) {
        info!("从 MeiliSearch 删除文档, 数量={}", ids.len());
        if let Err(e) = meilisearch::delete_documents(
            &self.app.meili,
            &self.app.cfg.meilisearch.index,
            &ids,
        )
        .await
        {
            warn!(error = %e, count = ids.len(), "MeiliSearch 删除文档失败");
        }
    }
}

/// 处理单个文件
async fn process_one_with_retry(
    repo: Repository,
    d: &downloader::DownloadResult,
) -> Result<(bool, MeiliDocument)> {
    const MAX_ATTEMPTS: u32 = 3;
    let mut last_err: Option<anyhow::Error> = None;
    for attempt in 1..=MAX_ATTEMPTS {
        match process_one(repo.clone(), d).await {
            Ok(res) => {
                if attempt > 1 {
                    info!(file = %d.raw_lyric_file, attempt, "重试入库成功");
                }
                return Ok(res);
            }
            Err(e) => {
                warn!(
                    file = %d.raw_lyric_file,
                    attempt,
                    max_attempts = MAX_ATTEMPTS,
                    error = %e,
                    "入库失败",
                );
                last_err = Some(e);
                if attempt < MAX_ATTEMPTS {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            }
        }
    }
    Err(last_err.expect("at least one attempt"))
}

/// 处理单个文件：解析 TTML -> 入库 -> 准备 MeiliSearch 文档
async fn process_one(
    repo: Repository,
    d: &downloader::DownloadResult,
) -> Result<(bool, MeiliDocument)> {
    let parsed = ttml_parser::parse_ttml(&d.bytes)?;
    let entry = &d.entry;

    let music_names = entry.music_names();
    let albums = entry.albums();
    let artists = entry.artists();

    let music_pinyin = ttml_parser::extract_pinyin_list(&music_names.join(""));
    let artists_pinyin = ttml_parser::extract_pinyin_list(&artists.join(""));
    let albums_pinyin = ttml_parser::extract_pinyin_list(&albums.join(""));
    let music_initials = ttml_parser::extract_pinyin_initials_list(&music_names);
    let artists_initials = ttml_parser::extract_pinyin_initials_list(&artists);
    let albums_initials = ttml_parser::extract_pinyin_initials_list(&albums);

    let platform_mappings = entry.platform_mappings();
    let isrc = entry.isrc();
    let ttml_author_github = entry.ttml_author_github();
    let ttml_author_github_login = entry.ttml_author_github_login();

    // 解析文件名时间戳
    let (commit_timestamp, commit_time) = match entry.parse_file_meta() {
        Some((ts, _github_id)) => {
            let ts_i64 = ts as i64;
            let dt = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ts_i64)
                .map(|t| t.fixed_offset());
            if dt.is_none() {
                warn!(timestamp = ts_i64, "无法将时间戳转换为日期");
            }
            (Some(ts_i64), dt)
        }
        None => {
            warn!(file = %d.raw_lyric_file, "无法从文件名解析提交时间戳");
            (None, None)
        }
    };

    let existed = repo.find_song_id_by_raw(&d.raw_lyric_file).await?.is_some();

    let song_id = repo
        .upsert_song(SongUpsert {
            raw_lyric_file: d.raw_lyric_file.clone(),
            minio_path: format!("raw-lyrics/{}", d.raw_lyric_file),
            music_name: music_names.clone(),
            album: albums.clone(),
            isrc,
            lyric_text: Some(parsed.lyric_text.clone()),
            ttml_author_github,
            ttml_author_github_login,
            word_count: parsed.word_count,
            line_count: parsed.line_count,
            artists: artists.clone(),
            platform_mappings,
            commit_timestamp,
            commit_time,
        })
        .await?;

    let pm = &d.entry.platform_mappings();
    let doc = MeiliDocument {
        id: format!("song_{}", song_id),
        music_names: music_names.clone(),
        music_names_pinyin: music_pinyin,
        music_names_initials: music_initials,
        artists: artists.clone(),
        artists_pinyin,
        artists_initials,
        albums,
        albums_pinyin,
        albums_initials,
        lyric_text: parsed.lyric_text,
        platform_ids_ncm: pm
            .iter()
            .filter(|(p, _)| p == "ncm")
            .map(|(_, v)| v.clone())
            .collect(),
        platform_ids_qq: pm
            .iter()
            .filter(|(p, _)| p == "qq")
            .map(|(_, v)| v.clone())
            .collect(),
        platform_ids_spotify: pm
            .iter()
            .filter(|(p, _)| p == "spotify")
            .map(|(_, v)| v.clone())
            .collect(),
        platform_ids_apple: pm
            .iter()
            .filter(|(p, _)| p == "apple")
            .map(|(_, v)| v.clone())
            .collect(),
        raw_lyric_file: d.raw_lyric_file.clone(),
        ttml_author_github: entry.ttml_author_github(),
        ttml_author_github_login: entry.ttml_author_github_login(),
        word_count: parsed.word_count as i64,
        line_count: parsed.line_count as i64,
        commit_timestamp,
    };

    Ok((!existed, doc))
}

struct ProgressState {
    downloaded: AtomicI32,
    failed: AtomicI32,
}

impl ProgressState {
    fn new() -> Self {
        Self {
            downloaded: AtomicI32::new(0),
            failed: AtomicI32::new(0),
        }
    }
    fn downloaded(&self) -> i32 {
        self.downloaded.load(Ordering::Relaxed)
    }
    fn failed(&self) -> i32 {
        self.failed.load(Ordering::Relaxed)
    }
}

/// 进度刷新间隔
const PROGRESS_FLUSH_INTERVAL: i32 = 50;

/// 执行一次进度 DB 写入
async fn run_progress_flush(
    repo: Arc<Repository>,
    progress_id: i64,
    downloaded: i32,
    failed: i32,
    current_file: Option<String>,
) {
    let _ = repo
        .update_sync_progress(progress_id, downloaded, failed, current_file.as_deref())
        .await;
}

/// 触发一次进度 DB 写入
fn spawn_progress_flush(
    repo: Arc<Repository>,
    progress_id: i64,
    downloaded: i32,
    failed: i32,
    current_file: Option<String>,
) {
    tokio::spawn(run_progress_flush(repo, progress_id, downloaded, failed, current_file));
}

/// 在闭包中共享 Repository（线程安全）
fn repo_db_arc(s: &SyncTaskRunner) -> Arc<Repository> {
    Arc::new(Repository::new(s.app.db.clone()))
}

/// 下载索引文件和 zip 包并上传到 MinIO
/// 关键流程：任一文件下载或上传失败都返回错误，由上层重试整个同步
async fn sync_index_files(http: &reqwest::Client, app: &Arc<AppState>) -> Result<()> {
    let index_files = [
        ("metadata/raw-lyrics-index.jsonl", "index/metadata/raw-lyrics-index.jsonl", "application/x-ndjson"),
        ("ncm-lyrics/index.jsonl", "index/ncm-lyrics/index.jsonl", "application/x-ndjson"),
        ("qq-lyrics/index.jsonl", "index/qq-lyrics/index.jsonl", "application/x-ndjson"),
        ("spotify-lyrics/index.jsonl", "index/spotify-lyrics/index.jsonl", "application/x-ndjson"),
        ("am-lyrics/index.jsonl", "index/am-lyrics/index.jsonl", "application/x-ndjson"),
    ];

    for (remote_path, minio_key, content_type) in &index_files {
        let url = app.cfg.github.raw_url(remote_path);
        let text = github::download_raw_text(http, &url, &app.cfg.github)
            .await
            .with_context(|| format!("下载索引文件 {} 失败", remote_path))?;
        let bytes = text.into_bytes();
        downloader::upload_to_minio(&app.s3, &app.cfg.minio.bucket, minio_key, &bytes, content_type).await?;
        info!(minio_key, size = bytes.len(), "索引文件上传成功");
    }

    // raw-lyrics.zip 用二进制下载
    let bytes = github::download_zip(http, &app.cfg.github)
        .await
        .context("下载 raw-lyrics.zip 失败")?;
    downloader::upload_to_minio(&app.s3, &app.cfg.minio.bucket, "index/raw-lyrics/raw-lyrics.zip", &bytes, "application/zip").await?;
    info!(size = bytes.len(), "raw-lyrics.zip 上传成功");

    Ok(())
}

/// 构造进度回调：递增 downloaded 计数，按 PROGRESS_FLUSH_INTERVAL 限流写 DB
fn make_progress_callback(
    ps: Arc<ProgressState>,
    repo_arc: Arc<Repository>,
    progress_id: i64,
) -> impl Fn(usize, usize, &str) + Send + Sync + 'static {
    move |cur, total, file: &str| {
        let downloaded = ps.downloaded.fetch_add(1, Ordering::Relaxed) + 1;
        let failed = ps.failed();
        if downloaded % PROGRESS_FLUSH_INTERVAL == 0 {
            spawn_progress_flush(
                repo_arc.clone(),
                progress_id,
                downloaded,
                failed,
                Some(file.to_string()),
            );
        }
        tracing::debug!(cur, total, downloaded, failed, "file processed");
    }
}

/// 构造失败回调：递增 failed 计数，按 PROGRESS_FLUSH_INTERVAL 限流写 DB
fn make_failure_callback(
    ps: Arc<ProgressState>,
    repo_arc: Arc<Repository>,
    progress_id: i64,
    tag: &'static str,
) -> impl Fn(&index_parser::IndexEntry, anyhow::Error) + Send + Sync + 'static {
    move |entry, err| {
        let failed = ps.failed.fetch_add(1, Ordering::Relaxed) + 1;
        let downloaded = ps.downloaded();
        let file = entry.raw_file().unwrap_or("").to_string();
        if failed % PROGRESS_FLUSH_INTERVAL == 0 {
            spawn_progress_flush(
                repo_arc.clone(),
                progress_id,
                downloaded,
                failed,
                Some(file.clone()),
            );
        }
        warn!(file, error = %err, "{}", tag);
    }
}
