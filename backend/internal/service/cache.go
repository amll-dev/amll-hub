package service

import (
	"context"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
	logrus "github.com/sirupsen/logrus"
)

// getCachedJSON 读缓存并反序列化，未命中或数据损坏均返回 false
func getCachedJSON[T any](ctx context.Context, rdb *redis.Client, key string) (T, bool) {
	var out T
	if rdb == nil {
		return out, false
	}
	raw, err := rdb.Get(ctx, key).Result()
	if err != nil || raw == "" {
		return out, false
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return out, false
	}
	return out, true
}

// setCachedJSON 写缓存，失败只记 debug 日志
func setCachedJSON[T any](
	ctx context.Context,
	rdb *redis.Client,
	key string,
	value T,
	ttl time.Duration,
) {
	if rdb == nil {
		return
	}
	data, err := json.Marshal(value)
	if err != nil {
		return
	}
	if err := rdb.Set(ctx, key, data, ttl).Err(); err != nil {
		logrus.WithError(err).WithField("key", key).Debug("cache set failed")
	}
}
