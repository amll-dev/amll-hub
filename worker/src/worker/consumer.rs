use std::sync::Arc;

use anyhow::Result;
use tracing::{error, info, warn};

use crate::app::AppState;
use crate::infra;

use super::sync_task::SyncTaskRunner;

/// 重试基础退避
const RETRY_BASE_DELAY: std::time::Duration = std::time::Duration::from_secs(5);
/// 重试退避上限（指数增长到此封顶）
const RETRY_MAX_DELAY: std::time::Duration = std::time::Duration::from_secs(10);

/// 单条同步消息的最大尝试次数。耗尽后返回 Err，由通用消费循环
/// `nack(requeue=false)` 送进 DLQ，释放 prefetch=1 的队列。
/// 20 次 × 10s 封顶 ≈ 3 分钟；叠加内层下载重试，最坏也在十几分钟量级，
/// 远好于永久故障（仓库改名 / token 失效 / bucket 被删）把队列永久占死。
const SYNC_MAX_ATTEMPTS: u32 = 20;

/// 启动 RabbitMQ 消费循环
///
/// 返回时表示收到 shutdown 信号或消费者异常
pub async fn consume_loop(
    channel: lapin::Channel,
    queue_name: String,
    app: Arc<AppState>,
    shutdown: tokio::sync::watch::Receiver<bool>,
) -> Result<()> {
    infra::rabbitmq::consume_loop(
        channel,
        queue_name,
        "ttml-worker",
        shutdown,
        move |delivery| {
            let app = app.clone();
            async move { handle_message(delivery, &app).await }
        },
    )
    .await
}

/// 处理单条同步消息；重试耗尽后返回 Err，由通用消费循环 nack 进 DLQ
async fn handle_message(
    delivery: lapin::message::Delivery,
    app: &Arc<AppState>,
) -> Result<()> {
    let request_id = delivery
        .properties
        .correlation_id()
        .as_ref()
        .map(|s| s.as_str().to_string())
        .or_else(|| {
            delivery
                .properties
                .message_id()
                .as_ref()
                .map(|s| s.as_str().to_string())
        })
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let triggered_by = delivery
        .properties
        .headers()
        .as_ref()
        .and_then(|h| h.inner().get("x-triggered-by"))
        .and_then(|v| v.as_long_string())
        .map(|s| String::from_utf8_lossy(s.as_bytes()).to_string())
        .unwrap_or_else(|| "api".to_string());

    let payload: serde_json::Value = serde_json::from_slice(&delivery.data).unwrap_or_else(|_| {
        serde_json::json!({
            "request_id": request_id,
            "triggered_by": triggered_by,
        })
    });

    info!(request_id = %request_id, triggered_by = %triggered_by, "received sync message");

    let runner = SyncTaskRunner::new(app.clone());

    // 应用层有界自动重试：处理 GitHub 限流、MinIO 抖动、下载失败等故障。
    // 退避指数增长、10s 封顶；次数耗尽必须返回 Err，否则永久故障会让这条
    // delivery 永远不 ack/nack，后续所有同步消息都投递不了。
    let mut attempt: u32 = 0;
    loop {
        match runner.run(&request_id, &triggered_by, &payload).await {
            Ok(skipped) => {
                if skipped {
                    info!(request_id = %request_id, "sync skipped (already up-to-date)");
                }
                return Ok(());
            }
            Err(e) => {
                attempt += 1;
                if attempt >= SYNC_MAX_ATTEMPTS {
                    error!(
                        request_id = %request_id,
                        attempt,
                        error = %e,
                        "sync 连续失败，重试次数耗尽，转入 DLQ"
                    );
                    return Err(e);
                }
                let delay = (RETRY_BASE_DELAY * 2u32.saturating_pow(attempt - 1)).min(RETRY_MAX_DELAY);
                warn!(
                    request_id = %request_id,
                    attempt,
                    max_attempts = SYNC_MAX_ATTEMPTS,
                    delay_secs = delay.as_secs(),
                    error = %e,
                    "sync attempt failed, will retry"
                );
                tokio::time::sleep(delay).await;
            }
        }
    }
}
