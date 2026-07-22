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
	GitHub       GitHubConfig
	Sync         SyncConfig
	NCM          NCMConfig
	OnlineSearch OnlineSearchConfig
	Casdoor      CasdoorConfig
}

type HTTPConfig struct {
	Port string
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

type OnlineSearchConfig struct {
	TimeoutSec int // 单平台搜索超时（秒）
}

type CasdoorConfig struct {
	Endpoint     string
	ClientID     string
	ClientSecret string
	Organization string
	Application  string
	JWTSecret    string
	JWTTTL       time.Duration
}

// findDotEnv 从当前工作目录向上查找 .env 文件
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

// Load 从环境变量加载配置（优先加载当前目录或项目根目录的 .env 文件）
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
		OnlineSearch: OnlineSearchConfig{
			TimeoutSec: v.GetInt("ONLINE_SEARCH_TIMEOUT_SEC"),
		},
		Casdoor: CasdoorConfig{
			Endpoint:     v.GetString("CASDOOR_ENDPOINT"),
			ClientID:     v.GetString("CASDOOR_CLIENT_ID"),
			ClientSecret: v.GetString("CASDOOR_CLIENT_SECRET"),
			Organization: v.GetString("CASDOOR_ORGANIZATION"),
			Application:  v.GetString("CASDOOR_APPLICATION"),
			JWTSecret:    v.GetString("CASDOOR_JWT_SECRET"),
			JWTTTL:       v.GetDuration("CASDOOR_JWT_TTL"),
		},
	}

	if cfg.Casdoor.JWTSecret == "" {
		logrus.Warnf("CASDOOR_JWT_SECRET is empty, auth endpoints will not work properly")
	}

	if os.Getenv("APP_ENV") == "production" {
		if cfg.MinIO.AccessKey == "minioadmin" {
			logrus.Warnf("MINIO_ACCESS_KEY is default 'minioadmin' in production")
		}
		if cfg.MinIO.SecretKey == "minioadmin" {
			logrus.Warnf("MINIO_SECRET_KEY is default 'minioadmin' in production")
		}
		if strings.Contains(cfg.RabbitMQ.URL, "guest:guest") {
			logrus.Warnf("RABBITMQ_URL contains default 'guest:guest' credentials in production")
		}
	}

	return cfg, nil
}
