use std::sync::Arc;

use anyhow::{Context, Result};
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use tracing::{info, warn};

use crate::app::AppState;
use crate::infra;

use super::ncm_api::{parse_and_categorize, ParseCategory, ParseContext};
use super::whitelist::{add_cloud_music, add_pure_music, is_in_whitelist};

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
    channel: lapin::Channel,
    nf_queue_name: String,
    app: Arc<AppState>,
    shutdown: Arc<tokio::sync::Notify>,
) -> Result<()> {
    // nf_channel 的 QoS=5 已在 init_rabbitmq 中设置
    infra::rabbitmq::consume_loop(
        channel,
        nf_queue_name,
        "ttml-nf-worker",
        shutdown,
        move |delivery| {
            let app = app.clone();
            async move { handle_message(delivery, &app).await }
        },
    )
    .await
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
    let category_str = match &result.category {
        ParseCategory::PureMusic => {
            // 加入纯音乐白名单
            if let Err(e) = add_pure_music(&mut redis_conn, &msg.platform, &msg.platform_id).await {
                warn!(error = %e, "add to pure_music redis set failed");
            }
            // 同时写入 PG 白名单表
            if let Err(e) = upsert_whitelist_pg(
                &app.db,
                &WhitelistUpsert {
                    table: "pure_music_whitelist",
                    platform: &msg.platform,
                    platform_id: &msg.platform_id,
                    song_name: &result.song_name,
                    reason: "歌词解析发现纯音乐关键词",
                    detected_by: msg.client_ip.as_deref().unwrap_or(""),
                },
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
            if let Err(e) = upsert_whitelist_pg(
                &app.db,
                &WhitelistUpsert {
                    table: "cloud_music_whitelist",
                    platform: &msg.platform,
                    platform_id: &msg.platform_id,
                    song_name: &result.song_name,
                    reason: "网易云 t=1/2 云盘音乐",
                    detected_by: msg.client_ip.as_deref().unwrap_or(""),
                },
            ).await {
                warn!(error = %e, "upsert cloud_music pg failed");
            }
            "cloud_music"
        }
        ParseCategory::NotFound => "not_found",
        ParseCategory::ApiFailed => {
            // API 瞬时故障不是最终状态：返回 Err 触发应用层重试，
            // 重试耗尽后消息进 DLQ 等待人工处理，而不是被 ack 静默丢弃
            anyhow::bail!(
                "ncm api failed (transient), platform={} platform_id={}",
                msg.platform,
                msg.platform_id
            );
        }
    };

    // 4. 更新 not_found_requests 表的 category 及元数据
    if let Err(e) = update_category_pg(&app.db, msg, category_str, &result).await {
        warn!(error = %e, "update not_found category failed");
    }

    Ok(())
}

/// 更新 not_found_requests 的 category 及歌曲元数据
async fn update_category_pg(
    db: &DatabaseConnection,
    msg: &NotFoundMessage,
    category: &str,
    result: &super::ncm_api::ParseResult,
) -> Result<()> {
    use sea_orm::ConnectionTrait;

    let artists = result.artists.join(" / ");
    let sql = r#"UPDATE not_found_requests
        SET category = $1, song_name = $2, artists = $3, cover = $4, album = $5, updated_at = NOW()
        WHERE platform = $6 AND platform_id = $7"#;

    db.execute(sea_orm::Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        sql,
        [
            category.into(),
            result.song_name.clone().into(),
            artists.into(),
            result.cover.clone().into(),
            result.album.clone().into(),
            msg.platform.clone().into(),
            msg.platform_id.clone().into(),
        ],
    ))
    .await?;

    Ok(())
}

/// 白名单表 upsert 参数
struct WhitelistUpsert<'a> {
    /// 目标表：pure_music_whitelist / cloud_music_whitelist
    table: &'a str,
    platform: &'a str,
    platform_id: &'a str,
    song_name: &'a str,
    reason: &'a str,
    detected_by: &'a str,
}

/// 写入白名单表（pure_music_whitelist / cloud_music_whitelist），ON CONFLICT DO NOTHING
async fn upsert_whitelist_pg(db: &DatabaseConnection, p: &WhitelistUpsert<'_>) -> Result<()> {
    use sea_orm::ConnectionTrait;

    let sql = format!(
        r#"INSERT INTO {} (platform, platform_id, song_name, reason, detected_by)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (platform, platform_id) DO NOTHING"#,
        p.table
    );

    db.execute(sea_orm::Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        sql,
        [
            p.platform.into(),
            p.platform_id.into(),
            p.song_name.into(),
            p.reason.into(),
            p.detected_by.into(),
        ],
    ))
    .await?;

    Ok(())
}
