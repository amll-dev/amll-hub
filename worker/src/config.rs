use std::path::PathBuf;

use serde::Deserialize;

/// 全局配置
#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub database: DatabaseConfig,
    pub redis: RedisConfig,
    pub minio: MinioConfig,
    pub rabbitmq: RabbitMqConfig,
    pub meilisearch: MeiliSearchConfig,
    pub github: GitHubConfig,
    pub worker: WorkerConfig,
    pub ncm: NcmConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub name: String,
    #[serde(default = "default_sslmode")]
    pub sslmode: String,
    #[serde(default = "default_max_open_conns")]
    pub max_open_conns: u32,
    #[serde(default = "default_max_idle_conns")]
    pub max_idle_conns: u32,
}

fn default_sslmode() -> String {
    "disable".to_string()
}
fn default_max_open_conns() -> u32 {
    50
}
fn default_max_idle_conns() -> u32 {
    10
}

impl DatabaseConfig {
    pub fn dsn(&self) -> String {
        format!(
            "postgres://{}:{}@{}:{}/{}?sslmode={}",
            self.user, self.password, self.host, self.port, self.name, self.sslmode
        )
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct RedisConfig {
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub db: u8,
}

impl RedisConfig {
    pub fn url(&self) -> String {
        if self.password.is_empty() {
            format!("redis://{}:{}/{}", self.host, self.port, self.db)
        } else {
            format!(
                "redis://:{}@{}:{}/{}",
                self.password, self.host, self.port, self.db
            )
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct MinioConfig {
    pub endpoint: String,
    pub access_key: String,
    pub secret_key: String,
    pub bucket: String,
    #[serde(default)]
    pub use_ssl: bool,
}

impl MinioConfig {
    pub fn endpoint_url(&self) -> String {
        let scheme = if self.use_ssl { "https" } else { "http" };
        format!("{}://{}", scheme, self.endpoint)
    }
    pub fn region(&self) -> &str {
        "us-east-1"
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct RabbitMqConfig {
    pub url: String,
    pub queue: String,
    #[serde(default = "default_dlq")]
    pub dlq: String,
    #[serde(default = "default_nf_queue")]
    pub nf_queue: String,
    #[serde(default = "default_nf_dlq")]
    pub nf_dlq: String,
}

fn default_dlq() -> String {
    "sync_queue.dlq".to_string()
}
fn default_nf_queue() -> String {
    "not_found_parse_queue".to_string()
}
fn default_nf_dlq() -> String {
    "not_found_parse_queue.dlq".to_string()
}

#[derive(Debug, Clone, Deserialize)]
pub struct MeiliSearchConfig {
    pub host: String,
    pub api_key: String,
    pub index: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GitHubConfig {
    #[serde(default)]
    pub token: String,
    #[serde(default = "default_repo")]
    pub repo: String,
    #[serde(default = "default_branch")]
    pub branch: String,
}

fn default_repo() -> String {
    "amll-dev/amll-ttml-db".to_string()
}
fn default_branch() -> String {
    "main".to_string()
}

impl GitHubConfig {
    pub fn api_commits_url(&self) -> String {
        format!(
            "https://api.github.com/repos/{}/commits/{}",
            self.repo, self.branch
        )
    }
    pub fn raw_url(&self, path: &str) -> String {
        format!(
            "https://raw.githubusercontent.com/{}/{}/{}",
            self.repo, self.branch, path
        )
    }

    /// 首次同步使用的整包 zip URL（github.com /raw/refs/heads/... 形式）
    pub fn raw_lyrics_zip_url(&self) -> String {
        format!(
            "https://github.com/{}/raw/refs/heads/{}/raw-lyrics/raw-lyrics.zip",
            self.repo, self.branch
        )
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkerConfig {
    #[serde(default = "default_concurrency")]
    pub concurrency: usize,
    #[serde(default = "default_batch_size")]
    pub batch_size: usize,
    #[serde(default = "default_lock_ttl")]
    pub sync_lock_ttl: u64,
    #[serde(default = "default_health_port")]
    pub health_port: u16,
    #[serde(default = "default_incremental_threshold")]
    pub incremental_threshold: usize,
}

fn default_concurrency() -> usize {
    20
}
fn default_batch_size() -> usize {
    100
}
fn default_lock_ttl() -> u64 {
    3600
}
fn default_health_port() -> u16 {
    9090
}
fn default_incremental_threshold() -> usize {
    200
}

#[derive(Debug, Clone, Deserialize)]
pub struct NcmConfig {
    pub api_base: String,
}

/// 从当前目录向上查找 .env 文件
fn find_dotenv() -> Option<PathBuf> {
    let mut dir = std::env::current_dir().ok()?;
    loop {
        let candidate = dir.join(".env");
        if candidate.is_file() {
            return Some(candidate);
        }
        let parent = dir.parent()?;
        if parent == dir {
            break;
        }
        dir = parent.to_path_buf();
    }
    None
}

/// 从环境变量加载配置（优先加载当前目录或项目根目录的 .env 文件）
pub fn load() -> anyhow::Result<Config> {
    let dotenv_path = find_dotenv();
    if let Some(ref path) = dotenv_path {
        let _ = dotenvy::from_path(path);
        tracing::info!(path = %path.display(), "加载 .env 文件");
    } else {
        tracing::warn!("未找到 .env 文件，使用默认配置");
    }

    // 先收集所有环境变量
    let mut builder = config::Config::builder();

    // 直接从 env 读取已知 key（不带前缀，匹配 .env.example）
    builder = builder
        .set_override("database.host", env_or("DB_HOST", "localhost"))?
        .set_override(
            "database.port",
            env_or("DB_PORT", "5432").parse::<u16>().unwrap_or(5432),
        )?
        .set_override("database.user", env_or("DB_USER", "ttml"))?
        .set_override("database.password", env_or("DB_PASSWORD", "ttml"))?
        .set_override("database.name", env_or("DB_NAME", "ttml_db"))?
        .set_override("database.sslmode", env_or("DB_SSLMODE", "disable"))?
        .set_override(
            "database.max_open_conns",
            env_or("DB_MAX_OPEN_CONNS", "50")
                .parse::<u32>()
                .unwrap_or(50),
        )?
        .set_override(
            "database.max_idle_conns",
            env_or("DB_MAX_IDLE_CONNS", "10")
                .parse::<u32>()
                .unwrap_or(10),
        )?
        .set_override("redis.host", env_or("REDIS_HOST", "localhost"))?
        .set_override(
            "redis.port",
            env_or("REDIS_PORT", "6379").parse::<u16>().unwrap_or(6379),
        )?
        .set_override("redis.password", env_or("REDIS_PASSWORD", ""))?
        .set_override(
            "redis.db",
            env_or("REDIS_DB", "0").parse::<u8>().unwrap_or(0),
        )?
        .set_override("minio.endpoint", env_or("MINIO_ENDPOINT", "localhost:9000"))?
        .set_override("minio.access_key", env_or("MINIO_ACCESS_KEY", "minioadmin"))?
        .set_override("minio.secret_key", env_or("MINIO_SECRET_KEY", "minioadmin"))?
        .set_override("minio.bucket", env_or("MINIO_BUCKET", "ttml-db"))?
        .set_override(
            "minio.use_ssl",
            parse_bool(&env_or("MINIO_USE_SSL", "false")),
        )?
        .set_override(
            "rabbitmq.url",
            env_or("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/amllhub"),
        )?
        .set_override("rabbitmq.queue", env_or("RABBITMQ_QUEUE", "sync_queue"))?
        .set_override("rabbitmq.dlq", env_or("RABBITMQ_DLQ", "sync_queue.dlq"))?
        .set_override("rabbitmq.nf_queue", env_or("RABBITMQ_NF_QUEUE", "not_found_parse_queue"))?
        .set_override("rabbitmq.nf_dlq", env_or("RABBITMQ_NF_DLQ", "not_found_parse_queue.dlq"))?
        .set_override(
            "meilisearch.host",
            env_or("MEILISEARCH_HOST", "http://localhost:7700"),
        )?
        .set_override("meilisearch.api_key", env_or("MEILISEARCH_API_KEY", ""))?
        .set_override("meilisearch.index", env_or("MEILISEARCH_INDEX", "songs"))?
        .set_override("github.token", env_or("GITHUB_TOKEN", ""))?
        .set_override(
            "github.repo",
            env_or("GITHUB_REPO", "amll-dev/amll-ttml-db"),
        )?
        .set_override("github.branch", env_or("GITHUB_BRANCH", "main"))?
        .set_override(
            "worker.concurrency",
            env_or("WORKER_CONCURRENCY", "20")
                .parse::<i64>()
                .unwrap_or(20),
        )?
        .set_override(
            "worker.batch_size",
            env_or("WORKER_BATCH_SIZE", "100")
                .parse::<i64>()
                .unwrap_or(100),
        )?
        .set_override(
            "worker.sync_lock_ttl",
            env_or("SYNC_LOCK_TTL", "3600")
                .parse::<u64>()
                .unwrap_or(3600),
        )?
        .set_override(
            "worker.health_port",
            env_or("WORKER_HEALTH_PORT", "9090")
                .parse::<u16>()
                .unwrap_or(9090),
        )?
        .set_override(
            "worker.incremental_threshold",
            env_or("INCREMENTAL_THRESHOLD", "200")
                .parse::<i64>()
                .unwrap_or(200),
        )?
        .set_override("ncm.api_base", env_or("NCM_API_BASE", ""))?;

    let cfg = builder.build()?;
    let result: Config = cfg.try_deserialize()?;
    tracing::info!(url = %mask_url_credentials(&result.rabbitmq.url), "RabbitMQ URL");
    Ok(result)
}

/// 遮蔽 URL 中的用户凭证部分
fn mask_url_credentials(url: &str) -> String {
    match url.find("://") {
        Some(scheme_end) => {
            let after_scheme = &url[scheme_end + 3..];
            match after_scheme.find('@') {
                Some(at) => format!("{}://***{}", &url[..scheme_end], &after_scheme[at..]),
                None => url.to_string(),
            }
        }
        None => url.to_string(),
    }
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn parse_bool(s: &str) -> bool {
    matches!(s.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database_config() -> DatabaseConfig {
        DatabaseConfig {
            host: "localhost".to_string(),
            port: 5432,
            user: "ttml".to_string(),
            password: "secret".to_string(),
            name: "ttml_db".to_string(),
            sslmode: "disable".to_string(),
            max_open_conns: 50,
            max_idle_conns: 10,
        }
    }

    #[test]
    fn database_dsn_contains_all_parts() {
        assert_eq!(
            database_config().dsn(),
            "postgres://ttml:secret@localhost:5432/ttml_db?sslmode=disable"
        );
    }

    #[test]
    fn redis_url_without_password() {
        let cfg = RedisConfig {
            host: "localhost".to_string(),
            port: 6379,
            password: String::new(),
            db: 0,
        };
        assert_eq!(cfg.url(), "redis://localhost:6379/0");
    }

    #[test]
    fn redis_url_with_password() {
        let cfg = RedisConfig {
            host: "redis".to_string(),
            port: 6380,
            password: "pass".to_string(),
            db: 2,
        };
        assert_eq!(cfg.url(), "redis://:pass@redis:6380/2");
    }

    #[test]
    fn minio_endpoint_url_respects_ssl_flag() {
        let mut cfg = MinioConfig {
            endpoint: "localhost:9000".to_string(),
            access_key: "ak".to_string(),
            secret_key: "sk".to_string(),
            bucket: "ttml-db".to_string(),
            use_ssl: false,
        };
        assert_eq!(cfg.endpoint_url(), "http://localhost:9000");
        cfg.use_ssl = true;
        assert_eq!(cfg.endpoint_url(), "https://localhost:9000");
    }

    #[test]
    fn github_urls_are_well_formed() {
        let cfg = GitHubConfig {
            token: String::new(),
            repo: "amll-dev/amll-ttml-db".to_string(),
            branch: "main".to_string(),
        };
        assert_eq!(
            cfg.api_commits_url(),
            "https://api.github.com/repos/amll-dev/amll-ttml-db/commits/main"
        );
        assert_eq!(
            cfg.raw_url("metadata/raw-lyrics-index.jsonl"),
            "https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/metadata/raw-lyrics-index.jsonl"
        );
        assert_eq!(
            cfg.raw_lyrics_zip_url(),
            "https://github.com/amll-dev/amll-ttml-db/raw/refs/heads/main/raw-lyrics/raw-lyrics.zip"
        );
    }

    #[test]
    fn mask_url_credentials_hides_userinfo() {
        assert_eq!(
            mask_url_credentials("amqp://guest:guest@localhost:5672/amllhub"),
            "amqp://***@localhost:5672/amllhub"
        );
        // 无凭证时原样返回
        assert_eq!(
            mask_url_credentials("amqp://localhost:5672/amllhub"),
            "amqp://localhost:5672/amllhub"
        );
        // 无 scheme 时原样返回
        assert_eq!(mask_url_credentials("not-a-url"), "not-a-url");
    }

    #[test]
    fn parse_bool_accepts_common_truthy_values() {
        assert!(parse_bool("true"));
        assert!(parse_bool("1"));
        assert!(parse_bool("YES"));
        assert!(parse_bool("On"));
        assert!(!parse_bool("false"));
        assert!(!parse_bool("0"));
        assert!(!parse_bool(""));
    }
}
