use anyhow::{Context, Result};
use serde::Deserialize;

use crate::config::CasdoorConfig;

/// Casdoor 用户（仅取站点 UserInfo 需要的字段）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CasdoorUser {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub avatar: String,
}

#[derive(Debug, Deserialize)]
struct CasdoorResponse {
    #[serde(default)]
    status: String,
    #[serde(default)]
    data: Option<CasdoorUser>,
}

/// Casdoor HTTP 客户端
///
/// 对齐 backend/internal/infrastructure/casdoor.go 的 GetUser：
/// `GET {endpoint}/api/get-user?id={organization}/{name}`，Basic Auth(client_id:client_secret)
pub struct CasdoorClient {
    cfg: CasdoorConfig,
    http: reqwest::Client,
}

impl CasdoorClient {
    pub fn new(cfg: CasdoorConfig) -> Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .context("build casdoor http client")?;
        Ok(Self { cfg, http })
    }

    /// 按用户名查询用户；用户不存在时返回 `Ok(None)`（Casdoor 以 status=error 表示）
    pub async fn get_user(&self, owner: &str, name: &str) -> Result<Option<CasdoorUser>> {
        let url = format!(
            "{}/api/get-user?id={}/{}",
            self.cfg.endpoint.trim_end_matches('/'),
            urlencoding::encode(owner),
            urlencoding::encode(name)
        );
        let resp = self
            .http
            .get(&url)
            .basic_auth(&self.cfg.client_id, Some(&self.cfg.client_secret))
            .send()
            .await
            .with_context(|| format!("请求 Casdoor 用户失败: {}", url))?;

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            anyhow::bail!("Casdoor 返回错误状态: status={} body={}", status, body);
        }

        let parsed: CasdoorResponse = serde_json::from_str(&body)
            .with_context(|| format!("解析 Casdoor 响应失败: {}", body))?;
        if parsed.status != "ok" {
            return Ok(None);
        }
        Ok(parsed.data)
    }
}
