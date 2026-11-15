use std::time::Duration;

use anyhow::Result;
use redis::aio::ConnectionManager;
use tokio::sync::watch;

/// Redis 分布式锁
pub struct SyncLock {
    conn: ConnectionManager,
    key: String,
    value: String,
    ttl_seconds: u64,
    acquired: bool,
    /// 后台续期任务的停止信号；None 表示未启动续期
    renew_stop: Option<watch::Sender<bool>>,
}

impl SyncLock {
    pub fn new(conn: ConnectionManager, key: &str, value: &str, ttl_seconds: u64) -> Self {
        Self {
            conn,
            key: key.to_string(),
            value: value.to_string(),
            ttl_seconds,
            acquired: false,
            renew_stop: None,
        }
    }

    /// 尝试获取锁：SET key value NX EX ttl
    pub async fn try_acquire(&mut self) -> Result<bool> {
        tracing::debug!(key = %self.key, ttl = self.ttl_seconds, "尝试获取 Redis 同步锁");
        let mut conn = self.conn.clone();

        // 使用正确的 Redis SET 命令格式
        let result: Option<String> = redis::cmd("SET")
            .arg(&self.key)
            .arg(&self.value)
            .arg("NX")
            .arg("EX")
            .arg(self.ttl_seconds)
            .query_async(&mut conn)
            .await?;

        let ok = result.is_some();
        self.acquired = ok;
        tracing::debug!(key = %self.key, ok, "获取 Redis 同步锁结果");
        if ok {
            self.spawn_renewal();
        }
        Ok(ok)
    }

    /// 启动后台续期：每隔 TTL/3 用 Lua 校验 value 后 PEXPIRE。
    ///
    /// 首次全量同步（逐文件下载 + Meili 逐批 wait_for_completion）可能超过一小时，
    /// 锁若在 TTL 到期后自动释放，另一个同步任务会拿到同名锁并发写库。
    fn spawn_renewal(&mut self) {
        let (stop_tx, mut stop_rx) = watch::channel(false);
        self.renew_stop = Some(stop_tx);

        let conn = self.conn.clone();
        let key = self.key.clone();
        let value = self.value.clone();
        let ttl_ms = self.ttl_seconds.saturating_mul(1000);
        let interval = Duration::from_secs((self.ttl_seconds / 3).max(1));

        tokio::spawn(async move {
            // value 不匹配时返回 0：锁已经不属于本实例，立即停止续期，不去续别人的锁。
            let script = "if redis.call(\"get\", KEYS[1]) == ARGV[1] then return redis.call(\"pexpire\", KEYS[1], ARGV[2]) else return 0 end";
            let mut ticker = tokio::time::interval(interval);
            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        let mut c = conn.clone();
                        let res: redis::RedisResult<i64> = redis::cmd("EVAL")
                            .arg(script)
                            .arg(1)
                            .arg(&key)
                            .arg(&value)
                            .arg(ttl_ms)
                            .query_async(&mut c)
                            .await;
                        match res {
                            Ok(0) => {
                                tracing::warn!(key = %key, "同步锁已不属于本实例，停止续期");
                                break;
                            }
                            Ok(_) => {}
                            Err(e) => tracing::warn!(key = %key, error = %e, "同步锁续期失败"),
                        }
                    }
                    _ = stop_rx.changed() => break,
                }
            }
        });
    }

    /// 释放锁（仅当 value 匹配时，使用 Lua 脚本原子比较-删除）
    pub async fn release(&mut self) -> Result<()> {
        // 先停掉续期任务，避免刚删完锁又被续期把（别人的）锁续上
        if let Some(stop) = self.renew_stop.take() {
            let _ = stop.send(true);
        }
        if !self.acquired {
            return Ok(());
        }
        let mut conn = self.conn.clone();
        let script = "if redis.call(\"get\", KEYS[1]) == ARGV[1] then return redis.call(\"del\", KEYS[1]) else return 0 end";
        let _: i64 = redis::cmd("EVAL")
            .arg(script)
            .arg(1)
            .arg(&self.key)
            .arg(&self.value)
            .query_async(&mut conn)
            .await?;
        self.acquired = false;
        Ok(())
    }
}

impl Drop for SyncLock {
    fn drop(&mut self) {
        if let Some(stop) = self.renew_stop.take() {
            let _ = stop.send(true);
        }
    }
}
