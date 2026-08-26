use anyhow::Result;
use redis::aio::ConnectionManager;

/// Redis 分布式锁
pub struct SyncLock {
    conn: ConnectionManager,
    key: String,
    value: String,
    ttl_seconds: u64,
    acquired: bool,
}

impl SyncLock {
    pub fn new(conn: ConnectionManager, key: &str, value: &str, ttl_seconds: u64) -> Self {
        Self {
            conn,
            key: key.to_string(),
            value: value.to_string(),
            ttl_seconds,
            acquired: false,
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
        Ok(ok)
    }

    /// 释放锁（仅当 value 匹配时，使用 Lua 脚本原子比较-删除）
    pub async fn release(&mut self) -> Result<()> {
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
