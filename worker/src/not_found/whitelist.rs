use anyhow::{Context, Result};
use redis::aio::ConnectionManager;
use redis::AsyncCommands;

/// 命中的白名单类别
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WhitelistKind {
    PureMusic,
    CloudMusic,
}

impl WhitelistKind {
    /// 写回 not_found_requests.category 时使用的类别名
    pub fn as_category(self) -> &'static str {
        match self {
            WhitelistKind::PureMusic => "pure_music",
            WhitelistKind::CloudMusic => "cloud_music",
        }
    }
}

/// 检查是否在白名单（Redis Set 优先）
///
/// Redis 错误必须上抛：抖动时不能把「已加入白名单」吞成「未命中」，
/// 否则调用方会重复走投稿流程并持续累积脏数据，且没有任何日志指向 Redis。
pub async fn is_in_whitelist(
    conn: &mut ConnectionManager,
    platform: &str,
    platform_id: &str,
) -> Result<Option<WhitelistKind>> {
    let member = format!("{}:{}", platform, platform_id);

    let pure: bool = conn
        .sismember("not_found:pure_music:set", &member)
        .await
        .context("查询纯音乐白名单失败")?;
    if pure {
        return Ok(Some(WhitelistKind::PureMusic));
    }

    let cloud: bool = conn
        .sismember("not_found:cloud_music:set", &member)
        .await
        .context("查询云盘音乐白名单失败")?;
    if cloud {
        return Ok(Some(WhitelistKind::CloudMusic));
    }
    Ok(None)
}

/// 加入纯音乐白名单（同时更新 Redis Set）
pub async fn add_pure_music(
    conn: &mut ConnectionManager,
    platform: &str,
    platform_id: &str,
) -> Result<()> {
    let member = format!("{}:{}", platform, platform_id);
    let _: () = conn.sadd("not_found:pure_music:set", &member).await?;
    Ok(())
}

/// 加入云盘音乐白名单（同时更新 Redis Set）
pub async fn add_cloud_music(
    conn: &mut ConnectionManager,
    platform: &str,
    platform_id: &str,
) -> Result<()> {
    let member = format!("{}:{}", platform, platform_id);
    let _: () = conn.sadd("not_found:cloud_music:set", &member).await?;
    Ok(())
}
