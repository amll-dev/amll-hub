use std::sync::Arc;

use anyhow::{Context, Result};
use futures_lite::StreamExt;
use lapin::{
    options::{BasicAckOptions, BasicConsumeOptions, BasicNackOptions},
    types::FieldTable,
    Channel,
};
use tracing::{error, info, warn};

use crate::app::AppState;

use super::sync_task::SyncTaskRunner;

/// 同步任务最大重试次数
const MAX_RETRIES: u32 = 3;
/// 重试基础退避
const RETRY_BASE_DELAY: std::time::Duration = std::time::Duration::from_secs(5);

/// 启动 RabbitMQ 消费循环
///
/// 返回时表示收到 shutdown 信号或消费者异常
pub async fn consume_loop(
    channel: Channel,
    queue_name: String,
    app: Arc<AppState>,
    shutdown: Arc<tokio::sync::Notify>,
) -> Result<()> {
    let mut consumer = channel
        .basic_consume(
            &queue_name,
            "ttml-worker",
            BasicConsumeOptions::default(),
            FieldTable::default(),
        )
        .await
        .context("basic_consume")?;

    info!(queue = %queue_name, "consumer started");

    let notified = shutdown.notified();
    tokio::pin!(notified);
    loop {
        tokio::select! {
            _ = &mut notified => {
                info!("shutdown signal received, stopping consumer");
                break;
            }
            msg = consumer.next() => {
                let Some(delivery) = msg else { break; };
                let delivery = match delivery {
                    Ok(d) => d,
                    Err(e) => {
                        error!(error = %e, "consumer error");
                        break;
                    }
                };
                // handle_message 内部做有限重试；
                // 重试耗尽后 nack(requeue=false) 让消息进入 DLQ，避免毒消息无限阻塞队列
                let _ = handle_message(&channel, delivery, &app).await;
            }
        }
    }

    Ok(())
}

async fn handle_message(
    channel: &Channel,
    delivery: lapin::message::Delivery,
    app: &Arc<AppState>,
) -> Result<()> {
    let tag = delivery.delivery_tag;
    let body = &delivery.data;
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

    let payload: serde_json::Value = serde_json::from_slice(body).unwrap_or_else(|_| {
        serde_json::json!({
            "request_id": request_id,
            "triggered_by": triggered_by,
        })
    });

    info!(request_id = %request_id, triggered_by = %triggered_by, "received sync message");

    let runner = SyncTaskRunner::new(app.clone());

    // 应用层有限重试：处理 GitHub 限流、MinIO 抖动等瞬时故障
    let mut attempt: u32 = 0;
    let result = loop {
        match runner.run(&request_id, &triggered_by, &payload).await {
            Ok(skipped) => break Ok(skipped),
            Err(e) => {
                attempt += 1;
                if attempt >= MAX_RETRIES {
                    break Err(e);
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
    };

    match result {
        Ok(skipped) => {
            if skipped {
                info!(request_id = %request_id, "sync skipped (already up-to-date)");
            }
            let _ = channel
                .basic_ack(tag, BasicAckOptions::default())
                .await
                .context("basic_ack");
            Ok(())
        }
        Err(e) => {
            error!(
                request_id = %request_id,
                attempt,
                error = %e,
                "sync task failed after retries, sending to DLQ"
            );
            // nack(requeue=false) 触发 dead-lettering 到 DLQ，避免毒消息无限重投
            let _ = channel
                .basic_nack(
                    tag,
                    BasicNackOptions {
                        multiple: false,
                        requeue: false,
                    },
                )
                .await
                .context("basic_nack");
            Ok(())
        }
    }
}
