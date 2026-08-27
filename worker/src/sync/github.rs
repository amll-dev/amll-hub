use anyhow::{Context, Result};
use reqwest::Client;
use serde::Deserialize;
use tracing::{info, warn};

use crate::config::GitHubConfig;

/// 下载重试基础退避
const RETRY_BASE_DELAY: std::time::Duration = std::time::Duration::from_secs(2);

/// 下载重试退避上限
const RETRY_MAX_DELAY: std::time::Duration = std::time::Duration::from_secs(60);

/// 带指数退避的无限重试包装：不成功不返回，阻断流程直到下载成功
async fn with_retry<T, F, Fut>(ctx: &str, f: F) -> Result<T>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T>>,
{
    let mut attempt: u32 = 1;
    loop {
        match f().await {
            Ok(v) => {
                if attempt > 1 {
                    info!(ctx, attempt, "下载重试成功");
                }
                return Ok(v);
            }
            Err(e) => {
                let delay = (RETRY_BASE_DELAY * 2u32.saturating_pow(attempt - 1)).min(RETRY_MAX_DELAY);
                warn!(
                    ctx,
                    attempt,
                    delay_secs = delay.as_secs(),
                    error = %e,
                    "下载失败，无限重试直到成功"
                );
                tokio::time::sleep(delay).await;
                attempt += 1;
            }
        }
    }
}

/// GitHub commits API 响应（仅关心的字段）
#[derive(Debug, Deserialize)]
pub struct CommitResponse {
    pub sha: String,
}

/// 给请求加上 token（若配置了）
fn with_auth(mut req: reqwest::RequestBuilder, cfg: &GitHubConfig) -> reqwest::RequestBuilder {
    if !cfg.token.is_empty() {
        req = req.bearer_auth(&cfg.token);
    }
    req
}

/// 发送带认证的 GitHub GET 请求，非 2xx 时返回带响应体的错误
async fn send_github_get(
    client: &Client,
    url: &str,
    accept: Option<&str>,
    cfg: &GitHubConfig,
    ctx: &str,
) -> Result<reqwest::Response> {
    let req = client.get(url).header("User-Agent", "amll-ttml-worker");
    let req = match accept {
        Some(accept) => req.header("Accept", accept),
        None => req,
    };
    let req = with_auth(req, cfg);
    let resp = req.send().await.with_context(|| format!("{}: {}", ctx, url))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("{} {} status {}: {}", ctx, url, status, body);
    }
    Ok(resp)
}

/// 获取远程最新 commit hash
pub async fn fetch_latest_commit(client: &Client, cfg: &GitHubConfig) -> Result<String> {
    let resp = send_github_get(
        client,
        &cfg.api_commits_url(),
        Some("application/vnd.github+json"),
        cfg,
        "github api",
    )
    .await?;
    let parsed: CommitResponse = resp.json().await.context("parse github commits response")?;
    if parsed.sha.is_empty() {
        anyhow::bail!("empty commit sha from github");
    }
    Ok(parsed.sha)
}

/// 下载 raw 文本（
pub async fn download_raw_text(client: &Client, url: &str, cfg: &GitHubConfig) -> Result<String> {
    with_retry("download raw text", move || async move {
        let resp = send_github_get(client, url, None, cfg, "download raw").await?;
        let text = resp.text().await.context("read raw text")?;
        Ok(text)
    })
    .await
}

/// 下载 TTML 文件原始字节，带 token，失败无限重试直到成功
pub async fn download_raw_bytes(client: &Client, url: &str, cfg: &GitHubConfig) -> Result<Vec<u8>> {
    with_retry("download raw bytes", move || async move {
        let resp = send_github_get(client, url, None, cfg, "download bytes").await?;
        let bytes = resp.bytes().await.context("read raw bytes")?;
        Ok(bytes.to_vec())
    })
    .await
}

/// 下载整包 zip
pub async fn download_zip(client: &Client, cfg: &GitHubConfig) -> Result<Vec<u8>> {
    with_retry("download zip", move || async move {
        let resp = send_github_get(
            client,
            &cfg.raw_lyrics_zip_url(),
            None,
            cfg,
            "download zip",
        )
        .await?;
        let bytes = resp.bytes().await.context("read zip bytes")?;
        Ok(bytes.to_vec())
    })
    .await
}
