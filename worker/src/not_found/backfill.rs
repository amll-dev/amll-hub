use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use sea_orm::{ConnectionTrait, DatabaseBackend, FromQueryResult, Statement};
use tokio::sync::Notify;
use tracing::{error, info, warn};

use crate::app::AppState;

use super::consumer::{NotFoundMessage, process_with_mode};

/// 回填轮询间隔
const BACKFILL_INTERVAL: Duration = Duration::from_secs(5 * 60);
/// 首次回填延迟：先让消费链路把积压处理完
const BACKFILL_STARTUP_DELAY: Duration = Duration::from_secs(90);
/// 每轮最多回填条数
const BACKFILL_BATCH: i64 = 200;
/// 分布式锁：多台 worker 只让一台做回填，避免重复请求外部 API
const BACKFILL_LOCK_KEY: &str = "not_found:backfill:lock";

/// 待回填记录
#[derive(Debug, FromQueryResult)]
struct EmptyRecord {
    platform: String,
    platform_id: String,
}

/// 回填循环：定期扫描无歌名的记录，重新解析并写回元数据
pub async fn run_loop(app: Arc<AppState>, shutdown: Arc<Notify>) {
    tokio::select! {
        _ = tokio::time::sleep(BACKFILL_STARTUP_DELAY) => {}
        _ = shutdown.notified() => return,
    }

    loop {
        if let Err(e) = backfill_once(&app).await {
            error!(error = %e, "backfill round failed");
        }
        tokio::select! {
            _ = tokio::time::sleep(BACKFILL_INTERVAL) => {}
            _ = shutdown.notified() => {
                info!("backfill task stopped");
                return;
            }
        }
    }
}

async fn backfill_once(app: &Arc<AppState>) -> Result<()> {
    if !acquire_lock(app).await? {
        return Ok(());
    }
    let result = run_batch(app).await;
    release_lock(app).await;
    result
}

async fn run_batch(app: &Arc<AppState>) -> Result<()> {
    let rows = load_empty_records(app).await?;
    if rows.is_empty() {
        return Ok(());
    }

    info!(count = rows.len(), "backfill: start");

    let mut resolved = 0usize;
    let mut skipped = 0usize;

    for r in &rows {
        let msg = NotFoundMessage {
            platform: r.platform.clone(),
            platform_id: r.platform_id.clone(),
            client_ip: None,
        };
        match process_with_mode(&msg, app, true).await {
            Ok(true) => resolved += 1,
            Ok(false) => {
                skipped += 1;
                // 打上时间戳，避免同一批失败记录每轮都被反复请求（24h 后再试）
                touch_record(app, r).await;
            }
            Err(e) => {
                skipped += 1;
                warn!(
                    platform = %r.platform,
                    platform_id = %r.platform_id,
                    error = %e,
                    "backfill: record failed"
                );
                touch_record(app, r).await;
            }
        }
    }

    info!(
        total = rows.len(),
        resolved, skipped, "backfill: round finished"
    );
    Ok(())
}

/// 取一批待回填记录
async fn load_empty_records(app: &Arc<AppState>) -> Result<Vec<EmptyRecord>> {
    let sql = r#"SELECT platform, platform_id
        FROM not_found_requests
        WHERE song_name = ''
          AND category = 'not_found'
          AND platform IN ('ncm', 'qq')
          AND created_at > now() - interval '7 days'
          AND (
                updated_at <= created_at + interval '1 second'
                OR updated_at < now() - interval '1 day'
              )
        ORDER BY created_at DESC
        LIMIT $1"#;

    EmptyRecord::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        sql,
        [BACKFILL_BATCH.into()],
    ))
    .all(&app.db)
    .await
    .context("query empty not_found records")
}

/// 仅刷新 updated_at，作为「本轮已尝试」的标记
async fn touch_record(app: &Arc<AppState>, r: &EmptyRecord) {
    let sql =
        "UPDATE not_found_requests SET updated_at = NOW() WHERE platform = $1 AND platform_id = $2";
    if let Err(e) = app
        .db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            sql,
            [r.platform.clone().into(), r.platform_id.clone().into()],
        ))
        .await
    {
        warn!(
            platform = %r.platform,
            platform_id = %r.platform_id,
            error = %e,
            "backfill: touch record failed"
        );
    }
}

async fn acquire_lock(app: &Arc<AppState>) -> Result<bool> {
    let mut conn = app.redis.clone();
    let ok: Option<String> = redis::cmd("SET")
        .arg(BACKFILL_LOCK_KEY)
        .arg("1")
        .arg("NX")
        .arg("EX")
        .arg((BACKFILL_INTERVAL.as_secs() + 120) as u64)
        .query_async(&mut conn)
        .await
        .context("acquire backfill lock")?;
    Ok(ok.is_some())
}

async fn release_lock(app: &Arc<AppState>) {
    let mut conn = app.redis.clone();
    let _: redis::RedisResult<i64> = redis::cmd("DEL")
        .arg(BACKFILL_LOCK_KEY)
        .query_async(&mut conn)
        .await;
}
