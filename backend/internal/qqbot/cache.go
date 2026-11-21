package qqbot

import (
	"sync"
	"time"
)

// ttlCache 极简带过期时间的并发安全缓存。
// 机器人只做只读查询，缓存目的是压住群里的重复指令，
// 不需要淘汰策略，过期项在读写时顺带清理。
type ttlCache[T any] struct {
	mu    sync.Mutex
	items map[string]cacheEntry[T]
}

type cacheEntry[T any] struct {
	value     T
	expiresAt time.Time
}

func newTTLCache[T any]() *ttlCache[T] {
	return &ttlCache[T]{items: make(map[string]cacheEntry[T])}
}

func (c *ttlCache[T]) Get(key string) (T, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	entry, ok := c.items[key]
	if !ok {
		var zero T
		return zero, false
	}
	if time.Now().After(entry.expiresAt) {
		delete(c.items, key)
		var zero T
		return zero, false
	}
	return entry.value, true
}

func (c *ttlCache[T]) Set(key string, value T, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if len(c.items) > 512 {
		now := time.Now()
		for k, entry := range c.items {
			if now.After(entry.expiresAt) {
				delete(c.items, k)
			}
		}
	}
	c.items[key] = cacheEntry[T]{value: value, expiresAt: time.Now().Add(ttl)}
}
