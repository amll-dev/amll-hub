package service

import (
	"context"
	"strconv"
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

// Load 优先读 Redis，未命中或不可用时回落内存值。
func (s *qmRedisStore) Load() (string, error) {
	if s.redis != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()

		v, err := s.redis.Get(ctx, s.key).Result()
		switch {
		case err == nil && strings.TrimSpace(v) != "":
			initial := s.memValue()
			if cookieIssuedAt(initial) > cookieIssuedAt(v) {
				logrus.Info("qm: 环境变量 cookie 比 Redis 中的更新，改用环境变量并回写 Redis")
				// Save 失败只告警，本次启动仍使用新 cookie
				_ = s.Save(initial)
				return initial, nil
			}
			s.setMem(v)
			return v, nil
		case err != nil && err != redis.Nil:
			logrus.WithError(err).Warn("qm: 读取 Redis 凭据失败，改用本地初值")
		}
	}
	return s.memValue(), nil
}

// cookieIssuedAt 取 cookie 里 musickey 的签发时间，用于判断两份凭据谁更新。
// 缺失或非数字时返回 0，此时仍以 Redis 为准。
func cookieIssuedAt(cookie string) int64 {
	for _, item := range strings.Split(cookie, ";") {
		k, v, ok := strings.Cut(strings.TrimSpace(item), "=")
		if !ok || strings.TrimSpace(k) != "psrf_musickey_createtime" {
			continue
		}
		n, _ := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
		return n
	}
	return 0
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
