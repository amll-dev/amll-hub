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

type cacheEntry struct {
	email   string
	expires time.Time
}

// Resolver 用户名→邮箱
type Resolver struct {
	dir    UserDirectory
	ttl    time.Duration
	mu     sync.RWMutex
	cache  map[string]cacheEntry
	misses map[string]struct{} // 查不到邮箱的用户，同样短时间不再查
}

// NewResolver 创建解析器（ttl <= 0 时默认 10 分钟）
func NewResolver(dir UserDirectory, ttl time.Duration) *Resolver {
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	return &Resolver{dir: dir, ttl: ttl, cache: make(map[string]cacheEntry), misses: make(map[string]struct{})}
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
	if _, ok := r.misses[username]; ok {
		r.mu.RUnlock()
		return "", nil
	}
	r.mu.RUnlock()

	email, err := r.dir.GetUserEmail(ctx, username)
	if err != nil {
		// 查询失败不缓存，下次还能重试
		return "", err
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if email == "" {
		r.misses[username] = struct{}{}
		// miss 记录也需要过期，避免用户补了邮箱后永久不发；用同样的 TTL
		time.AfterFunc(r.ttl, func() {
			r.mu.Lock()
			delete(r.misses, username)
			r.mu.Unlock()
		})
		return "", nil
	}
	r.cache[username] = cacheEntry{email: email, expires: now.Add(r.ttl)}
	logrus.WithFields(logrus.Fields{"username": username}).Debug("resolved user email")
	return email, nil
}
