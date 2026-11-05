package service

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	logrus "github.com/sirupsen/logrus"
)

// defaultQMCookieKey
const defaultQMCookieKey = "qm:cookie"

type qmRedisStore struct {
	redis *redis.Client
	key   string

	mu  sync.RWMutex
	mem string
}

// newQMCookieStore 构造凭据存储，initial 为环境变量里的初始 cookie
func newQMCookieStore(redisClient *redis.Client, key, initial string) *qmRedisStore {
	if strings.TrimSpace(key) == "" {
		key = defaultQMCookieKey
	}
	return &qmRedisStore{redis: redisClient, key: key, mem: strings.TrimSpace(initial)}
}

// Load 优先读 Redis，未命中或不可用时回落内存值
func (s *qmRedisStore) Load() (string, error) {
	if s.redis != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()

		v, err := s.redis.Get(ctx, s.key).Result()
		switch {
		case err == nil && strings.TrimSpace(v) != "":
			s.setMem(v)
			return v, nil
		case err != nil && err != redis.Nil:
			logrus.WithError(err).Warn("qm: 读取 Redis 凭据失败，改用本地初值")
		}
	}
	return s.memValue(), nil
}

// Save 整体替换 cookie，不能只写 musickey
func (s *qmRedisStore) Save(cookie string) error {
	s.setMem(cookie)
	if s.redis == nil {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	// 不设过期：凭据需长期保留
	if err := s.redis.Set(ctx, s.key, cookie, 0).Err(); err != nil {
		// 落盘失败不阻断本次续期，否则调用方会连同内存态一起丢弃
		logrus.WithError(err).Warn("qm: 写入 Redis 凭据失败，本次续期仅在进程内生效")
	}
	return nil
}

func (s *qmRedisStore) setMem(v string) {
	s.mu.Lock()
	s.mem = v
	s.mu.Unlock()
}

func (s *qmRedisStore) memValue() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.mem
}
