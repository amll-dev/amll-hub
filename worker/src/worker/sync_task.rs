use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Arc;

use anyhow::{Context, Result};
use aws_sdk_s3::Client as S3Client;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tracing::{error, info, warn};

use crate::app::AppState;
use crate::db::repository::{Repository, SongUpsert};
use crate::db::types::SyncSummary;
use crate::search::meilisearch::{self, MeiliDocument};
use crate::storage::redis::SyncLock;
use crate::sync::{
    diff::{self, Diff},
    downloader, github, index_parser, ttml_parser,
};

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

        // 1. 获取远程 commit
        info!("步骤1: 获取远程 commit");
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .context("build http client")?;
        let remote_commit = github::fetch_latest_commit(&http, &self.app.cfg.github).await?;
        info!("获取到远程 commit: {}", remote_commit);
        
        info!("步骤2: 获取本地同步状态");
        let local_state = repo.get_sync_state_all().await?;
        info!("本地状态: last_commit={}, last_at={}", local_state.last_synced_commit, local_state.last_synced_at);

        // 2. 与本地对比
        info!("步骤3: 检查是否需要同步");
        if !local_state.last_synced_commit.is_empty()
            && local_state.last_synced_commit == remote_commit
        {
            let local_count = repo.count_songs().await.unwrap_or(0);
            if local_count > 0 {
                info!(
                    "本地已是最新（commit={}, songs={}），跳过同步",
                    &remote_commit[..7.min(remote_commit.len())], local_count
                );
                return Ok(true);
            }
            warn!("commit 一致但本地歌曲数为 0，可能数据丢失，强制同步");
        }
        let is_first_sync = local_state.last_synced_commit.is_empty();
        info!("需要同步，远程 commit: {}, 是否首次: {}", remote_commit, is_first_sync);

        // 3. 获取 Redis 锁
        info!("步骤4: 获取 Redis 锁");
        let mut lock = SyncLock::new(
            self.app.redis.clone(),
            "sync_lock",
            request_id,
            self.app.cfg.worker.sync_lock_ttl,
        );
        if !lock.try_acquire().await? {
            warn!(request_id, "lock busy, will be retried by rabbitmq requeue");
            anyhow::bail!("sync lock busy");
        }
        info!("成功获取 Redis 锁");

        // 4. 创建同步历史
        info!("步骤5: 创建同步历史记录");
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
        info!("创建同步历史记录成功, history_id={}", history_id);

        // 执行同步主流程
        info!("步骤6: 开始执行同步主流程");
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
                info!(request_id, history_id, "sync finished");
                let _ = lock.release().await;
                Ok(false)
            }
            Err(e) => {
                error!(request_id, history_id, error = %e, "sync failed");
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
        info!("execute_sync - 步骤1: 下载索引文件");
        let index_url = self.app.cfg.github.raw_url("metadata/raw-lyrics-index.jsonl");
        info!("索引 URL: {}", index_url);
        let text = github::download_raw_text(http, &index_url, &self.app.cfg.github).await?;
        let entries = index_parser::parse_index(&text)?;
        info!("解析索引完成，共 {} 个条目", entries.len());

        // 2. 本地已有 raw 列表
        info!("execute_sync - 步骤2: 获取本地文件列表");
        let local = repo.list_raw_lyric_files().await?;
        info!("本地已有 {} 个文件", local.len());

        // 3. 计算差异
        info!("execute_sync - 步骤3: 计算差异");
        let Diff { to_add, to_delete } = diff::compute_diff(entries, local);
        info!("差异: to_add={}, to_delete={}", to_add.len(), to_delete.len());

        let total = to_add.len();

        // 3.5 空差集短路：无新增文件时跳过下载和处理阶段
        if total == 0 {
            info!("无新增文件，跳过下载和处理阶段");
            // 仍同步索引文件到 MinIO（jsonl 可能含 metadata 变更）
            if let Err(e) = sync_index_files(http, &self.app).await {
                warn!(error = %e, "同步索引文件失败，不影响主流程");
            }
            return Ok(SyncSummary::default());
        }

        info!("execute_sync - 步骤4: 创建同步进度记录, total={}", total);
        let progress_id = repo.create_sync_progress(history_id, total as i32).await?;
        info!("进度记录创建成功, progress_id={}", progress_id);

        // 4. 待处理列表 = to_add
        let mut all: Vec<_> = to_add.into_iter().collect();
        let added_count_hint = all.len() - to_delete.len().min(all.len());

        // 进度状态（无锁 atomic 计数，DB 写入限流）
        let progress_state = Arc::new(ProgressState::new());
        let repo_arc = repo_db_arc(self);
        let progress_id_inner = progress_id;

        // 5. 下载与上传：首次同步或差集超阈值走 zip；否则逐文件，失败降级 zip
        let threshold = self.app.cfg.worker.incremental_threshold;
        let use_zip = is_first_sync || total > threshold;

        info!(
            "execute_sync - 步骤5: 开始下载和上传文件, 模式: {}, total: {}, threshold: {}",
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
            let zip_url = self.app.cfg.github.raw_lyrics_zip_url();
            info!("zip URL: {}", zip_url);
            let zip_bytes = github::download_zip(http, &self.app.cfg.github).await?;
            info!("zip 下载完成, 字节数: {}", zip_bytes.len());
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
                    info!("zip 下载完成, 字节数: {}", zip_bytes.len());
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
        {
            let final_downloaded = progress_state.downloaded();
            let final_failed = progress_state.failed();
            info!(final_downloaded, final_failed, "flush 最终下载进度");
            run_progress_flush(
                repo_arc.clone(),
                progress_id_inner,
                final_downloaded,
                final_failed,
                None,
            )
            .await;
        }

        // 6. 并发解析 + 入库 + 累积 MeiliSearch 文档
        let concurrency = self.app.cfg.worker.concurrency.max(1) as usize;
        info!("execute_sync - 步骤6: 并发解析并入库文件 (并发={})", concurrency);
        let mut meili_docs: Vec<MeiliDocument> = Vec::with_capacity(downloaded.len());
        let mut summary = SyncSummary {
            added: 0,
            updated: 0,
            deleted: 0,
        };

        let total = downloaded.len();
        let downloaded_arc = Arc::new(downloaded);
        let semaphore = Arc::new(Semaphore::new(concurrency));
        let mut join_set = JoinSet::new();

        for (idx, _d) in downloaded_arc.iter().enumerate() {
            let permit = semaphore
                .clone()
                .acquire_owned()
                .await
                .map_err(|e| anyhow::anyhow!(e))?;
            let repo_clone = repo.clone();
            let downloaded_clone = downloaded_arc.clone();
            join_set.spawn(async move {
                let _permit = permit;
                let d = &downloaded_clone[idx];
                let result = process_one(repo_clone, d).await;
                (idx, result)
            });
        }

        while let Some(res) = join_set.join_next().await {
            let (idx, result) = res.map_err(|e| anyhow::anyhow!(e))?;
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
                    warn!(error = %e, "process failed");
                }
            }
            if (idx + 1) % 100 == 0 {
                info!("已入库 {}/{}", idx + 1, total);
            }
        }
        info!(
            "入库完成，新增 {}，更新 {}，失败 {}",
            summary.added,
            summary.updated,
            total - summary.added - summary.updated
        );

        // 7. 删除：本地有但远程无（CC0 仓库暂不主动删除）
        // summary.deleted = to_delete.len();
        // 预留：未来若开启删除，需要同时删除 MinIO 对象与 MeiliSearch 文档

        // 8. 写入 MeiliSearch
        if !meili_docs.is_empty() {
            info!("execute_sync - 步骤7: 写入 MeiliSearch, 文档数={}", meili_docs.len());
            meilisearch::add_documents_in_batches(
                &self.app.meili,
                &self.app.cfg.meilisearch.index,
                meili_docs,
                self.app.cfg.worker.batch_size,
            )
            .await?;
            info!("MeiliSearch 写入完成");
        }

        // 8.5 同步索引文件到 MinIO
        info!("execute_sync - 步骤8.5: 同步索引文件到 MinIO");
        if let Err(e) = sync_index_files(http, &self.app).await {
            warn!(error = %e, "同步索引文件失败，不影响主流程");
        }

        // 9. 缓存预热：平台 ID -> MinioPath
        info!("execute_sync - 步骤9: 缓存预热");
        self.warmup_cache(repo).await;

        let _ = added_count_hint;
        Ok(summary)
    }

    /// 缓存预热：扫描 platform_mappings，写入 Redis
    async fn warmup_cache(&self, _repo: &Repository) {
        // 简化实现：当前不做全量预热，避免启动时大量 DB 查询
        // 实际预热可在 Go 端首次访问时 lazy 加载
    }
}

/// 处理单个文件：解析 TTML -> 入库 -> 准备 MeiliSearch 文档
/// 返回 (is_new, meili_document)，is_new=true 表示新增，false 表示更新
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

    let platform_mappings = entry.platform_mappings();
    let isrc = entry.isrc();
    let ttml_author_github = entry.ttml_author_github();
    let ttml_author_github_login = entry.ttml_author_github_login();

    // 解析文件名时间戳：{timestamp}-{githubId}-{random}.ttml
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
        artists: artists.clone(),
        artists_pinyin,
        albums,
        albums_pinyin,
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

/// 进度刷新间隔：每处理 N 个文件才 spawn 一次 DB 写入，避免连接池耗尽
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

/// 触发一次进度 DB 写入（周期性刷新，fire-and-forget）
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
        match github::download_raw_text(http, &url, &app.cfg.github).await {
            Ok(text) => {
                let bytes = text.into_bytes();
                upload_index_to_minio(&app.s3, &app.cfg.minio.bucket, minio_key, &bytes, content_type).await?;
                info!(minio_key, size = bytes.len(), "索引文件上传成功");
            }
            Err(e) => {
                warn!(remote_path, error = %e, "下载索引文件失败，跳过");
            }
        }
    }

    // raw-lyrics.zip 用二进制下载
    match github::download_zip(http, &app.cfg.github).await {
        Ok(bytes) => {
            upload_index_to_minio(&app.s3, &app.cfg.minio.bucket, "index/raw-lyrics/raw-lyrics.zip", &bytes, "application/zip").await?;
            info!(size = bytes.len(), "raw-lyrics.zip 上传成功");
        }
        Err(e) => {
            warn!(error = %e, "下载 raw-lyrics.zip 失败，跳过");
        }
    }

    Ok(())
}

async fn upload_index_to_minio(
    s3: &S3Client,
    bucket: &str,
    key: &str,
    bytes: &[u8],
    content_type: &str,
) -> Result<()> {
    s3.put_object()
        .bucket(bucket)
        .key(key)
        .body(bytes::Bytes::from(bytes.to_vec()).into())
        .content_type(content_type)
        .send()
        .await
        .with_context(|| format!("上传索引文件到 MinIO: {}", key))?;
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
