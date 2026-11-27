mod app;
mod config;
mod db;
mod infra;
mod migration;
mod not_found;
mod search;
mod storage;
mod sync;
mod validate;
mod worker;

use std::sync::Arc;

use anyhow::{Context, Result};
use redis::aio::ConnectionManager;
use tracing::{error, info, warn};

use crate::app::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    // 初始化日志
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with_target(false)
        .json()
        .init();

    let cfg = Arc::new(config::load()?);
    info!(health_port = cfg.worker.health_port, "starting ttml-worker");

    // 基础设施
    let db = infra::postgres::init_postgres(&cfg).await?;
    let redis_client = redis::Client::open(cfg.redis.url())?;
    let redis_mgr = ConnectionManager::new(redis_client).await?;

    // S3 / MinIO 客户端
    let s3 = storage::minio::build_s3_client(&cfg.minio)?;

    // 确保 bucket
    if let Err(e) = storage::minio::ensure_bucket(&s3, &cfg.minio.bucket).await {
        warn!(error = %e, "ensure bucket failed (may retry later)");
    }

    // MeiliSearch
    let meili = infra::meilisearch_client::init_meilisearch(&cfg).await?;

    let app = AppState::new(db, redis_mgr, s3, meili, cfg.clone());

    // 清理上次 worker 未正常退出残留的 running 状态同步历史。
    // 只清理 started_at 早于 2×锁 TTL 的记录：滚动发布 / 多副本时，
    // 另一副本正在跑的同步不能被新副本一启动就判失败。
    {
        let repo = crate::db::repository::Repository::new(app.db.clone());
        let stale_before: chrono::DateTime<chrono::FixedOffset> = (chrono::Utc::now()
            - chrono::Duration::seconds(cfg.worker.sync_lock_ttl.saturating_mul(2) as i64))
        .into();
        match repo.cleanup_stale_running_syncs(stale_before).await {
            Ok(0) => info!("no stale running sync to cleanup"),
            Ok(n) => warn!(cleaned = n, "cleaned up stale running sync history records"),
            Err(e) => warn!(error = %e, "cleanup stale running sync history failed"),
        }
    }

    // RabbitMQ
    let mq = infra::rabbitmq::init_rabbitmq(&cfg).await?;
    let queue_name = cfg.rabbitmq.queue.clone();
    let channel = mq.channel.clone();
    // 为 not_found 消费者使用独立 channel（QoS=并发上限已在 init_rabbitmq 中设置）
    let nf_channel = mq.nf_channel.clone();
    // 保留 mq 所有权直到程序结束，确保 Connection 不会被提前 Drop

    // 启动健康检查 HTTP 服务
    let health_app = app.clone();
    tokio::spawn(async move {
        if let Err(e) = run_health_server(health_app.cfg.worker.health_port).await {
            warn!(error = %e, "health server stopped");
        }
    });

    // 优雅关闭：用 watch 广播「已收到关闭信号」这一持久状态。
    // Notify::notify_waiters() 不保留许可，消费者正在处理长任务（一次同步可能
    // 数十分钟）时不在等待点，信号会被丢弃，循环之后永远阻塞，进程只能等编排
    // 系统宽限期到被 SIGKILL。watch 保留最新值，消费者每轮循环开头主动检查即可，
    // 即便错过了唤醒也不会漏掉关闭。
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    install_signal_handler(shutdown_tx);

    // 启动 not_found 消费者（独立 task）
    let nf_queue_name = cfg.rabbitmq.nf_queue.clone();
    let app = Arc::new(app);

    // 首次部署 / 迁移刚执行时 song_groups 为空：启动后立即做一次全量分组回填，
    // 否则索引里 isGroupHead 全是默认值，Go 侧按 isGroupHead 过滤会得到「一个文件一条」。
    // 表不存在（漏跑迁移）时仅告警，不阻塞启动，等下一次同步补算。
    {
        let repo = crate::db::repository::Repository::new(app.db.clone());
        match repo.count_song_groups().await {
            Ok(0) => {
                info!("song_groups 为空，执行首次全量分组回填");
                let runner = worker::sync_task::SyncTaskRunner::new(app.clone());
                if let Err(e) = runner.refresh_song_groups().await {
                    warn!(error = %e, "首次分组回填失败，等待下次同步重试");
                }
            }
            Ok(n) => info!(groups = n, "song_groups 已有数据，跳过启动回填"),
            Err(e) => warn!(error = %e, "读取 song_groups 失败（可能漏跑迁移），跳过启动回填"),
        }
    }

    let nf_app = app.clone();
    let nf_shutdown = shutdown_rx.clone();
    let nf_handle = tokio::spawn(async move {
        if let Err(e) = not_found::consumer::consume_loop(nf_channel, nf_queue_name, nf_app, nf_shutdown).await {
            error!(error = %e, "not_found consumer exited with error");
        }
    });

    // 启动迁移消费者（GitHub App 未配置时不启动，不影响既有同步功能）
    let mut mig_handles = Vec::new();
    match build_github_app(&cfg) {
        Some(github_app) => {
            // migration.user 消费者
            let mig_app = app.clone();
            let mig_shutdown = shutdown_rx.clone();
            let mig_channel = mq.mig_channel.clone();
            let mig_publish_channel = mq.mig_publish_channel.clone();
            let mig_queue = cfg.rabbitmq.migration_queue.clone();
            let gh = github_app.clone();
            mig_handles.push(tokio::spawn(async move {
                if let Err(e) = migration::consumer::consume_user_loop(
                    mig_channel,
                    mig_publish_channel,
                    mig_queue,
                    mig_app,
                    gh,
                    mig_shutdown,
                )
                .await
                {
                    error!(error = %e, "migration consumer exited with error");
                }
            }));

            // migration.close_pr 消费者：仅在「自动关闭 PR」开关打开时启动
            if cfg.migration.close_pr_enabled {
                let close_app = app.clone();
                let close_shutdown = shutdown_rx.clone();
                let close_channel = mq.mig_close_channel.clone();
                let close_queue = cfg.rabbitmq.migration_close_queue.clone();
                mig_handles.push(tokio::spawn(async move {
                    if let Err(e) = migration::consumer::consume_close_pr_loop(
                        close_channel,
                        close_queue,
                        close_app,
                        github_app,
                        close_shutdown,
                    )
                    .await
                    {
                        error!(error = %e, "migration close_pr consumer exited with error");
                    }
                }));
            } else {
                // 开关为假时不能只跳过 spawn：队列照常声明，存量/其它发布方仍会
                // 投递，禁用期间会无限堆积，重新打开后一次性关闭大量早已过期的 PR。
                // 因此仍起一个「排水丢弃」消费者，保持队列为空。
                info!(
                    "自动关闭 PR 已禁用（MIGRATION_CLOSE_PR_ENABLED=false），启动排水消费者丢弃 migration.close_pr 消息"
                );
                let drain_shutdown = shutdown_rx.clone();
                let drain_channel = mq.mig_close_channel.clone();
                let drain_queue = cfg.rabbitmq.migration_close_queue.clone();
                mig_handles.push(tokio::spawn(async move {
                    if let Err(e) = migration::consumer::drain_close_pr_loop(
                        drain_channel,
                        drain_queue,
                        drain_shutdown,
                    )
                    .await
                    {
                        error!(error = %e, "migration close_pr drain consumer exited with error");
                    }
                }));
            }
        }
        None => {
            warn!(
                "GitHub App 未配置（GITHUB_APP_ID / GITHUB_INSTALLATION_ID / GITHUB_PRIVATE_KEY_PATH），投稿数据迁移功能不可用"
            );
        }
    }

    // 主消费循环（sync 任务）
    worker::consumer::consume_loop(channel, queue_name, app, shutdown_rx.clone())
        .await
        .context("consume loop")?;

    // 等待 not_found 消费者退出
    let _ = nf_handle.await;
    for handle in mig_handles {
        let _ = handle.await;
    }

    info!("ttml-worker exited gracefully");
    Ok(())
}

/// 构建 GitHub App 客户端；未配置或私钥不可用时返回 None（不阻塞既有同步功能）
fn build_github_app(cfg: &Arc<config::Config>) -> Option<Arc<infra::github_app::GithubAppClient>> {
    if !cfg.github_app.enabled() {
        return None;
    }
    match infra::github_app::GithubAppClient::new(cfg.github_app.clone()) {
        Ok(client) => {
            if !client.enabled() {
                return None;
            }
            Some(Arc::new(client))
        }
        Err(e) => {
            warn!(error = %e, "GitHub App 私钥加载失败，投稿数据迁移功能不可用");
            None
        }
    }
}

async fn run_health_server(port: u16) -> Result<()> {
    use axum::{routing::{get, post}, Router};
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/validate", post(validate_handler));
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .context("bind health port")?;
    info!(port, "health server listening");
    axum::serve(listener, app).await.context("axum serve")?;
    Ok(())
}

/// POST /validate — 接收原始 TTML 文本,解析→校验→重排,返回结果
async fn validate_handler(body: String) -> axum::Json<validate::ValidateResponse> {
    // CPU 密集型任务放入 spawn_blocking,避免阻塞 async runtime
    let result = tokio::task::spawn_blocking(move || -> validate::ValidateResponse {
        // 1. 解析 TTML
        let parsed = match ttml_processor::parse_ttml(&body) {
            Ok(result) => result,
            Err(e) => {
                return validate::ValidateResponse::parse_error(format!("TTML 解析失败: {e}"));
            }
        };

        // 2. 校验元数据与歌词行
        if let Err(errors) = validate::validate_lyrics_and_metadata(&parsed) {
            return validate::ValidateResponse::validation_errors(errors);
        }

        // 3. 重排生成规范化 TTML
        let config = ttml_processor::GeneratorConfig {
            use_apple_format_rules: false,
            format: false,
        };
        let regenerated = match ttml_processor::generate_ttml(&parsed, &config) {
            Ok(ttml) => ttml,
            Err(e) => {
                return validate::ValidateResponse::parse_error(format!("TTML 重排失败: {e}"));
            }
        };

        validate::ValidateResponse::ok(regenerated, parsed.metadata)
    })
    .await;

    match result {
        Ok(resp) => axum::Json(resp),
        Err(e) => axum::Json(validate::ValidateResponse::parse_error(format!(
            "内部任务执行失败: {e}"
        ))),
    }
}

#[cfg(unix)]
fn install_signal_handler(shutdown: tokio::sync::watch::Sender<bool>) {
    use tokio::signal::unix::{signal, SignalKind};
    tokio::spawn(async move {
        let mut term = signal(SignalKind::terminate()).expect("install SIGTERM");
        let mut int = signal(SignalKind::interrupt()).expect("install SIGINT");
        tokio::select! {
            _ = term.recv() => {}
            _ = int.recv() => {}
        }
        info!("signal received, notifying shutdown");
        // 值持久化为 true，所有 Receiver 都能看到，不要求消费者此刻正停在等待点。
        let _ = shutdown.send(true);
    });
}

#[cfg(not(unix))]
fn install_signal_handler(shutdown: tokio::sync::watch::Sender<bool>) {
    use tokio::signal;
    tokio::spawn(async move {
        let _ = signal::ctrl_c().await;
        info!("signal received, notifying shutdown");
        let _ = shutdown.send(true);
    });
}
