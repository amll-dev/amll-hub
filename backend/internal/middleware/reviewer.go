package middleware

import (
	"context"
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

// cachedReviewer 审核员名单缓存
type cachedReviewer struct {
	mu       sync.RWMutex
	names    map[string]struct{}
	expireAt time.Time
	ttl      time.Duration
	loaded   bool
}

// ReviewerCache 进程内审核员名单缓存
type ReviewerCache struct {
	repo *repository.ReviewerRepo
	c    cachedReviewer
}

// NewReviewerCache 创建审核员缓存
func NewReviewerCache(repo *repository.ReviewerRepo, ttl time.Duration) *ReviewerCache {
	return &ReviewerCache{
		repo: repo,
		c: cachedReviewer{
			ttl: ttl,
		},
	}
}

// IsReviewer 检查是否审核员（缓存未命中时查 DB）
func (rc *ReviewerCache) IsReviewer(ctx context.Context, username string) (bool, error) {
	if username == "" {
		return false, nil
	}
	// fast path: 读缓存
	rc.c.mu.RLock()
	now := time.Now()
	if rc.c.loaded && now.Before(rc.c.expireAt) {
		_, ok := rc.c.names[username]
		rc.c.mu.RUnlock()
		return ok, nil
	}
	rc.c.mu.RUnlock()

	// slow path: 查 DB
	names, err := rc.repo.ListAll(ctx)
	if err != nil {
		return false, err
	}
	set := make(map[string]struct{}, len(names))
	for _, n := range names {
		set[n] = struct{}{}
	}

	rc.c.mu.Lock()
	rc.c.names = set
	rc.c.expireAt = time.Now().Add(rc.c.ttl)
	rc.c.loaded = true
	rc.c.mu.Unlock()

	_, ok := set[username]
	return ok, nil
}

// Invalidate 主动失效缓存（添加/移除审核员时调用）
func (rc *ReviewerCache) Invalidate() {
	rc.c.mu.Lock()
	rc.c.loaded = false
	rc.c.names = nil
	rc.c.mu.Unlock()
}

// RequireReviewer 要求审核员权限（需先经过 Auth 中间件）
func RequireReviewer(rc *ReviewerCache) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, _ := c.Get(UserNameKey)
		name, _ := username.(string)
		if name == "" {
			pkg.Fail(c, 401, 401, "未登录")
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
			pkg.Fail(c, 403, 403, "需要审核员权限")
			c.Abort()
			return
		}
		c.Next()
	}
}
