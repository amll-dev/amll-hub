package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/spf13/viper"
	"github.com/subosito/gotenv"
)

// Config 全局配置
type Config struct {
	HTTP         HTTPConfig
	Database     DatabaseConfig
	Redis        RedisConfig
	MinIO        MinIOConfig
	RabbitMQ     RabbitMQConfig
	MeiliSearch  MeiliSearchConfig
	Search       SearchConfig
	GitHub       GitHubConfig
	GitHubApp    GitHubAppConfig
	GitHubOAuth  GitHubOAuthConfig
	Migration    MigrationConfig
	Sync         SyncConfig
	NCM          NCMConfig
	QM           QMConfig
	OnlineSearch OnlineSearchConfig
	Casdoor      CasdoorConfig
	MFA          MFAConfig
	Submission   SubmissionConfig
	PluginStore  PluginStoreConfig
	Worker       WorkerConfig
	Email        EmailConfig
	QQBot        QQBotConfig
	AliyunPNVS   AliyunPNVSConfig
	Security     SecurityConfig
	ServiceToken string
}

// AliyunPNVSConfig 阿里云号码认证服务（本机号码一键登录）配置
type AliyunPNVSConfig struct {
	AccessKeyID     string
	AccessKeySecret string
	// SceneCode H5 认证方案的场景码
	SceneCode string
	RegionID  string
}

// Enabled 是否已配置一键登录所需凭据，未配置时按功能关闭处理
func (c AliyunPNVSConfig) Enabled() bool {
	return c.AccessKeyID != "" && c.AccessKeySecret != "" && c.SceneCode != ""
}

// SecurityConfig 登录安全提示配置
type SecurityConfig struct {
	// LoginNotifyEnabled 是否在登录成功后返回新设备/异地登录提示
	LoginNotifyEnabled bool
	// IPDBFile ipip.net IP 库路径（17mon .dat 或 ipdb .ipdb），
	// 默认使用仓库内 backend/data/ipipfree.ipdb；留空时退化为网段判定
	IPDBFile string
}

type HTTPConfig struct {
	Port string
}

// MFAConfig 二次认证开关
type MFAConfig struct {
	// SetupEnabled 是否允许用户新开启二次认证。
	// Casdoor 的 MFA 会话链路异常期间置 false，仅禁止新开启，已开启的因子仍可关闭。
	SetupEnabled bool
}

type DatabaseConfig struct {
	Host         string
	Port         string
	User         string
	Password     string
	Name         string
	SSLMode      string
	MaxOpenConns int
	MaxIdleConns int
}

func (d DatabaseConfig) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s TimeZone=Asia/Shanghai",
		d.Host, d.Port, d.User, d.Password, d.Name, d.SSLMode,
	)
}

type RedisConfig struct {
	Host     string
	Port     string
	Password string
	DB       int
}

func (r RedisConfig) Addr() string {
	return fmt.Sprintf("%s:%s", r.Host, r.Port)
}

type MinIOConfig struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
	UseSSL    bool
}

type RabbitMQConfig struct {
	URL   string
	Queue string
	DLQ   string
}

type MeiliSearchConfig struct {
	Host   string
	APIKey string
	Index  string
}

// SearchConfig 搜索相关配置
type SearchConfig struct {
	// GroupFilter 是否启用索引层预分组（搜索时追加 isGroupHead = true 过滤）。
	// 关闭时退回「不按组去重」的直出行为，用于灰度/回滚。
	// 依赖前置：索引必须先由 Worker 回填 songGroupId / isGroupHead 字段，
	// 否则带该 filter 的查询会返回 invalid_search_filter 或空结果。
	GroupFilter bool
}

type GitHubConfig struct {
	Token  string
	Repo   string
	Branch string
}

type SyncConfig struct {
	// Cron 兜底检查间隔（秒）
	CronIntervalSec int
}

type NCMConfig struct {
	APIBase string
	MusicU  string
}

// QMConfig
type QMConfig struct {
	Cookie    string
	CookieKey string
}

type OnlineSearchConfig struct {
	TimeoutSec int // 单平台搜索超时（秒）
}

type CasdoorConfig struct {
	Endpoint         string
	ClientID         string
	ClientSecret     string
	Organization     string
	Application      string
	ApplicationOwner string
	JWTSecret        string
	JWTTTL           time.Duration
}

// GitHubAppConfig GitHub App 配置
type GitHubAppConfig struct {
	AppID          int64
	InstallationID int64
	PrivateKeyPath string
	RepoOwner      string
	RepoName       string
	UploadFolder   string
}

// GitHubOAuthConfig 自建 GitHub OAuth 登录配置
type GitHubOAuthConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURI  string
	// SiteURL 前端站点地址，OAuth 回调后跳转目标
	SiteURL string
}

// Enabled 是否已配置 GitHub OAuth
func (c GitHubOAuthConfig) Enabled() bool {
	return c.ClientID != "" && c.ClientSecret != ""
}

// MigrationConfig 投稿数据迁移配置（后端只负责创建任务与投递消息）
type MigrationConfig struct {
	// Exchange 迁移交换机（ttml.migration）
	Exchange string
	// Queue migration.user 队列
	Queue string
	// DLQ migration.user.dlq
	DLQ string
	// CloseQueue migration.close_pr 队列
	CloseQueue string
	// CloseDLQ migration.close_pr.dlq
	CloseDLQ string
	// StartPrNumber 迁移起始 PR 号（含）
	StartPrNumber int
	// RepoOwner / RepoName 迁移来源仓库
	RepoOwner string
	RepoName  string
}

// SubmissionConfig 投稿模块配置
type SubmissionConfig struct {
	// AutoRejectInterval 自动拒绝任务执行间隔
	AutoRejectInterval time.Duration
	// AutoRejectAfter need_revision 状态超过该时长自动拒绝
	AutoRejectAfter time.Duration
	// ReviewerCacheTTL 审核员名单内存缓存 TTL
	ReviewerCacheTTL time.Duration
	// ReviewLeaseTTL 审核占用租约时长：超时未收到心跳则回退为待审核
	ReviewLeaseTTL time.Duration
	// ReviewLeaseInterval 审核占用租约清理任务执行间隔
	ReviewLeaseInterval time.Duration
	// MaxTTMLSize 单个 TTML 文件最大字节数
	MaxTTMLSize int64
	// MaxAudioSize 单个音频文件最大字节数
	MaxAudioSize int64
	// MaxImageSize 单个封面图最大字节数
	MaxImageSize int64
}

// PluginStoreConfig 插件商店配置
type PluginStoreConfig struct {
	Bucket string

	MaxArtifactBytes int64 // 48 MiB
	MaxUnpackedBytes int64 // 64 MiB
	MaxEntryBytes    int64 // 33 MiB
	MaxManifestBytes int64 // 4 MiB
	MaxEntries       int   // 64
	MaxIconBytes     int64 // 256 KiB

	CatalogCacheTTL time.Duration
	MaxCatalogItems int
	MaxCatalogBytes int64

	ReservedIDs []string
}

// Worker 服务配置
type WorkerConfig struct {
	// Worker 地址
	BaseURL string
}

// QQBotConfig QQ 官方机器人配置（内嵌在 API 进程内运行）
type QQBotConfig struct {
	// AppID / ClientSecret 开放平台机器人凭据
	AppID        string
	ClientSecret string
	// Sandbox 是否连接沙箱环境
	Sandbox bool
	// Intents 事件订阅位，默认 GROUP_AND_C2C_EVENT
	Intents int
	// SiteURL 站点地址，用于拼接歌词/推荐/排行榜详情链接
	SiteURL string
	// Markdown 是否优先使用 Markdown 消息（不支持时自动回退纯文本）
	Markdown bool
	// FontPath 每日推荐卡片使用的中文字体路径，留空自动查找系统字体
	FontPath string
}

// Enabled 是否已配置机器人凭据
func (c QQBotConfig) Enabled() bool {
	return c.AppID != "" && c.ClientSecret != ""
}

// EmailConfig 邮件通知配置
type EmailConfig struct {
	// Enabled 总开关，关闭时不查邮箱也不发信
	Enabled bool
	// Host / Port SMTP 服务器；Port 465 走隐式 TLS，其余端口走 STARTTLS
	Host string
	Port int
	// Username / Password SMTP 账号密码（Password 为空则不鉴权）
	Username string
	Password string
	// From 发件地址，FromName 发件人显示名
	From     string
	FromName string
	// SiteURL 站点地址，邮件里的稿件详情链接基于它拼接
	SiteURL string
	// EmailCacheTTL 用户名→邮箱的缓存时长，避免每次审核都查 Casdoor
	EmailCacheTTL time.Duration
	// TimeoutSec 单次发送超时（秒）
	TimeoutSec int
}

// splitCSV 把逗号分隔的环境变量拆成去空白的字符串列表
func splitCSV(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if v := strings.TrimSpace(part); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// findDotEnv查找 .env 文件
func findDotEnv() string {
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for {
		path := filepath.Join(dir, ".env")
		if _, err := os.Stat(path); err == nil {
			return path
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

// Load 从环境变量加载配置
func Load() (*Config, error) {
	if dotenv := findDotEnv(); dotenv != "" {
		if err := gotenv.Load(dotenv); err != nil {
			logrus.Warnf("load .env file %s: %v", dotenv, err)
		}
	}

	v := viper.New()
	v.AutomaticEnv()
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

	// HTTP
	v.SetDefault("PORT", "8080")

	// DB
	v.SetDefault("DB_HOST", "localhost")
	v.SetDefault("DB_PORT", "5432")
	v.SetDefault("DB_USER", "ttml")
	v.SetDefault("DB_PASSWORD", "ttml")
	v.SetDefault("DB_NAME", "ttml_db")
	v.SetDefault("DB_SSLMODE", "disable")
	v.SetDefault("DB_MAX_OPEN_CONNS", 50)
	v.SetDefault("DB_MAX_IDLE_CONNS", 10)

	// Redis
	v.SetDefault("REDIS_HOST", "localhost")
	v.SetDefault("REDIS_PORT", "6379")
	v.SetDefault("REDIS_PASSWORD", "")
	v.SetDefault("REDIS_DB", 0)

	// MinIO
	v.SetDefault("MINIO_ENDPOINT", "localhost:9000")
	v.SetDefault("MINIO_ACCESS_KEY", "minioadmin")
	v.SetDefault("MINIO_SECRET_KEY", "minioadmin")
	v.SetDefault("MINIO_BUCKET", "ttml-db")
	v.SetDefault("MINIO_USE_SSL", false)

	// RabbitMQ
	v.SetDefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")
	v.SetDefault("RABBITMQ_QUEUE", "sync_queue")
	v.SetDefault("RABBITMQ_DLQ", "sync_queue.dlq")

	// MeiliSearch
	v.SetDefault("MEILISEARCH_HOST", "http://localhost:7700")
	v.SetDefault("MEILISEARCH_API_KEY", "")
	v.SetDefault("MEILISEARCH_INDEX", "songs")

	// 搜索预分组开关（方案 §9.1）：默认开启 isGroupHead 过滤。
	// 必须按 §9 灰度顺序：先跑迁移、部署新 Worker 完成 song_groups 回填与索引字段
	// patch，最后才部署新 Go。索引尚未补齐时临时置 false 可热重启降级。
	v.SetDefault("SEARCH_GROUP_FILTER", true)

	// GitHub
	v.SetDefault("GITHUB_TOKEN", "")
	v.SetDefault("GITHUB_REPO", "amll-dev/amll-ttml-db")
	v.SetDefault("GITHUB_BRANCH", "main")

	// Sync
	v.SetDefault("SYNC_CRON_INTERVAL_SEC", 600)

	// OnlineSearch
	v.SetDefault("ONLINE_SEARCH_TIMEOUT_SEC", 10)

	// Casdoor
	v.SetDefault("CASDOOR_ENDPOINT", "http://localhost:8000")
	v.SetDefault("CASDOOR_ORGANIZATION", "amll")
	v.SetDefault("CASDOOR_APPLICATION", "amll-hub")
	v.SetDefault("CASDOOR_JWT_TTL", "24h")

	// MFA：默认禁止新开启，避免 Casdoor 会话异常时把用户锁在登录页
	v.SetDefault("MFA_SETUP_ENABLED", false)

	// GitHub App
	v.SetDefault("GITHUB_APP_ID", 0)
	v.SetDefault("GITHUB_INSTALLATION_ID", 0)
	v.SetDefault("GITHUB_PRIVATE_KEY_PATH", "")
	v.SetDefault("GITHUB_APP_REPO_OWNER", "amll-dev")
	v.SetDefault("GITHUB_APP_REPO_NAME", "amll-ttml-db")
	v.SetDefault("GITHUB_APP_UPLOAD_FOLDER", "raw-lyrics")

	// GitHub OAuth（自建登录/绑定）
	v.SetDefault("GITHUB_OAUTH_CLIENT_ID", "")
	v.SetDefault("GITHUB_OAUTH_CLIENT_SECRET", "")
	v.SetDefault("GITHUB_OAUTH_REDIRECT_URI", "http://localhost:8080/api/v1/auth/github/callback")

	// 投稿数据迁移（后端只投递消息）
	v.SetDefault("RABBITMQ_MIGRATION_EXCHANGE", "ttml.migration")
	v.SetDefault("RABBITMQ_MIGRATION_QUEUE", "migration.user")
	v.SetDefault("RABBITMQ_MIGRATION_DLQ", "migration.user.dlq")
	v.SetDefault("RABBITMQ_MIGRATION_CLOSE_QUEUE", "migration.close_pr")
	v.SetDefault("RABBITMQ_MIGRATION_CLOSE_DLQ", "migration.close_pr.dlq")
	v.SetDefault("MIGRATION_PR_START_NUMBER", 7390)

	// Submission 投稿模块
	v.SetDefault("SUBMISSION_AUTO_REJECT_INTERVAL", "1h")
	v.SetDefault("SUBMISSION_AUTO_REJECT_AFTER", "96h")
	v.SetDefault("SUBMISSION_REVIEWER_CACHE_TTL", "30s")
	// 审核租约：这两个键原来没有 SetDefault，环境变量缺失时 GetDuration 返回 0，
	// 只靠 NewReviewLeaseJob 里的 ttl <= 0 兜底。配置面缺位会让运维不知道能调，
	// 在此显式给出与兜底一致的默认值。
	v.SetDefault("SUBMISSION_REVIEW_LEASE_TTL", "3m")
	v.SetDefault("SUBMISSION_REVIEW_LEASE_INTERVAL", "30s")
	v.SetDefault("SUBMISSION_MAX_TTML_SIZE", 2*1024*1024)    // 2MB
	v.SetDefault("SUBMISSION_MAX_AUDIO_SIZE", 150*1024*1024) // 150MB
	v.SetDefault("SUBMISSION_MAX_IMAGE_SIZE", 100*1024*1024) // 100MB

	// Plugin Store 插件商店
	v.SetDefault("PLUGIN_STORE_BUCKET", "plugin-store")
	v.SetDefault("PLUGIN_STORE_MAX_ARTIFACT_BYTES", 48*1024*1024)
	v.SetDefault("PLUGIN_STORE_MAX_UNPACKED_BYTES", 64*1024*1024)
	v.SetDefault("PLUGIN_STORE_MAX_ENTRY_BYTES", 33*1024*1024)
	v.SetDefault("PLUGIN_STORE_MAX_MANIFEST_BYTES", 4*1024*1024)
	v.SetDefault("PLUGIN_STORE_MAX_ENTRIES", 64)
	v.SetDefault("PLUGIN_STORE_MAX_ICON_BYTES", 256*1024)
	v.SetDefault("PLUGIN_STORE_CATALOG_CACHE_TTL", "60s")
	v.SetDefault("PLUGIN_STORE_MAX_CATALOG_ITEMS", 256)
	v.SetDefault("PLUGIN_STORE_MAX_CATALOG_BYTES", 4*1024*1024)
	v.SetDefault("PLUGIN_STORE_RESERVED_IDS", "")

	// Worker
	v.SetDefault("WORKER_BASE_URL", "http://localhost:9090")

	// QQ 官方机器人
	v.SetDefault("QQ_BOT_APP_ID", "")
	v.SetDefault("QQ_BOT_CLIENT_SECRET", "")
	v.SetDefault("QQ_BOT_SANDBOX", false)
	v.SetDefault("QQ_BOT_INTENTS", 1<<25) // GROUP_AND_C2C_EVENT
	v.SetDefault("QQ_BOT_SITE_URL", "https://beta.amllhub.bikonoo.com")
	v.SetDefault("QQ_BOT_MARKDOWN", true)
	v.SetDefault("QQ_BOT_FONT_PATH", "")

	// Email 邮件通知（审核结果）
	v.SetDefault("EMAIL_ENABLED", false)
	v.SetDefault("SMTP_HOST", "")
	v.SetDefault("SMTP_PORT", 587)
	v.SetDefault("SMTP_USERNAME", "")
	v.SetDefault("SMTP_PASSWORD", "")
	v.SetDefault("EMAIL_FROM", "")
	v.SetDefault("EMAIL_FROM_NAME", "AMLL Hub")
	v.SetDefault("SITE_URL", "http://localhost:5173")
	v.SetDefault("EMAIL_CACHE_TTL", "10m")
	v.SetDefault("EMAIL_TIMEOUT_SEC", 15)

	// 阿里云号码认证（网页一键登录）
	v.SetDefault("ALIYUN_PNVS_ACCESS_KEY_ID", "")
	v.SetDefault("ALIYUN_PNVS_ACCESS_KEY_SECRET", "")
	v.SetDefault("ALIYUN_PNVS_SCENE_CODE", "")
	v.SetDefault("ALIYUN_PNVS_REGION_ID", "cn-hangzhou")

	// 新设备/异地登录站内提示
	v.SetDefault("SECURITY_LOGIN_NOTIFY_ENABLED", true)
	v.SetDefault("SECURITY_IP_DB_FILE", "data/ipipfree.ipdb")

	cfg := &Config{
		HTTP: HTTPConfig{
			Port: v.GetString("PORT"),
		},
		Database: DatabaseConfig{
			Host:         v.GetString("DB_HOST"),
			Port:         v.GetString("DB_PORT"),
			User:         v.GetString("DB_USER"),
			Password:     v.GetString("DB_PASSWORD"),
			Name:         v.GetString("DB_NAME"),
			SSLMode:      v.GetString("DB_SSLMODE"),
			MaxOpenConns: v.GetInt("DB_MAX_OPEN_CONNS"),
			MaxIdleConns: v.GetInt("DB_MAX_IDLE_CONNS"),
		},
		Redis: RedisConfig{
			Host:     v.GetString("REDIS_HOST"),
			Port:     v.GetString("REDIS_PORT"),
			Password: v.GetString("REDIS_PASSWORD"),
			DB:       v.GetInt("REDIS_DB"),
		},
		MinIO: MinIOConfig{
			Endpoint:  v.GetString("MINIO_ENDPOINT"),
			AccessKey: v.GetString("MINIO_ACCESS_KEY"),
			SecretKey: v.GetString("MINIO_SECRET_KEY"),
			Bucket:    v.GetString("MINIO_BUCKET"),
			UseSSL:    v.GetBool("MINIO_USE_SSL"),
		},
		RabbitMQ: RabbitMQConfig{
			URL:   v.GetString("RABBITMQ_URL"),
			Queue: v.GetString("RABBITMQ_QUEUE"),
			DLQ:   v.GetString("RABBITMQ_DLQ"),
		},
		MeiliSearch: MeiliSearchConfig{
			Host:   v.GetString("MEILISEARCH_HOST"),
			APIKey: v.GetString("MEILISEARCH_API_KEY"),
			Index:  v.GetString("MEILISEARCH_INDEX"),
		},
		Search: SearchConfig{
			GroupFilter: v.GetBool("SEARCH_GROUP_FILTER"),
		},
		GitHub: GitHubConfig{
			Token:  v.GetString("GITHUB_TOKEN"),
			Repo:   v.GetString("GITHUB_REPO"),
			Branch: v.GetString("GITHUB_BRANCH"),
		},
		Sync: SyncConfig{
			CronIntervalSec: v.GetInt("SYNC_CRON_INTERVAL_SEC"),
		},
		NCM: NCMConfig{
			APIBase: v.GetString("NCM_API_BASE"),
			MusicU:  v.GetString("NCM_MUSIC_U"),
		},
		QM: QMConfig{
			Cookie:    v.GetString("QM_COOKIE"),
			CookieKey: v.GetString("QM_COOKIE_KEY"),
		},
		OnlineSearch: OnlineSearchConfig{
			TimeoutSec: v.GetInt("ONLINE_SEARCH_TIMEOUT_SEC"),
		},
		ServiceToken: v.GetString("SERVICE_TOKEN"),
		Casdoor: CasdoorConfig{
			Endpoint:         v.GetString("CASDOOR_ENDPOINT"),
			ClientID:         v.GetString("CASDOOR_CLIENT_ID"),
			ClientSecret:     v.GetString("CASDOOR_CLIENT_SECRET"),
			Organization:     v.GetString("CASDOOR_ORGANIZATION"),
			Application:      v.GetString("CASDOOR_APPLICATION"),
			ApplicationOwner: v.GetString("CASDOOR_APPLICATION_OWNER"),
			JWTSecret:        v.GetString("CASDOOR_JWT_SECRET"),
			JWTTTL:           v.GetDuration("CASDOOR_JWT_TTL"),
		},
		MFA: MFAConfig{
			SetupEnabled: v.GetBool("MFA_SETUP_ENABLED"),
		},
		GitHubApp: GitHubAppConfig{
			AppID:          v.GetInt64("GITHUB_APP_ID"),
			InstallationID: v.GetInt64("GITHUB_INSTALLATION_ID"),
			PrivateKeyPath: v.GetString("GITHUB_PRIVATE_KEY_PATH"),
			RepoOwner:      v.GetString("GITHUB_APP_REPO_OWNER"),
			RepoName:       v.GetString("GITHUB_APP_REPO_NAME"),
			UploadFolder:   v.GetString("GITHUB_APP_UPLOAD_FOLDER"),
		},
		GitHubOAuth: GitHubOAuthConfig{
			ClientID:     v.GetString("GITHUB_OAUTH_CLIENT_ID"),
			ClientSecret: v.GetString("GITHUB_OAUTH_CLIENT_SECRET"),
			RedirectURI:  v.GetString("GITHUB_OAUTH_REDIRECT_URI"),
			SiteURL:      strings.TrimSuffix(v.GetString("SITE_URL"), "/"),
		},
		Migration: MigrationConfig{
			Exchange:      v.GetString("RABBITMQ_MIGRATION_EXCHANGE"),
			Queue:         v.GetString("RABBITMQ_MIGRATION_QUEUE"),
			DLQ:           v.GetString("RABBITMQ_MIGRATION_DLQ"),
			CloseQueue:    v.GetString("RABBITMQ_MIGRATION_CLOSE_QUEUE"),
			CloseDLQ:      v.GetString("RABBITMQ_MIGRATION_CLOSE_DLQ"),
			StartPrNumber: v.GetInt("MIGRATION_PR_START_NUMBER"),
			RepoOwner:     v.GetString("GITHUB_APP_REPO_OWNER"),
			RepoName:      v.GetString("GITHUB_APP_REPO_NAME"),
		},
		Submission: SubmissionConfig{
			AutoRejectInterval:  v.GetDuration("SUBMISSION_AUTO_REJECT_INTERVAL"),
			AutoRejectAfter:     v.GetDuration("SUBMISSION_AUTO_REJECT_AFTER"),
			ReviewerCacheTTL:    v.GetDuration("SUBMISSION_REVIEWER_CACHE_TTL"),
			ReviewLeaseTTL:      v.GetDuration("SUBMISSION_REVIEW_LEASE_TTL"),
			ReviewLeaseInterval: v.GetDuration("SUBMISSION_REVIEW_LEASE_INTERVAL"),
			MaxTTMLSize:         v.GetInt64("SUBMISSION_MAX_TTML_SIZE"),
			MaxAudioSize:        v.GetInt64("SUBMISSION_MAX_AUDIO_SIZE"),
			MaxImageSize:        v.GetInt64("SUBMISSION_MAX_IMAGE_SIZE"),
		},
		PluginStore: PluginStoreConfig{
			Bucket:           v.GetString("PLUGIN_STORE_BUCKET"),
			MaxArtifactBytes: v.GetInt64("PLUGIN_STORE_MAX_ARTIFACT_BYTES"),
			MaxUnpackedBytes: v.GetInt64("PLUGIN_STORE_MAX_UNPACKED_BYTES"),
			MaxEntryBytes:    v.GetInt64("PLUGIN_STORE_MAX_ENTRY_BYTES"),
			MaxManifestBytes: v.GetInt64("PLUGIN_STORE_MAX_MANIFEST_BYTES"),
			MaxEntries:       v.GetInt("PLUGIN_STORE_MAX_ENTRIES"),
			MaxIconBytes:     v.GetInt64("PLUGIN_STORE_MAX_ICON_BYTES"),
			CatalogCacheTTL:  v.GetDuration("PLUGIN_STORE_CATALOG_CACHE_TTL"),
			MaxCatalogItems:  v.GetInt("PLUGIN_STORE_MAX_CATALOG_ITEMS"),
			MaxCatalogBytes:  v.GetInt64("PLUGIN_STORE_MAX_CATALOG_BYTES"),
			ReservedIDs:      splitCSV(v.GetString("PLUGIN_STORE_RESERVED_IDS")),
		},
		Worker: WorkerConfig{
			BaseURL: v.GetString("WORKER_BASE_URL"),
		},
		QQBot: QQBotConfig{
			AppID:        strings.TrimSpace(v.GetString("QQ_BOT_APP_ID")),
			ClientSecret: strings.TrimSpace(v.GetString("QQ_BOT_CLIENT_SECRET")),
			Sandbox:      v.GetBool("QQ_BOT_SANDBOX"),
			Intents:      v.GetInt("QQ_BOT_INTENTS"),
			SiteURL:      strings.TrimRight(v.GetString("QQ_BOT_SITE_URL"), "/"),
			Markdown:     v.GetBool("QQ_BOT_MARKDOWN"),
			FontPath:     strings.TrimSpace(v.GetString("QQ_BOT_FONT_PATH")),
		},
		Email: EmailConfig{
			Enabled:       v.GetBool("EMAIL_ENABLED"),
			Host:          v.GetString("SMTP_HOST"),
			Port:          v.GetInt("SMTP_PORT"),
			Username:      v.GetString("SMTP_USERNAME"),
			Password:      v.GetString("SMTP_PASSWORD"),
			From:          v.GetString("EMAIL_FROM"),
			FromName:      v.GetString("EMAIL_FROM_NAME"),
			SiteURL:       strings.TrimSuffix(v.GetString("SITE_URL"), "/"),
			EmailCacheTTL: v.GetDuration("EMAIL_CACHE_TTL"),
			TimeoutSec:    v.GetInt("EMAIL_TIMEOUT_SEC"),
		},
		AliyunPNVS: AliyunPNVSConfig{
			AccessKeyID:     strings.TrimSpace(v.GetString("ALIYUN_PNVS_ACCESS_KEY_ID")),
			AccessKeySecret: strings.TrimSpace(v.GetString("ALIYUN_PNVS_ACCESS_KEY_SECRET")),
			SceneCode:       strings.TrimSpace(v.GetString("ALIYUN_PNVS_SCENE_CODE")),
			RegionID:        strings.TrimSpace(v.GetString("ALIYUN_PNVS_REGION_ID")),
		},
		Security: SecurityConfig{
			LoginNotifyEnabled: v.GetBool("SECURITY_LOGIN_NOTIFY_ENABLED"),
			IPDBFile:           strings.TrimSpace(v.GetString("SECURITY_IP_DB_FILE")),
		},
	}

	if cfg.Casdoor.JWTSecret == "" {
		logrus.Fatal("CASDOOR_JWT_SECRET is empty: anyone could forge JWTs; refusing to start")
	}

	if cfg.GitHubApp.AppID == 0 || cfg.GitHubApp.InstallationID == 0 || cfg.GitHubApp.PrivateKeyPath == "" {
		logrus.Warnf("GitHub App config incomplete (GITHUB_APP_ID/GITHUB_INSTALLATION_ID/GITHUB_PRIVATE_KEY_PATH), submission approve upload will be disabled")
	}

	if !cfg.GitHubOAuth.Enabled() {
		logrus.Warnf("GitHub OAuth config incomplete (GITHUB_OAUTH_CLIENT_ID/GITHUB_OAUTH_CLIENT_SECRET), GitHub login/binding will be disabled")
	}

	if os.Getenv("APP_ENV") == "production" {
		// 默认凭据出现在生产环境 = 内网服务实际上对公网敞开。
		// 与 CASDOOR_JWT_SECRET 的处理保持一致：直接拒绝启动，而不是打完警告继续跑。
		if cfg.MinIO.AccessKey == "minioadmin" {
			logrus.Fatal("MINIO_ACCESS_KEY is default 'minioadmin' in production: refusing to start with a public default credential")
		}
		if cfg.MinIO.SecretKey == "minioadmin" {
			logrus.Fatal("MINIO_SECRET_KEY is default 'minioadmin' in production: refusing to start with a public default credential")
		}
		if strings.Contains(cfg.RabbitMQ.URL, "guest:guest") {
			logrus.Fatal("RABBITMQ_URL contains default 'guest:guest' credentials in production: refusing to start")
		}
	}

	return cfg, nil
}
