use std::collections::HashSet;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Arc;

use anyhow::{bail, Context, Result};
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
    downloader, github, grouping, index_parser, ttml_parser,
};

use super::latest_song_recorder;

/// 索引条目数下限：本地已有数据时，远程索引低于这个数只可能是上游故障
const MIN_INDEX_ENTRIES: usize = 100;
/// 删除阶段的并发上限：2 万文件不必 4 万次串行往返
const DELETE_CONCURRENCY: usize = 16;
/// MeiliSearch 删除文档的最大尝试次数
const DELETE_MEILI_MAX_ATTEMPTS: u32 = 3;

/// 平台映射重建标记：旧库升级后需要从远端索引恢复「多版本共享平台 ID」
const PLATFORM_MAPPINGS_REBUILD_KEY: &str = "platform_mappings_rebuild";
const PLATFORM_MAPPINGS_REBUILD_VERSION: &str = "v2";

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
            let rebuild_done = repo
                .get_sync_state(PLATFORM_MAPPINGS_REBUILD_KEY)
                .await?
                .as_deref()
                == Some(PLATFORM_MAPPINGS_REBUILD_VERSION);
            let local_count = repo.count_songs().await.unwrap_or(0);
            if local_count > 0 && rebuild_done {
                info!(
                    commit = short_sha(&remote_commit),
                    songs = local_count,
                    "本地已是最新，跳过同步"
                );
                return Ok(true);
            }
            if local_count == 0 {
                warn!("commit 一致但本地歌曲数为 0，可能数据丢失，强制同步");
            } else {
                info!("检测到待执行的 platform_mappings 重建，强制同步一次");
            }
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

        // 5.5 无论同步成功或失败，都把分组与 songs 表对齐
        //
        // 为什么放在这里（而不是 execute_sync 内部）：
        //   - 覆盖 execute_sync 的全部出口，包括 total == 0 的提前 return
        //   - 中途失败时，已入库的那部分文件同样需要正确的 is_head
        //   - 幂等、全量重算 < 300ms，重复执行无副作用
        //
        // 为什么不参与错误传播：
        //   分组失败只会让搜索退化为「同组多版本并列」或「个别组缺失」，
        //   不应把一次成功的同步标记为失败（那会触发整次重试，代价更大）。
        if let Err(e) = self.refresh_song_groups().await {
            warn!(request_id, error = %e, "分组重算失败，搜索可能出现同组重复或整组缺失");
        }

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

    /// 全量重算分组并增量 patch 索引，返回 (总行数, 变更行数)
    ///
    /// pub(crate)：main.rs 的启动自愈也要调用（song_groups 为空时回填）。
    pub(crate) async fn refresh_song_groups(&self) -> Result<(usize, usize)> {
        let repo = Repository::new(self.app.db.clone());

        let inputs = repo.load_group_inputs().await?;
        let total = inputs.len();
        let groups = grouping::compute_groups(inputs);

        let old = repo.load_song_groups().await?;
        let changed = grouping::diff_groups(&old, &groups);

        repo.delete_orphan_song_groups().await?;
        repo.upsert_song_groups(&changed).await?;

        let patches: Vec<meilisearch::GroupPatch> = changed
            .iter()
            .map(|g| meilisearch::GroupPatch {
                id: format!("song_{}", g.song_id),
                song_group_id: g.group_id,
                is_group_head: g.is_head,
            })
            .collect();

        meilisearch::patch_group_fields(
            &self.app.meili,
            &self.app.cfg.meilisearch.index,
            &patches,
        )
        .await?;

        Ok((total, patches.len()))
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
        // 补偿上一轮 Meili 删除失败的文档：这些文件的 DB 记录已软删，
        // 下次 diff 不会再产生 to_delete，缺口只能靠持久化的待删队列补回来。
        if let Some(pending) = repo.get_sync_state("pending_meili_deletes").await?
            && !pending.trim().is_empty()
        {
            let pending_ids: Vec<String> = pending
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if !pending_ids.is_empty() {
                info!(count = pending_ids.len(), "重试上一轮遗留的 Meili 文档删除");
                meilisearch::delete_documents(
                    &self.app.meili,
                    &self.app.cfg.meilisearch.index,
                    &pending_ids,
                )
                .await
                .context("重试遗留 Meili 文档删除失败")?;
                repo.set_sync_state("pending_meili_deletes", "").await?;
            }
        }

        // 1. 下载 raw-lyrics-index.jsonl
        let index_url = self.app.cfg.github.raw_url("metadata/raw-lyrics-index.jsonl");
        let text = github::download_raw_text(http, &index_url, &self.app.cfg.github).await?;
        // 空 body 也是 200：上游被清空、CDN 缓存了空响应时，放行会一路走到「删光本地」
        if text.trim().is_empty() {
            bail!("索引文件为空，拒绝执行以保护存量数据");
        }
        let entries = index_parser::parse_index(&text)?;
        if entries.is_empty() {
            bail!("索引解析后无有效条目，拒绝执行以保护存量数据");
        }
        let remote_count = entries.len();
        info!("索引解析完成，共 {} 个条目", remote_count);

        // 2. 本地已有 raw 列表
        //
        // 上一轮 Meili 分批提交中途失败会打上 force_full_reindex。此时 diff 以本地 DB
        // 为准不会重发已入库文档，必须把本地列表视作空，让全部远程条目重新走
        // 「下载 → 入库 → 索引」，补齐缺口。
        let force_full_reindex = repo
            .get_sync_state("force_full_reindex")
            .await?
            .as_deref()
            == Some("1");
        let local = if force_full_reindex {
            warn!("检测到上一轮 Meili 索引缺口，本轮强制全量重建索引");
            HashSet::new()
        } else {
            repo.list_raw_lyric_files().await?
        };
        let local_count = local.len();
        debug!("本地已有 {} 个文件", local_count);

        // 2.5 条目数下限校验
        //
        // 没有这层保护，一次「200 + 空/残缺 body」就会让 compute_diff 把所有本地文件
        // 算成 to_delete，接着软删整库 + 物理删除 MinIO 对象。
        // 只在本地规模本身够大时才用绝对阈值，避免小站（比如自建 80 个文件）被永久拦住；
        // 小站的保护由下面的比例校验负责。
        if local_count >= MIN_INDEX_ENTRIES && remote_count < MIN_INDEX_ENTRIES {
            bail!(
                "索引条目数异常（远程 {} 条，本地 {} 个文件），疑似上游故障，拒绝执行",
                remote_count,
                local_count
            );
        }

        // 2.6 一次性重建平台映射（历史版本关联修复）
        //
        // 旧库在 UNIQUE(platform, platform_id) 下会把多个版本共享的平台 ID
        // 收敛到一首歌上，导致「查看历史版本」只能查到一首；这里以远端索引
        // 为权威来源恢复每首歌自己的映射，成功后打标记，后续同步不再重复执行。
        // 前置条件：已执行 001_init.up.sql。
        let rebuild_done = repo
            .get_sync_state(PLATFORM_MAPPINGS_REBUILD_KEY)
            .await?
            .as_deref()
            == Some(PLATFORM_MAPPINGS_REBUILD_VERSION);
        if !rebuild_done {
            let rows = repo.rebuild_platform_mappings(&entries).await.context(
                "重建 platform_mappings 失败；请确认已执行 001_init.up.sql",
            )?;
            repo.set_sync_state(
                PLATFORM_MAPPINGS_REBUILD_KEY,
                PLATFORM_MAPPINGS_REBUILD_VERSION,
            )
            .await?;
            info!(rows, "已从远端索引重建 platform_mappings");
        }

        // 3. 计算差异
        let Diff {
            to_add,
            mut to_delete,
        } = diff::compute_diff(entries, local);

        // 3.1 删除比例保护
        //
        // 远程条目不足本地 1/10：上游多半被清空或结构性改坏，本次不删任何东西，
        // 等下一次同步自愈；删超过一半则放行但显式告警，便于排查。
        if local_count > 0 && remote_count * 10 < local_count {
            warn!(
                local = local_count,
                remote = remote_count,
                skipping = to_delete.len(),
                "索引条目数骤降，本次跳过删除阶段"
            );
            to_delete.clear();
        } else if local_count > 0 && to_delete.len() * 2 > local_count {
            warn!(
                local = local_count,
                remote = remote_count,
                deleting = to_delete.len(),
                "本次将删除超过半数的本地文件，请确认上游是否真的移除了这些文件"
            );
        }

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
            let (deleted_count, deleted_meili_ids) =
                self.process_deletions(repo, &to_delete).await?;
            if !deleted_meili_ids.is_empty() {
                self.delete_meili_docs(repo, deleted_meili_ids).await?;
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
            if let Err(e) = meilisearch::add_documents_in_batches(
                &self.app.meili,
                &self.app.cfg.meilisearch.index,
                meili_docs,
                self.app.cfg.worker.batch_size,
            )
            .await
            {
                // 前 k-1 批已入库、第 k 批失败会留下永久缺口：打标志让下一轮全量重建，
                // 否则 sync_state 不推进 + diff 以 DB 为准，缺口永远补不回来。
                if let Err(se) = repo.set_sync_state("force_full_reindex", "1").await {
                    warn!(error = %se, "标记 force_full_reindex 失败");
                }
                return Err(e);
            }
            // 本轮索引已完整写入，清除补偿标志
            if force_full_reindex
                && let Err(e) = repo.set_sync_state("force_full_reindex", "0").await
            {
                warn!(error = %e, "清除 force_full_reindex 失败");
            }
            info!(count = doc_count, "MeiliSearch 写入完成");
        }

        // 7.1 处理删除：本地有但远程索引已移除的文件
        let (deleted_count, deleted_meili_ids) = self.process_deletions(repo, &to_delete).await?;
        if !deleted_meili_ids.is_empty() {
            self.delete_meili_docs(repo, deleted_meili_ids).await?;
        }
        summary.deleted = deleted_count;

        // 7.2 同步索引文件到 MinIO（关键流程，失败则本次同步失败，由上层重试机制重新触发）
        sync_index_files(http, &self.app).await?;

        Ok(summary)
    }

    /// 处理删除路径：远程索引中已不存在的本地文件。
    /// 有界并发执行 DB 软删除 + 删除 MinIO 对象，任一失败上抛（不再被 warn! 吞掉），
    /// 返回 (实际删除数量, 待删除的 MeiliSearch 文档 ID)。
    async fn process_deletions(
        &self,
        repo: &Repository,
        to_delete: &[String],
    ) -> Result<(usize, Vec<String>)> {
        if to_delete.is_empty() {
            return Ok((0, Vec::new()));
        }
        info!(count = to_delete.len(), "处理删除文件");

        let semaphore = Arc::new(Semaphore::new(DELETE_CONCURRENCY));
        let mut join_set = JoinSet::new();
        for raw in to_delete {
            let permit = semaphore.clone().acquire_owned().await?;
            let repo = repo.clone();
            let app = self.app.clone();
            let raw = raw.clone();
            join_set.spawn(async move {
                let _permit = permit;
                let outcome = delete_one(&app, &repo, &raw).await;
                (raw, outcome)
            });
        }

        let mut meili_ids = Vec::with_capacity(to_delete.len());
        let mut failed: Vec<(String, String)> = Vec::new();
        while let Some(joined) = join_set.join_next().await {
            let (raw, outcome) = joined.context("删除任务 panic")?;
            match outcome {
                Ok(Some(id)) => meili_ids.push(id),
                Ok(None) => {} // 已软删除或不存在，幂等跳过
                Err(e) => {
                    warn!(raw, error = %e, "删除文件失败");
                    failed.push((raw, format!("{:#}", e)));
                }
            }
        }

        let count = meili_ids.len();
        if !failed.is_empty() {
            anyhow::bail!(
                "{} 个文件删除失败，本次同步标记失败以待重试: {:?}",
                failed.len(),
                failed
            );
        }
        Ok((count, meili_ids))
    }

    /// 从 MeiliSearch 删除文档：失败做有限重试，仍失败则上抛（不再只告警），
    /// 并把 id 持久化到待删队列供下一轮补偿，避免搜索结果里永久残留已删除文档。
    async fn delete_meili_docs(&self, repo: &Repository, ids: Vec<String>) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        info!(count = ids.len(), "从 MeiliSearch 删除文档");
        let mut last_err: Option<anyhow::Error> = None;
        for attempt in 1..=DELETE_MEILI_MAX_ATTEMPTS {
            match meilisearch::delete_documents(
                &self.app.meili,
                &self.app.cfg.meilisearch.index,
                &ids,
            )
            .await
            {
                Ok(()) => return Ok(()),
                Err(e) => {
                    last_err = Some(e);
                    if attempt < DELETE_MEILI_MAX_ATTEMPTS {
                        warn!(
                            attempt,
                            count = ids.len(),
                            error = %last_err.as_ref().unwrap(),
                            "MeiliSearch 删除文档失败，准备重试"
                        );
                        tokio::time::sleep(std::time::Duration::from_secs(attempt as u64)).await;
                    }
                }
            }
        }

        let err = last_err.expect("at least one attempt");
        // DB 记录已软删，下次 diff 不会再算 to_delete，缺口必须持久化才能补回来。
        if let Err(se) = repo
            .set_sync_state("pending_meili_deletes", &ids.join(","))
            .await
        {
            warn!(error = %se, "持久化待删 Meili 文档失败");
        }
        Err(err.context(format!(
            "MeiliSearch 删除 {} 个文档最终失败，搜索索引存在已删除文档",
            ids.len()
        )))
    }
}

/// 删除单个文件：DB 软删 + MinIO 对象删除，任一失败都返回 Err（不再静默吞掉）
async fn delete_one(
    app: &Arc<AppState>,
    repo: &Repository,
    raw: &str,
) -> Result<Option<String>> {
    let Some(song_id) = repo.soft_delete_song_by_raw(raw).await? else {
        return Ok(None);
    };
    app.s3
        .delete_object()
        .bucket(&app.cfg.minio.bucket)
        .key(format!("raw-lyrics/{}", raw))
        .send()
        .await
        .with_context(|| format!("删除 MinIO 对象失败: {}", raw))?;
    Ok(Some(format!("song_{}", song_id)))
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
        // 新增文档先按「自成一组」写入，随后的分组重算会用 patch 修正；
        // 即使分组步骤失败，新文件也仍然可搜索（可接受的降级）。
        song_group_id: 0,
        is_group_head: true,
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
