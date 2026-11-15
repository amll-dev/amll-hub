use anyhow::{Context, Result};
use meilisearch_sdk::client::Client;
use meilisearch_sdk::indexes::Index;
use meilisearch_sdk::settings::Settings;

use crate::config::Config;

/// 初始化 MeiliSearch 客户端并确保索引存在
pub async fn init_meilisearch(cfg: &Config) -> Result<Client> {
    let client = Client::new(&cfg.meilisearch.host, Some(&cfg.meilisearch.api_key))?;

    // 探活
    client.health().await.context("meilisearch health check")?;

    ensure_index(&client, &cfg.meilisearch.index).await?;

    Ok(client)
}

async fn ensure_index(client: &Client, name: &str) -> Result<()> {
    let index: Index = match client.get_index(name).await {
        Ok(idx) => idx,
        Err(_) => {
            let task = client
                .create_index(name, Some("id"))
                .await
                .context("create meilisearch index")?;
            let completed = task
                .wait_for_completion(client, None, None)
                .await
                .context("wait create index")?;
            completed
                .try_make_index(client)
                .map_err(|t| anyhow::anyhow!("make index failed: {:?}", t))?
        }
    };

    let searchable: Vec<&str> = vec![
        "musicNames",
        "musicNamesPinyin",
        "musicNamesInitials",
        "artists",
        "artistsPinyin",
        "artistsInitials",
        "albums",
        "albumsPinyin",
        "albumsInitials",
        "lyricText",
        "platformIds_ncm",
        "platformIds_qq",
        "platformIds_spotify",
        "platformIds_apple",
        "ttmlAuthorGithub",
        "ttmlAuthorGithubLogin",
    ];
    // filterable 需覆盖后端 searchByExactID 的 filter 表达式引用的全部字段
    // （含 ttmlAuthorGithubLogin，否则按 ID 搜索报 502）
    // filterable 必须与 Go 侧 EnsureMeiliSearchIndex 完全一致：
    // 两边启动都会 set_settings，配置不一致时后启动的一方会覆盖前者（方案 §8）。
    let filterable: Vec<&str> = vec![
        "platformIds_ncm",
        "platformIds_qq",
        "platformIds_spotify",
        "platformIds_apple",
        "artists",
        "albums",
        "ttmlAuthorGithub",
        "ttmlAuthorGithubLogin",
        // 索引层预分组：isGroupHead 用于搜索去重，id 用于回捞当前页完整文档，
        // songGroupId 预留给「同组其他版本」查询 / 调试。主键默认不可 filter，须显式声明。
        "songGroupId",
        "isGroupHead",
        "id",
    ];

    let settings = Settings::new()
        .with_searchable_attributes(searchable)
        .with_filterable_attributes(filterable);

    let task = index
        .set_settings(&settings)
        .await
        .context("set meilisearch settings")?;
    task.wait_for_completion(client, None, None)
        .await
        .context("wait set settings")?;

    Ok(())
}
