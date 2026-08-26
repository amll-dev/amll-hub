mod app;
mod config;
mod db;
mod infra;
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

    // 清理上次 worker 未正常退出残留的 running 状态同步历史
    {
        let repo = crate::db::repository::Repository::new(app.db.clone());
        match repo.cleanup_stale_running_syncs().await {
            Ok(0) => info!("no stale running sync to cleanup"),
            Ok(n) => warn!(cleaned = n, "cleaned up stale running sync history records"),
            Err(e) => warn!(error = %e, "cleanup stale running sync history failed"),
        }
    }

    // RabbitMQ
    let mq = infra::rabbitmq::init_rabbitmq(&cfg).await?;
    let queue_name = cfg.rabbitmq.queue.clone();
    let channel = mq.channel.clone();
    // 为 not_found 消费者使用独立 channel（QoS=5 已在 init_rabbitmq 中设置）
    let nf_channel = mq.nf_channel.clone();
    // 保留 mq 所有权直到程序结束，确保 Connection 不会被提前 Drop

    // 启动健康检查 HTTP 服务
    let health_app = app.clone();
    tokio::spawn(async move {
        if let Err(e) = run_health_server(health_app.cfg.worker.health_port).await {
            warn!(error = %e, "health server stopped");
        }
    });

    // 优雅关闭
    let shutdown = Arc::new(tokio::sync::Notify::new());
    let shutdown_signal = shutdown.clone();
    install_signal_handler(shutdown_signal);

    // 启动 not_found 消费者（独立 task）
    let nf_queue_name = cfg.rabbitmq.nf_queue.clone();
    let app = Arc::new(app);
    let nf_app = app.clone();
    let nf_shutdown = shutdown.clone();
    let nf_handle = tokio::spawn(async move {
        if let Err(e) = not_found::consumer::consume_loop(nf_channel, nf_queue_name, nf_app, nf_shutdown).await {
            error!(error = %e, "not_found consumer exited with error");
        }
    });

    // 主消费循环（sync 任务）
    worker::consumer::consume_loop(channel, queue_name, app, shutdown.clone())
        .await
        .context("consume loop")?;

    // 等待 not_found 消费者退出
    let _ = nf_handle.await;

    info!("ttml-worker exited gracefully");
    Ok(())
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
fn install_signal_handler(notify: Arc<tokio::sync::Notify>) {
    use tokio::signal::unix::{signal, SignalKind};
    tokio::spawn(async move {
        let mut term = signal(SignalKind::terminate()).expect("install SIGTERM");
        let mut int = signal(SignalKind::interrupt()).expect("install SIGINT");
        tokio::select! {
            _ = term.recv() => {}
            _ = int.recv() => {}
        }
        info!("signal received, notifying shutdown");
        notify.notify_waiters();
    });
}

#[cfg(not(unix))]
fn install_signal_handler(notify: Arc<tokio::sync::Notify>) {
    use tokio::signal;
    tokio::spawn(async move {
        let _ = signal::ctrl_c().await;
        info!("signal received, notifying shutdown");
        notify.notify_waiters();
    });
}
