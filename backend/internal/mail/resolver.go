package mail

import (
	"context"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
)

// UserDirectory 用户邮箱查询（由 infrastructure 层的 Casdoor 客户端实现）
type UserDirectory interface {
	GetUserEmail(ctx context.Context, username string) (string, error)
}

// cacheEntry 用户名→邮箱缓存项。
// email 为空表示「查到了但没有邮箱」（miss），miss 与命中共用一张表和同一份 TTL：
// 过期判断在读时做，不需要额外定时器来清理，用户补了邮箱后最多一个 TTL 就能恢复发信。
type cacheEntry struct {
	email   string
	expires time.Time
}

// Resolver 用户名→邮箱
//
// 命中与 miss 合并成 cache 一张表。早先 miss 用 time.AfterFunc 起定时器删除，
// 群发场景下几千个没邮箱的用户就是几千个各挂一个 TTL（默认 10 分钟）的定时器，
// 纯属给运行时加负担 —— 同一个 map 加个过期时间就够，没有主动清理的必要。
type Resolver struct {
	dir   UserDirectory
	ttl   time.Duration
	mu    sync.RWMutex
	cache map[string]cacheEntry
}

// NewResolver 创建解析器（ttl <= 0 时默认 10 分钟）
func NewResolver(dir UserDirectory, ttl time.Duration) *Resolver {
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	return &Resolver{dir: dir, ttl: ttl, cache: make(map[string]cacheEntry)}
}

// Resolve 取用户邮箱；返回空串表示查不到（调用方应跳过发信）
func (r *Resolver) Resolve(ctx context.Context, username string) (string, error) {
	if r == nil || r.dir == nil || username == "" {
		return "", nil
	}
	now := time.Now()

	r.mu.RLock()
	if e, ok := r.cache[username]; ok && now.Before(e.expires) {
		r.mu.RUnlock()
		return e.email, nil
	}
	r.mu.RUnlock()

	email, err := r.dir.GetUserEmail(ctx, username)
	if err != nil {
		// 查询失败不缓存，下次还能重试
		return "", err
	}

	r.mu.Lock()
	r.cache[username] = cacheEntry{email: email, expires: now.Add(r.ttl)}
	r.mu.Unlock()

	if email == "" {
		return "", nil
	}
	logrus.WithFields(logrus.Fields{"username": username}).Debug("resolved user email")
	return email, nil
}
