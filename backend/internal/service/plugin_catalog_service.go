package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/Masterminds/semver/v3"
	"github.com/amll-dev/amll-hub/backend/internal/config"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/redis/go-redis/v9"
	logrus "github.com/sirupsen/logrus"
)

const (
	pluginCatalogCacheKey = "plugin-store:catalog:v1"
	pluginCatalogETagKey  = "plugin-store:catalog:etag:v1"
)

var ErrPluginCatalogTooLarge = errors.New("plugin catalog exceeds configured limits")

// PluginCatalogEntry 目录条目
type PluginCatalogEntry struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Version       string   `json:"version"`
	Description   string   `json:"description,omitempty"`
	Author        string   `json:"author,omitempty"`
	Homepage      string   `json:"homepage,omitempty"`
	Channel       string   `json:"channel"`
	APIVersion    int      `json:"apiVersion"`
	Entry         string   `json:"entry"`
	SHA256        string   `json:"sha256"`
	Platforms     []string `json:"platforms,omitempty"`
	MinAppVersion string   `json:"minAppVersion,omitempty"`
}

// PluginCatalogDocument 目录文档
type PluginCatalogDocument struct {
	CatalogVersion int                  `json:"catalogVersion"`
	Plugins        []PluginCatalogEntry `json:"plugins"`
}

// PluginCatalogService 目录生成与缓存
type PluginCatalogService struct {
	cfg     *config.Config
	redis   *redis.Client
	plugins *repository.PluginRepo

	mu       sync.Mutex
	body     []byte
	etag     string
	expireAt time.Time
}

func NewPluginCatalogService(cfg *config.Config, rdb *redis.Client, plugins *repository.PluginRepo) *PluginCatalogService {
	return &PluginCatalogService{cfg: cfg, redis: rdb, plugins: plugins}
}

// Get 返回目录 JSON 与其 SHA-256 ETag
func (s *PluginCatalogService) Get(ctx context.Context) ([]byte, string, error) {
	if body, etag, ok := s.readCache(ctx); ok {
		return body, etag, nil
	}
	body, etag, err := s.build(ctx)
	if err != nil {
		return nil, "", err
	}
	s.writeCache(ctx, body, etag)
	return body, etag, nil
}

func (s *PluginCatalogService) readCache(ctx context.Context) ([]byte, string, bool) {
	ttl := s.cfg.PluginStore.CatalogCacheTTL
	s.mu.Lock()
	if s.body != nil && time.Now().Before(s.expireAt) {
		body, etag := s.body, s.etag
		s.mu.Unlock()
		return body, etag, true
	}
	s.mu.Unlock()

	if s.redis == nil {
		return nil, "", false
	}
	vals, err := s.redis.MGet(ctx, pluginCatalogCacheKey, pluginCatalogETagKey).Result()
	if err != nil || len(vals) != 2 || vals[0] == nil || vals[1] == nil {
		return nil, "", false
	}
	body, ok1 := vals[0].(string)
	etag, ok2 := vals[1].(string)
	if !ok1 || !ok2 || body == "" || etag == "" {
		return nil, "", false
	}
	s.mu.Lock()
	s.body = []byte(body)
	s.etag = etag
	s.expireAt = time.Now().Add(ttl)
	s.mu.Unlock()
	return []byte(body), etag, true
}

func (s *PluginCatalogService) writeCache(ctx context.Context, body []byte, etag string) {
	ttl := s.cfg.PluginStore.CatalogCacheTTL
	if ttl <= 0 {
		ttl = time.Minute
	}
	s.mu.Lock()
	s.body = body
	s.etag = etag
	s.expireAt = time.Now().Add(ttl)
	s.mu.Unlock()

	if s.redis == nil {
		return
	}
	pipe := s.redis.Pipeline()
	pipe.Set(ctx, pluginCatalogCacheKey, string(body), ttl)
	pipe.Set(ctx, pluginCatalogETagKey, etag, ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		logrus.WithError(err).Debug("write plugin catalog cache failed")
	}
}

// Invalidate 在数据库事务提交后调用
func (s *PluginCatalogService) Invalidate(ctx context.Context) {
	s.mu.Lock()
	s.body = nil
	s.etag = ""
	s.expireAt = time.Time{}
	s.mu.Unlock()
	if s.redis == nil {
		return
	}
	if err := s.redis.Del(ctx, pluginCatalogCacheKey, pluginCatalogETagKey).Err(); err != nil {
		logrus.WithError(err).Warn("invalidate plugin catalog cache failed")
	}
}

func (s *PluginCatalogService) build(ctx context.Context) ([]byte, string, error) {
	rows, err := s.plugins.ListCatalogRows(ctx)
	if err != nil {
		return nil, "", err
	}
	entries := pickCatalogEntries(rows)
	if max := s.cfg.PluginStore.MaxCatalogItems; max > 0 && len(entries) > max {
		logrus.WithFields(logrus.Fields{"entries": len(entries), "limit": max}).Error("plugin catalog entry limit exceeded")
		return nil, "", ErrPluginCatalogTooLarge
	}
	doc := PluginCatalogDocument{CatalogVersion: 0, Plugins: entries}
	body, err := json.Marshal(doc)
	if err != nil {
		return nil, "", err
	}
	if max := s.cfg.PluginStore.MaxCatalogBytes; max > 0 && int64(len(body)) > max {
		logrus.WithFields(logrus.Fields{"bytes": len(body), "limit": max}).Error("plugin catalog byte limit exceeded")
		return nil, "", ErrPluginCatalogTooLarge
	}
	sum := sha256.Sum256(body)
	return body, hex.EncodeToString(sum[:]), nil
}

// pickCatalogEntries 按 plugin_key 分组
func pickCatalogEntries(rows []repository.PluginCatalogRow) []PluginCatalogEntry {
	type candidate struct {
		row repository.PluginCatalogRow
		ver *semver.Version
	}
	best := make(map[string]candidate, len(rows))
	for _, row := range rows {
		v, err := semver.NewVersion(row.Version)
		if err != nil {
			logrus.WithFields(logrus.Fields{"plugin": row.PluginKey, "version": row.Version}).Warn("skip non-semver plugin version")
			continue
		}
		current, ok := best[row.PluginKey]
		if !ok || v.GreaterThan(current.ver) {
			best[row.PluginKey] = candidate{row: row, ver: v}
		}
	}

	keys := make([]string, 0, len(best))
	for key := range best {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	out := make([]PluginCatalogEntry, 0, len(keys))
	for _, key := range keys {
		row := best[key].row
		platforms := []string(row.Platforms)
		if len(platforms) == 0 {
			platforms = []string{"web", "desktop"}
		}
		out = append(out, PluginCatalogEntry{
			ID:            row.PluginKey,
			Name:          row.Name,
			Version:       row.Version,
			Description:   row.Summary,
			Author:        row.Author,
			Homepage:      row.Homepage,
			Channel:       row.Channel,
			APIVersion:    row.APIVersion,
			Entry:         "artifacts/" + row.SHA256 + ".zip",
			SHA256:        row.SHA256,
			Platforms:     platforms,
			MinAppVersion: row.MinAppVersion,
		})
	}
	return out
}
