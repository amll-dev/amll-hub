use anyhow::{Context, Result};
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::config::GitHubAppConfig;

/// GitHub App 客户端：RS256 签发 App JWT → 换取 installation access token → 内存缓存
///
/// 逻辑对齐后端 backend/internal/infrastructure/github_app.go：
/// - App JWT 有效期 ≤ 10 分钟（iss = AppID）
/// - 安装令牌在过期前 5 分钟自动刷新
pub struct GithubAppClient {
    cfg: GitHubAppConfig,
    key: Option<EncodingKey>,
    http: reqwest::Client,
    cached: Mutex<Option<CachedToken>>,
}

struct CachedToken {
    token: String,
    expires_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize)]
struct AppClaims {
    iat: i64,
    exp: i64,
    iss: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    token: String,
    expires_at: chrono::DateTime<chrono::Utc>,
}

impl GithubAppClient {
    /// 创建客户端：私钥缺失或不可读时返回错误（调用方据此决定是否启用迁移功能）
    pub fn new(cfg: GitHubAppConfig) -> Result<Self> {
        let key = if cfg.private_key_path.is_empty() {
            None
        } else {
            let pem = std::fs::read(&cfg.private_key_path)
                .with_context(|| format!("读取 GitHub App 私钥失败: {}", cfg.private_key_path))?;
            let key =
                EncodingKey::from_rsa_pem(&pem).context("解析 GitHub App RSA 私钥失败（需 PEM 格式）")?;
            Some(key)
        };

        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .context("build github app http client")?;

        Ok(Self {
            cfg,
            key,
            http,
            cached: Mutex::new(None),
        })
    }

    /// 是否可用（AppID / InstallationID / 私钥均就绪）
    pub fn enabled(&self) -> bool {
        self.cfg.app_id != 0 && self.cfg.installation_id != 0 && self.key.is_some()
    }

    /// 获取 installation access token（带缓存，过期前 5 分钟刷新）
    pub async fn installation_token(&self) -> Result<String> {
        if !self.enabled() {
            anyhow::bail!(
                "GitHub App 未配置：需要 GITHUB_APP_ID / GITHUB_INSTALLATION_ID / GITHUB_PRIVATE_KEY_PATH"
            );
        }

        let mut guard = self.cached.lock().await;
        if let Some(cached) = guard.as_ref()
            && chrono::Utc::now() < cached.expires_at - chrono::Duration::minutes(5)
        {
            return Ok(cached.token.clone());
        }

        let jwt = self.app_jwt()?;
        let url = format!(
            "https://api.github.com/app/installations/{}/access_tokens",
            self.cfg.installation_id
        );
        let resp = self
            .http
            .post(&url)
            .header("Authorization", format!("Bearer {}", jwt))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "amll-ttml-worker")
            .send()
            .await
            .context("请求 GitHub installation token 失败")?;

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            anyhow::bail!(
                "换取 GitHub installation token 失败: status={} body={}",
                status,
                body
            );
        }

        let parsed: TokenResponse =
            serde_json::from_str(&body).context("解析 installation token 响应失败")?;
        if parsed.token.is_empty() {
            anyhow::bail!("GitHub installation token 为空");
        }

        *guard = Some(CachedToken {
            token: parsed.token.clone(),
            expires_at: parsed.expires_at,
        });
        Ok(parsed.token)
    }

    /// 签发 GitHub App JWT（iat 回拨 60s，exp 9 分钟）
    fn app_jwt(&self) -> Result<String> {
        let key = self
            .key
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("GitHub App 私钥未加载"))?;
        let now = chrono::Utc::now().timestamp();
        let claims = AppClaims {
            iat: now - 60,
            exp: now + 9 * 60,
            iss: self.cfg.app_id.to_string(),
        };
        let header = Header::new(Algorithm::RS256);
        jsonwebtoken::encode(&header, &claims, key).context("签发 GitHub App JWT 失败")
    }
}
