use std::sync::Arc;

use anyhow::Result;
use tracing::{info, warn};

use crate::app::AppState;
use crate::infra;

use super::sync_task::SyncTaskRunner;

/// 同步任务最大重试次数
const MAX_RETRIES: u32 = 3;
/// 重试基础退避
const RETRY_BASE_DELAY: std::time::Duration = std::time::Duration::from_secs(5);

/// 启动 RabbitMQ 消费循环
///
/// 返回时表示收到 shutdown 信号或消费者异常
pub async fn consume_loop(
    channel: lapin::Channel,
    queue_name: String,
    app: Arc<AppState>,
    shutdown: Arc<tokio::sync::Notify>,
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

    // 应用层有限重试：处理 GitHub 限流、MinIO 抖动等瞬时故障
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
                if attempt >= MAX_RETRIES {
                    // 最终失败由通用消费循环统一记录并 nack 进 DLQ，
                    // 这里附上 request_id 便于追踪
                    return Err(e.context(format!("request_id={}, attempts={}", request_id, attempt)));
                }
                let delay = RETRY_BASE_DELAY * 2u32.saturating_pow(attempt - 1);
                warn!(
                    request_id = %request_id,
                    attempt,
                    max_retries = MAX_RETRIES,
                    delay_ms = delay.as_millis() as u64,
                    error = %e,
                    "sync attempt failed, will retry"
                );
                tokio::time::sleep(delay).await;
            }
        }
    }
}
