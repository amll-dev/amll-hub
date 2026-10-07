use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use reqwest::{Client, Method};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::json;
use tokio::sync::Semaphore;
use tracing::{debug, warn};

use crate::infra::github_app::GithubAppClient;

const API_BASE: &str = "https://api.github.com";
const GRAPHQL_URL: &str = "https://api.github.com/graphql";
const MAX_RETRY: u32 = 5;
const JSON_RETRY: u32 = 3;
const RATE_LIMIT_FLOOR: i64 = 100;
const SEARCH_RATE_LIMIT_FLOOR: i64 = 1;

/// 搜索每页条数（GraphQL / REST 上限均为 100）
const SEARCH_PAGE_SIZE: usize = 100;

#[derive(Debug, Clone, Deserialize)]
pub struct RestUser {
    #[serde(default)]
    pub login: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RestLabel {
    #[serde(default)]
    pub name: String,
}

/// 归一化后的 PR 信息（来源：GET /repos/{repo}/pulls/{number}）
#[derive(Debug, Clone)]
pub struct PrInfo {
    pub number: i64,
    /// PR 标题
    pub title: String,
    pub body: Option<String>,
    /// open / closed
    pub state: String,
    pub merged: bool,
    pub merged_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub closed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub url: String,
    pub author_login: String,
    pub labels: Vec<String>,
    pub head_sha: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PrFile {
    #[serde(default)]
    pub filename: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PrReview {
    #[serde(default)]
    pub user: Option<RestUser>,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub submitted_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct IssueComment {
    #[serde(default)]
    pub user: Option<RestUser>,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TimelineEvent {
    #[serde(default)]
    pub event: String,
    #[serde(default)]
    pub actor: Option<RestUser>,
    #[serde(default)]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    pub label: Option<RestLabel>,
}

#[derive(Deserialize)]
struct RawPull {
    number: i64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    state: String,
    #[serde(default)]
    merged: bool,
    #[serde(default)]
    merged_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    created_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    updated_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    closed_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    html_url: String,
    #[serde(default)]
    user: Option<RestUser>,
    #[serde(default)]
    labels: Vec<RestLabel>,
    #[serde(default)]
    head: Option<RawHead>,
}

#[derive(Deserialize)]
struct RawHead {
    #[serde(default)]
    sha: String,
}

#[derive(Deserialize)]
struct SearchResponse {
    #[serde(default)]
    total_count: i64,
    #[serde(default)]
    items: Vec<SearchItem>,
}

#[derive(Deserialize)]
struct SearchItem {
    number: i64,
    #[serde(default)]
    body: Option<String>,
}

#[derive(Deserialize)]
struct GqlResponse<T> {
    data: Option<T>,
    #[serde(default)]
    errors: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct GqlSearchData {
    search: GqlSearch,
}

#[derive(Deserialize)]
struct GqlSearch {
    #[serde(rename = "pageInfo")]
    page_info: GqlPageInfo,
    #[serde(default)]
    nodes: Vec<GqlNode>,
}

#[derive(Deserialize)]
struct GqlPageInfo {
    #[serde(rename = "hasNextPage")]
    has_next_page: bool,
    #[serde(rename = "endCursor")]
    end_cursor: Option<String>,
}

#[derive(Deserialize)]
struct GqlNode {
    #[serde(default)]
    number: Option<i64>,
}

const PR_SEARCH_QUERY: &str = r#"
query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest { number }
    }
  }
}
"#;

/// 请求鉴权方式
#[derive(Clone, Copy, PartialEq, Eq)]
enum Auth {
    /// GitHub App 安装令牌
    App,
    /// 个人访问令牌（GITHUB_TOKEN）
    Pat,
}

pub struct GithubApi {
    http: Client,
    app: Arc<GithubAppClient>,
    repo: String,
    /// 搜索专用 PAT（GITHUB_TOKEN）
    pat: String,
    /// 请求并发上限（≤10）
    semaphore: Arc<Semaphore>,
}

impl GithubApi {
    pub fn new(
        http: Client,
        app: Arc<GithubAppClient>,
        repo: impl Into<String>,
        pat: impl Into<String>,
        concurrency: usize,
    ) -> Self {
        let limit = concurrency.clamp(1, 10);
        Self {
            http,
            app,
            repo: repo.into(),
            pat: pat.into(),
            semaphore: Arc::new(Semaphore::new(limit)),
        }
    }

    /// 取搜索用令牌；未配置时直接报错。
    fn search_token(&self) -> Result<&str> {
        let token = self.pat.trim();
        if token.is_empty() {
            anyhow::bail!(
                "未配置 GITHUB_TOKEN：GitHub 在 App 安装令牌下不返回 PR 搜索结果，无法发现投稿，请在 .env 配置 GITHUB_TOKEN 后重试"
            );
        }
        Ok(token)
    }

    // ===== 内部请求 =====

    /// 发送带鉴权与限流退避的请求
    async fn request(
        &self,
        method: Method,
        url: &str,
        accept: Option<&str>,
        body: Option<serde_json::Value>,
        auth: Auth,
    ) -> Result<reqwest::Response> {
        let mut attempt: u32 = 0;
        loop {
            attempt += 1;
            let _permit = self
                .semaphore
                .acquire()
                .await
                .context("acquire github request permit")?;
            let token = match auth {
                Auth::App => self.app.installation_token().await?,
                Auth::Pat => self.search_token()?.to_string(),
            };

            let mut req = self
                .http
                .request(method.clone(), url)
                .header("Authorization", format!("Bearer {}", token))
                .header("Accept", accept.unwrap_or("application/vnd.github+json"))
                .header("X-GitHub-Api-Version", "2022-11-28")
                .header("User-Agent", "amll-ttml-worker");
            if let Some(ref payload) = body {
                req = req.json(payload);
            }

            let resp = req
                .send()
                .await
                .with_context(|| format!("GitHub 请求失败: {} {}", method, url))?;

            // 低配额保护：剩余不足则暂停至 reset。
            let resource = resp
                .headers()
                .get("x-ratelimit-resource")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("core");
            let floor = if resource == "search" {
                SEARCH_RATE_LIMIT_FLOOR
            } else {
                RATE_LIMIT_FLOOR
            };
            if let Some(remaining) = header_i64(&resp, "x-ratelimit-remaining")
                && remaining < floor
                && let Some(reset) = header_i64(&resp, "x-ratelimit-reset")
            {
                let wait = (reset - chrono::Utc::now().timestamp()).max(1) as u64;
                warn!(
                    resource,
                    remaining,
                    wait_secs = wait,
                    "GitHub 剩余配额不足，暂停至配额重置"
                );
                tokio::time::sleep(Duration::from_secs(wait.min(300))).await;
            }

            if resp.status().is_success() {
                return Ok(resp);
            }

            let status = resp.status();
            let retry_after = header_i64(&resp, "retry-after").map(|v| v as u64);
            let body_text = resp.text().await.unwrap_or_default();

            let secondary = body_text.contains("secondary rate limit")
                || body_text.contains("API rate limit exceeded");
            let retryable = status.as_u16() == 429
                || (status.as_u16() == 403 && (secondary || retry_after.is_some()))
                || status.is_server_error();

            if retryable && attempt < MAX_RETRY {
                let delay = retry_after.unwrap_or(60 * attempt as u64).min(300);
                warn!(
                    status = %status,
                    attempt,
                    delay_secs = delay,
                    "GitHub 请求受限，退避重试"
                );
                tokio::time::sleep(Duration::from_secs(delay)).await;
                continue;
            }

            anyhow::bail!(
                "GitHub 请求失败: {} {} status={} body={}",
                method,
                url,
                status,
                truncate(&body_text, 500)
            );
        }
    }

    async fn get_json<T: DeserializeOwned>(&self, path: &str, accept: Option<&str>) -> Result<T> {
        self.get_json_with(Auth::App, path, accept).await
    }

    async fn get_json_with<T: DeserializeOwned>(
        &self,
        auth: Auth,
        path: &str,
        accept: Option<&str>,
    ) -> Result<T> {
        let url = format!("{}{}", API_BASE, path);
        self.request_json(Method::GET, &url, accept, None, auth)
            .await
            .with_context(|| format!("解析 GitHub 响应失败: {}", url))
    }

    /// 请求并解码 JSON：`request()` 里的重试只覆盖状态码类失败
    async fn request_json<T: DeserializeOwned>(
        &self,
        method: Method,
        url: &str,
        accept: Option<&str>,
        body: Option<serde_json::Value>,
        auth: Auth,
    ) -> Result<T> {
        let mut last_err: Option<anyhow::Error> = None;
        for attempt in 1..=JSON_RETRY {
            let resp = self
                .request(method.clone(), url, accept, body.clone(), auth)
                .await?;
            match resp.json::<T>().await {
                Ok(parsed) => return Ok(parsed),
                Err(e) => {
                    warn!(url, attempt, error = %e, "读取 GitHub 响应失败，重试");
                    last_err = Some(anyhow::Error::new(e));
                }
            }
            if attempt < JSON_RETRY {
                tokio::time::sleep(Duration::from_secs(2 * attempt as u64)).await;
            }
        }
        Err(last_err.unwrap_or_else(|| anyhow::anyhow!("读取 GitHub 响应失败: {}", url)))
    }

    async fn patch_json(&self, path: &str, body: serde_json::Value) -> Result<()> {
        let url = format!("{}{}", API_BASE, path);
        self.request(Method::PATCH, &url, None, Some(body), Auth::App)
            .await?;
        Ok(())
    }

    async fn post_json(&self, path: &str, body: serde_json::Value) -> Result<()> {
        let url = format!("{}{}", API_BASE, path);
        self.request(Method::POST, &url, None, Some(body), Auth::App)
            .await?;
        Ok(())
    }

    // ===== PR 发现 =====
    pub async fn search_pr_numbers_by_author(&self, login: &str, since: i64) -> Result<Vec<i64>> {
        let q = format!(
            "repo:{} type:pr author:{} sort:created-desc",
            self.repo, login
        );
        let mut numbers = Vec::new();
        let mut after: Option<String> = None;
        let mut truncated = false;

        loop {
            let variables = json!({ "q": q, "after": after });
            let payload = json!({ "query": PR_SEARCH_QUERY, "variables": variables });
            let url = GRAPHQL_URL.to_string();
            let parsed: GqlResponse<GqlSearchData> = self
                .request_json(Method::POST, &url, None, Some(payload), Auth::Pat)
                .await
                .context("解析 GitHub GraphQL 搜索响应失败")?;

            if let Some(errors) = parsed.errors {
                anyhow::bail!("GitHub GraphQL 搜索返回错误: {}", truncate(&errors.to_string(), 300));
            }
            let search = parsed
                .data
                .ok_or_else(|| anyhow::anyhow!("GitHub GraphQL 搜索无数据"))?
                .search;

            let node_count = search.nodes.len();
            let mut reached_cutoff = false;
            for node in search.nodes {
                let Some(number) = node.number else { continue };
                if number < since {
                    reached_cutoff = true;
                    break;
                }
                numbers.push(number);
            }

            if reached_cutoff || !search.page_info.has_next_page {
                break;
            }
            if node_count < SEARCH_PAGE_SIZE {
                break;
            }
            match search.page_info.end_cursor {
                Some(cursor) => after = Some(cursor),
                None => break,
            }
            // GitHub 搜索最多返回 1000 条，达到上限时记录并停止
            if numbers.len() >= 1000 {
                truncated = true;
                break;
            }
        }

        if truncated {
            warn!(
                login,
                count = numbers.len(),
                "GraphQL 搜索结果达到 1000 条上限，可能存在遗漏"
            );
        }
        Ok(numbers)
    }

    /// 来源 B：搜索由 github-actions[bot] 代提交、且正文提及该用户的 PR
    pub async fn search_bot_pr_numbers(&self, login: &str, since: i64) -> Result<Vec<i64>> {
        let q = format!(
            "repo:{} is:pr author:app/github-actions {} in:body",
            self.repo, login
        );
        let mut numbers = Vec::new();
        let mut page: u32 = 1;
        loop {
            let path = format!(
                "/search/issues?q={}&sort=created&order=desc&per_page={}&page={}",
                urlencoding::encode(&q),
                SEARCH_PAGE_SIZE,
                page
            );
            let resp: SearchResponse = self.get_json_with(Auth::Pat, &path, None).await?;
            if page == 1 {
                debug!(total_count = resp.total_count, "bot 代提交 PR 搜索命中数");
            }
            if resp.items.is_empty() {
                break;
            }
            let item_count = resp.items.len();
            let mut reached_cutoff = false;
            for item in resp.items {
                if item.number < since {
                    reached_cutoff = true;
                    break;
                }
                // 精确校验：正文必须含「歌词作者 @本用户」标注
                let body = item.body.unwrap_or_default();
                if body_mentions_author(&body, login) {
                    numbers.push(item.number);
                }
            }
            if reached_cutoff || item_count < SEARCH_PAGE_SIZE || page >= 10 {
                break;
            }
            page += 1;
        }
        Ok(numbers)
    }

    // ===== PR 明细 =====

    pub async fn get_pr(&self, number: i64) -> Result<PrInfo> {
        let path = format!("/repos/{}/pulls/{}", self.repo, number);
        let raw: RawPull = self.get_json(&path, None).await?;
        let now = chrono::Utc::now();
        Ok(PrInfo {
            number: raw.number,
            title: raw.title,
            body: raw.body,
            state: raw.state,
            merged: raw.merged,
            merged_at: raw.merged_at,
            created_at: raw.created_at.unwrap_or(now),
            updated_at: raw.updated_at.unwrap_or(now),
            closed_at: raw.closed_at,
            url: raw.html_url,
            author_login: raw.user.map(|u| u.login).unwrap_or_default(),
            labels: raw.labels.into_iter().map(|l| l.name).collect(),
            head_sha: raw.head.map(|h| h.sha).unwrap_or_default(),
        })
    }

    pub async fn list_pr_files(&self, number: i64) -> Result<Vec<PrFile>> {
        let path = format!(
            "/repos/{}/pulls/{}/files?per_page={}",
            self.repo, number, SEARCH_PAGE_SIZE
        );
        self.get_json(&path, None).await
    }

    pub async fn list_pr_reviews(&self, number: i64) -> Result<Vec<PrReview>> {
        let path = format!(
            "/repos/{}/pulls/{}/reviews?per_page={}",
            self.repo, number, SEARCH_PAGE_SIZE
        );
        self.get_json(&path, None).await
    }

    pub async fn list_issue_comments(&self, number: i64) -> Result<Vec<IssueComment>> {
        let path = format!(
            "/repos/{}/issues/{}/comments?per_page={}",
            self.repo, number, SEARCH_PAGE_SIZE
        );
        self.get_json(&path, None).await
    }

    pub async fn list_timeline(&self, number: i64) -> Result<Vec<TimelineEvent>> {
        let path = format!(
            "/repos/{}/issues/{}/timeline?per_page={}",
            self.repo, number, SEARCH_PAGE_SIZE
        );
        self.get_json(&path, None).await
    }

    /// 下载仓库中指定路径、指定 ref 的文件原始内容
    pub async fn download_file(&self, path: &str, git_ref: &str) -> Result<Vec<u8>> {
        let url = format!(
            "{}/repos/{}/contents/{}?ref={}",
            API_BASE,
            self.repo,
            path,
            urlencoding::encode(git_ref)
        );
        let resp = self
            .request(
                Method::GET,
                &url,
                Some("application/vnd.github.raw"),
                None,
                Auth::App,
            )
            .await?;
        let bytes = resp.bytes().await.context("读取 GitHub 文件内容失败")?;
        Ok(bytes.to_vec())
    }

    // ===== 关闭 PR / 评论 =====

    pub async fn close_pr(&self, number: i64) -> Result<()> {
        let path = format!("/repos/{}/pulls/{}", self.repo, number);
        self.patch_json(&path, json!({ "state": "closed" })).await
    }

    pub async fn create_issue_comment(&self, number: i64, body: &str) -> Result<()> {
        let path = format!("/repos/{}/issues/{}/comments", self.repo, number);
        self.post_json(&path, json!({ "body": body })).await
    }
}

/// 判断 PR 正文是否以「歌词作者 @login」形式标注了该用户（大小写不敏感精确匹配）
pub fn body_mentions_author(body: &str, login: &str) -> bool {
    extract_body_authors(body)
        .iter()
        .any(|author| author.eq_ignore_ascii_case(login))
}

/// 解析 PR 正文中所有「歌词作者 @xxx」标注
pub fn extract_body_authors(body: &str) -> Vec<String> {
    const KEY: &str = "歌词作者";
    let mut authors = Vec::new();
    let mut rest = body;
    while let Some(idx) = rest.find(KEY) {
        let after = &rest[idx + KEY.len()..];
        let trimmed = after.trim_start();
        if let Some(stripped) = trimmed.strip_prefix('@') {
            let login: String = stripped
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
                .collect();
            if !login.is_empty() {
                authors.push(login);
            }
        }
        // KEY 已被剥离，rest 严格变短，循环必然推进
        rest = after;
    }
    authors
}

fn header_i64(resp: &reqwest::Response, name: &str) -> Option<i64> {
    resp.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<i64>().ok())
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    s.chars().take(max).collect::<String>() + "..."
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_author_annotation() {
        let body = "本 PR 由 bot 代提交\n\n（歌词作者 @Pigeon0v0）";
        assert_eq!(extract_body_authors(body), vec!["Pigeon0v0".to_string()]);
        assert!(body_mentions_author(body, "pigeon0v0"));
        assert!(!body_mentions_author(body, "Pigeon"));
    }

    #[test]
    fn annotation_requires_exact_login_boundary() {
        let body = "（歌词作者 @abcd）";
        assert!(!body_mentions_author(body, "abc"));
        assert!(body_mentions_author(body, "abcd"));
    }

    #[test]
    fn ignores_mentions_without_keyword() {
        let body = "感谢 @apoint123 的贡献";
        assert!(extract_body_authors(body).is_empty());
        assert!(!body_mentions_author(body, "apoint123"));
    }

    #[test]
    fn supports_hyphenated_login_and_whitespace() {
        let body = "（歌词作者  @some-user ）";
        assert_eq!(extract_body_authors(body), vec!["some-user".to_string()]);
    }

    #[test]
    fn handles_multiple_annotations() {
        let body = "（歌词作者 @a1）\n（歌词作者 @b2）";
        assert_eq!(
            extract_body_authors(body),
            vec!["a1".to_string(), "b2".to_string()]
        );
    }
}
