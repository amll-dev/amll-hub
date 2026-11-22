use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use sea_orm::{ConnectionTrait, DatabaseBackend, FromQueryResult, Statement};
use tokio::sync::watch;
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
pub async fn run_loop(app: Arc<AppState>, mut shutdown: watch::Receiver<bool>) {
    tokio::select! {
        _ = tokio::time::sleep(BACKFILL_STARTUP_DELAY) => {}
        _ = shutdown.changed() => return,
    }

    loop {
        // 每轮循环开头主动检查：backfill_once 可能耗时较长，期间到达的信号
        // 不会丢（watch 保留最新值），下一轮到这里就能看到并退出。
        if *shutdown.borrow() {
            info!("backfill task stopped");
            return;
        }
        if let Err(e) = backfill_once(&app).await {
            error!(error = %e, "backfill round failed");
        }
        tokio::select! {
            _ = tokio::time::sleep(BACKFILL_INTERVAL) => {}
            _ = shutdown.changed() => {
                info!("backfill task stopped");
                return;
            }
        }
    }
}

async fn backfill_once(app: &Arc<AppState>) -> Result<()> {
    // 抢锁时生成 owner token，全程带着它续期 / 释放，避免超时后 DEL 掉别人的锁
    let Some(token) = acquire_lock(app).await? else {
        return Ok(());
    };
    let result = run_batch(app, &token).await;
    release_lock(app, &token).await;
    result
}

async fn run_batch(app: &Arc<AppState>, lock_token: &str) -> Result<()> {
    let rows = load_empty_records(app).await?;
    if rows.is_empty() {
        return Ok(());
    }

    info!(count = rows.len(), "backfill: start");

    let mut resolved = 0usize;
    let mut skipped = 0usize;

    for (i, r) in rows.iter().enumerate() {
        // 一批 200 条串行调用外部 API 可能跑过锁 TTL，每 20 条续期一次
        if i > 0 && i % 20 == 0 {
            renew_lock(app, lock_token).await;
        }
        let msg = NotFoundMessage {
            platform: r.platform.clone(),
            platform_id: r.platform_id.clone(),
            client_ip: None,
        };
        match process_with_mode(&msg, app, true).await {
            // 白名单命中已在 process_with_mode 内把 category 写库，本轮起不再重复占配额
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

/// 取一批待回填记录：按热度优先，热门补全后自然轮到低热度记录
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
        ORDER BY request_count DESC, last_seen_at DESC, created_at DESC
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

/// 抢锁成功时返回 owner token，供续期 / 释放时校验
async fn acquire_lock(app: &Arc<AppState>) -> Result<Option<String>> {
    let mut conn = app.redis.clone();
    let token = uuid::Uuid::new_v4().to_string();
    let ok: Option<String> = redis::cmd("SET")
        .arg(BACKFILL_LOCK_KEY)
        .arg(&token)
        .arg("NX")
        .arg("EX")
        .arg(BACKFILL_INTERVAL.as_secs() + 120)
        .query_async(&mut conn)
        .await
        .context("acquire backfill lock")?;
    Ok(ok.map(|_| token))
}

/// 校验 owner 后给锁续期，避免一批记录串行跑过 TTL 后锁被别人抢走
async fn renew_lock(app: &Arc<AppState>, token: &str) {
    let mut conn = app.redis.clone();
    let script = "if redis.call(\"get\", KEYS[1]) == ARGV[1] then return redis.call(\"pexpire\", KEYS[1], ARGV[2]) else return 0 end";
    let ttl_ms = (BACKFILL_INTERVAL.as_secs() + 120) * 1000;
    let res: redis::RedisResult<i64> = redis::cmd("EVAL")
        .arg(script)
        .arg(1)
        .arg(BACKFILL_LOCK_KEY)
        .arg(token)
        .arg(ttl_ms)
        .query_async(&mut conn)
        .await;
    if let Err(e) = res {
        warn!(error = %e, "backfill: renew lock failed");
    }
}

/// 只有 value 仍等于本实例的 token 才删，避免超时后 DEL 掉别人的锁
async fn release_lock(app: &Arc<AppState>, token: &str) {
    let mut conn = app.redis.clone();
    let script = "if redis.call(\"get\", KEYS[1]) == ARGV[1] then return redis.call(\"del\", KEYS[1]) else return 0 end";
    let res: redis::RedisResult<i64> = redis::cmd("EVAL")
        .arg(script)
        .arg(1)
        .arg(BACKFILL_LOCK_KEY)
        .arg(token)
        .query_async(&mut conn)
        .await;
    if let Err(e) = res {
        warn!(error = %e, "backfill: release lock failed");
    }
}
