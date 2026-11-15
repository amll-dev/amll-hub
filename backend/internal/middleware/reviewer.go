package middleware

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// ReviewerCacheKey context 中存储投稿模块用户身份的 key
const (
	SubmissionUserKey     = "submission_user"
	SubmissionUserInfoKey = "submission_user_info"
)

// maxReviewerCacheTTL 审核员名单缓存的硬上限。
// 名单变更只在本实例主动 Invalidate；多副本下没有广播机制（不引入 Redis pub/sub），
// 因此把 TTL 压短作为兜底：撤权最多在这个时长内于其它副本生效。
const maxReviewerCacheTTL = 15 * time.Second

// cachedReviewer 审核员名单缓存
type cachedReviewer struct {
	mu         sync.RWMutex
	names      map[string]struct{}
	expireAt   time.Time
	ttl        time.Duration
	loaded     bool
	generation uint64 // Invalidate 递增，用于丢弃 in-flight 的旧查询结果
}

// ReviewerCache 进程内审核员名单缓存
type ReviewerCache struct {
	repo *repository.ReviewerRepo
	c    cachedReviewer
}

// NewReviewerCache 创建审核员缓存
func NewReviewerCache(repo *repository.ReviewerRepo, ttl time.Duration) *ReviewerCache {
	// 缩短 TTL：无论配置传多大都收敛到硬上限；<=0 时按上限取默认值。
	if ttl <= 0 || ttl > maxReviewerCacheTTL {
		ttl = maxReviewerCacheTTL
	}
	return &ReviewerCache{
		repo: repo,
		c: cachedReviewer{
			ttl: ttl,
		},
	}
}

// nameListLoader 名单查询函数（供泛化缓存使用）
type nameListLoader func(ctx context.Context) ([]string, error)

// checkNameInList 通用名单缓存检查（缓存未命中时查 DB）
func (rc *cachedReviewer) check(ctx context.Context, username string, load nameListLoader) (bool, error) {
	if username == "" {
		return false, nil
	}
	// fast path: 读缓存
	rc.mu.RLock()
	now := time.Now()
	if rc.loaded && now.Before(rc.expireAt) {
		_, ok := rc.names[username]
		rc.mu.RUnlock()
		return ok, nil
	}
	generation := rc.generation
	rc.mu.RUnlock()

	// slow path: 查 DB
	names, err := load(ctx)
	if err != nil {
		return false, err
	}
	set := make(map[string]struct{}, len(names))
	for _, n := range names {
		set[n] = struct{}{}
	}

	rc.mu.Lock()
	// 撤权等变更在 load 期间发生：丢弃这份可能过期的名单，本次仍用刚查到的
	// DB 结果回答，下次请求会重新加载，避免旧结果把缓存「复活」。
	if rc.generation != generation {
		rc.mu.Unlock()
		_, ok := set[username]
		return ok, nil
	}
	rc.names = set
	rc.expireAt = time.Now().Add(rc.ttl)
	rc.loaded = true
	rc.mu.Unlock()

	_, ok := set[username]
	return ok, nil
}

// IsReviewer 检查是否审核员（缓存未命中时查 DB）
func (rc *ReviewerCache) IsReviewer(ctx context.Context, username string) (bool, error) {
	return rc.c.check(ctx, username, rc.repo.ListAll)
}

// Invalidate 主动失效本地缓存（添加/移除审核员时调用）。
// 递增 generation 让并发中尚未写回的旧查询结果作废，避免撤权后被回填复活。
func (rc *ReviewerCache) Invalidate() {
	rc.c.mu.Lock()
	rc.c.loaded = false
	rc.c.names = nil
	rc.c.expireAt = time.Time{}
	rc.c.generation++
	rc.c.mu.Unlock()
}

// RequireReviewer 要求审核员权限（需先经过 Auth 中间件）
func RequireReviewer(rc *ReviewerCache) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, _ := c.Get(UserNameKey)
		name, _ := username.(string)
		if name == "" {
			pkg.Unauthorized(c)
			c.Abort()
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		defer cancel()

		ok, err := rc.IsReviewer(ctx, name)
		if err != nil {
			logrus.WithError(err).Error("query reviewer list failed")
			pkg.InternalError(c, "查询审核员名单失败")
			c.Abort()
			return
		}
		if !ok {
			pkg.Fail(c, http.StatusForbidden, http.StatusForbidden, "需要审核员权限")
			c.Abort()
			return
		}
		c.Next()
	}
}
