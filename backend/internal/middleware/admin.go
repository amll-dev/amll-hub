package middleware

import (
	"context"
	"net/http"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// AdminCache 进程内超级管理员名单缓存
type AdminCache struct {
	repo *repository.AdminRepo
	c    cachedReviewer
}

// NewAdminCache 创建超级管理员缓存
func NewAdminCache(repo *repository.AdminRepo, ttl time.Duration) *AdminCache {
	return &AdminCache{
		repo: repo,
		c: cachedReviewer{
			ttl: ttl,
		},
	}
}

// IsAdmin 检查是否超级管理员（缓存未命中时查 DB）
func (ac *AdminCache) IsAdmin(ctx context.Context, username string) (bool, error) {
	return ac.c.check(ctx, username, ac.repo.ListAll)
}

// RequireAdmin 要求超级管理员权限（需先经过 Auth 中间件）
func RequireAdmin(ac *AdminCache) gin.HandlerFunc {
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

		ok, err := ac.IsAdmin(ctx, name)
		if err != nil {
			logrus.WithError(err).Error("query admin list failed")
			pkg.InternalError(c, "查询超级管理员名单失败")
			c.Abort()
			return
		}
		if !ok {
			pkg.Fail(c, http.StatusForbidden, http.StatusForbidden, "需要超级管理员权限")
			c.Abort()
			return
		}
		c.Next()
	}
}
