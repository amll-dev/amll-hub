use std::sync::Arc;

use anyhow::{Context, Result};
use futures_lite::StreamExt;
use lapin::{
    options::{BasicAckOptions, BasicConsumeOptions, BasicNackOptions, BasicQosOptions},
    types::FieldTable,
    Channel,
};
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use tracing::{error, info, warn};

use crate::app::AppState;

use super::ncm_api::{parse_and_categorize, ParseCategory, ParseContext};
use super::repository::{add_cloud_music, add_pure_music, is_in_whitelist};

/// 无歌词解析消息体
#[derive(Debug, Deserialize)]
struct NotFoundMessage {
    platform: String,
    #[serde(rename = "platformId")]
    platform_id: String,
    #[serde(rename = "clientIp", default)]
    client_ip: Option<String>,
}

/// 启动无歌词解析消费循环
pub async fn consume_loop(
    channel: Channel,
    nf_queue_name: String,
    app: Arc<AppState>,
    shutdown: Arc<tokio::sync::Notify>,
) -> Result<()> {
    // QoS = 5（允许并发 5 个 API 调用）
    if let Err(e) = channel
        .basic_qos(5, BasicQosOptions { global: false })
        .await
        .context("nf qos")
    {
        return Err(e);
    }

    let mut consumer = channel
        .basic_consume(
            &nf_queue_name,
            "ttml-nf-worker",
            BasicConsumeOptions::default(),
            FieldTable::default(),
        )
        .await
        .context("nf basic_consume")?;

    info!(queue = %nf_queue_name, "not_found consumer started");

    let notified = shutdown.notified();
    tokio::pin!(notified);
    loop {
        tokio::select! {
            _ = &mut notified => {
                info!("not_found consumer shutdown signal received");
                break;
            }
            msg = consumer.next() => {
                let Some(delivery) = msg else { break; };
                let delivery = match delivery {
                    Ok(d) => d,
                    Err(e) => {
                        error!(error = %e, "nf consumer error");
                        break;
                    }
                };
                let tag = delivery.delivery_tag;
                match handle_message(delivery, &app).await {
                    Ok(()) => {
                        let _ = channel
                            .basic_ack(tag, BasicAckOptions::default())
                            .await;
                    }
                    Err(e) => {
                        error!(error = %e, "nf task failed after retries, sending to DLQ");
                        let _ = channel
                            .basic_nack(
                                tag,
                                BasicNackOptions { multiple: false, requeue: false },
                            )
                            .await;
                    }
                }
            }
        }
    }

    Ok(())
}

/// 无歌词解析最大重试次数
const NF_MAX_RETRIES: u32 = 3;
const NF_RETRY_BASE_DELAY: std::time::Duration = std::time::Duration::from_secs(5);

async fn handle_message(
    delivery: lapin::message::Delivery,
    app: &Arc<AppState>,
) -> Result<()> {
    let msg: NotFoundMessage = serde_json::from_slice(&delivery.data)
        .context("parse nf message")?;

    info!(platform = %msg.platform, platform_id = %msg.platform_id, "processing not_found message");

    // 应用层有限重试
    let mut attempt: u32 = 0;
    loop {
        match process_once(&msg, app).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                attempt += 1;
                if attempt >= NF_MAX_RETRIES {
                    return Err(e);
                }
                let delay = NF_RETRY_BASE_DELAY * 2u32.saturating_pow(attempt - 1);
                warn!(
                    platform = %msg.platform,
                    platform_id = %msg.platform_id,
                    attempt,
                    max_retries = NF_MAX_RETRIES,
                    delay_ms = delay.as_millis() as u64,
                    error = %e,
                    "nf attempt failed, will retry"
                );
                tokio::time::sleep(delay).await;
            }
        }
    }
}

/// 单次处理
async fn process_once(msg: &NotFoundMessage, app: &Arc<AppState>) -> Result<()> {
    // 1. 检查白名单（Redis）
    let mut redis_conn = app.redis.clone();
    if is_in_whitelist(&mut redis_conn, &msg.platform, &msg.platform_id).await? {
        info!(platform = %msg.platform, platform_id = %msg.platform_id, "already in whitelist, skip");
        return Ok(());
    }

    // 2. 调用 API 解析分类
    let client = app.http_client.clone();

    let parse_ctx = ParseContext::new(app.cfg.ncm.api_base.clone());
    let result = parse_and_categorize(&client, &parse_ctx, &msg.platform, &msg.platform_id).await?;

    info!(
        platform = %msg.platform,
        platform_id = %msg.platform_id,
        category = ?result.category,
        song_name = %result.song_name,
        "parse result"
    );

    // 3. 根据分类更新数据库和 Redis
    let category_str = match result.category {
        ParseCategory::PureMusic => {
            // 加入纯音乐白名单
            if let Err(e) = add_pure_music(&mut redis_conn, &msg.platform, &msg.platform_id).await {
                warn!(error = %e, "add to pure_music redis set failed");
            }
            // 同时写入 PG 白名单表
            if let Err(e) = upsert_pure_music_pg(
                &app.db,
                &msg.platform,
                &msg.platform_id,
                &result.song_name,
                "歌词解析发现纯音乐关键词",
                msg.client_ip.as_deref().unwrap_or(""),
            ).await {
                warn!(error = %e, "upsert pure_music pg failed");
            }
            "pure_music"
        }
        ParseCategory::CloudMusic => {
            // 加入云盘音乐白名单
            if let Err(e) = add_cloud_music(&mut redis_conn, &msg.platform, &msg.platform_id).await {
                warn!(error = %e, "add to cloud_music redis set failed");
            }
            if let Err(e) = upsert_cloud_music_pg(
                &app.db,
                &msg.platform,
                &msg.platform_id,
                &result.song_name,
                "网易云 t=1/2 云盘音乐",
                msg.client_ip.as_deref().unwrap_or(""),
            ).await {
                warn!(error = %e, "upsert cloud_music pg failed");
            }
            "cloud_music"
        }
        ParseCategory::NotFound => "not_found",
        ParseCategory::ApiFailed => "api_failed",
    };

    // 4. 更新 not_found_requests 表的 category
    if let Err(e) = update_category_pg(
        &app.db,
        &msg.platform,
        &msg.platform_id,
        category_str,
        &result.song_name,
    ).await {
        warn!(error = %e, "update not_found category failed");
    }

    Ok(())
}

/// 更新 not_found_requests 的 category
async fn update_category_pg(
    db: &DatabaseConnection,
    platform: &str,
    platform_id: &str,
    category: &str,
    song_name: &str,
) -> Result<()> {
    use sea_orm::ConnectionTrait;

    let sql = if song_name.is_empty() {
        r#"UPDATE not_found_requests SET category = $1, updated_at = NOW() WHERE platform = $2 AND platform_id = $3"#.to_string()
    } else {
        r#"UPDATE not_found_requests SET category = $1, song_name = $2, updated_at = NOW() WHERE platform = $3 AND platform_id = $4"#.to_string()
    };

    if song_name.is_empty() {
        db.execute(sea_orm::Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            &sql,
            [category.into(), platform.into(), platform_id.into()],
        ))
        .await?;
    } else {
        db.execute(sea_orm::Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            &sql,
            [
                category.into(),
                song_name.into(),
                platform.into(),
                platform_id.into(),
            ],
        ))
        .await?;
    }

    Ok(())
}

/// 写入 pure_music_whitelist 表（ON CONFLICT DO NOTHING）
async fn upsert_pure_music_pg(
    db: &DatabaseConnection,
    platform: &str,
    platform_id: &str,
    song_name: &str,
    reason: &str,
    detected_by: &str,
) -> Result<()> {
    use sea_orm::ConnectionTrait;

    let sql = r#"INSERT INTO pure_music_whitelist (platform, platform_id, song_name, reason, detected_by)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (platform, platform_id) DO NOTHING"#;

    db.execute(sea_orm::Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        sql,
        [
            platform.into(),
            platform_id.into(),
            song_name.into(),
            reason.into(),
            detected_by.into(),
        ],
    ))
    .await?;

    Ok(())
}

/// 写入 cloud_music_whitelist 表（ON CONFLICT DO NOTHING）
async fn upsert_cloud_music_pg(
    db: &DatabaseConnection,
    platform: &str,
    platform_id: &str,
    song_name: &str,
    reason: &str,
    detected_by: &str,
) -> Result<()> {
    use sea_orm::ConnectionTrait;

    let sql = r#"INSERT INTO cloud_music_whitelist (platform, platform_id, song_name, reason, detected_by)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (platform, platform_id) DO NOTHING"#;

    db.execute(sea_orm::Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        sql,
        [
            platform.into(),
            platform_id.into(),
            song_name.into(),
            reason.into(),
            detected_by.into(),
        ],
    ))
    .await?;

    Ok(())
}
