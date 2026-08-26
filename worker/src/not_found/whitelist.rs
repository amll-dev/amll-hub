use anyhow::Result;
use redis::aio::ConnectionManager;
use redis::AsyncCommands;

/// 检查是否在白名单（Redis Set 优先）
pub async fn is_in_whitelist(
    conn: &mut ConnectionManager,
    platform: &str,
    platform_id: &str,
) -> Result<bool> {
    let member = format!("{}:{}", platform, platform_id);

    let pure: bool = conn
        .sismember("not_found:pure_music:set", &member)
        .await
        .unwrap_or(false);
    if pure {
        return Ok(true);
    }

    let cloud: bool = conn
        .sismember("not_found:cloud_music:set", &member)
        .await
        .unwrap_or(false);
    Ok(cloud)
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
