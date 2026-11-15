use anyhow::{Context, Result};
use sea_orm::{ConnectOptions, Database};

use crate::config::Config;

/// 初始化 PostgreSQL 连接池
pub async fn init_postgres(cfg: &Config) -> Result<sea_orm::DatabaseConnection> {
    let mut opt = ConnectOptions::new(cfg.database.dsn());
    opt.max_connections(cfg.database.max_open_conns);
    // min_connections 语义是「至少维持」，不是「最多空闲」；用独立配置项，
    // 不再误填 max_idle_conns（否则常驻 10 条空闲连接永不回收，且越界会建池 panic）。
    opt.min_connections(cfg.database.min_connections);
    opt.sqlx_logging(false);
    let db = Database::connect(opt).await.context("connect postgres")?;
    Ok(db)
}
