package middleware

import (
	"context"
	"net/http"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// RequireReviewerOrAdmin 要求审核员或超级管理员权限
func RequireReviewerOrAdmin(rc *ReviewerCache, ac *AdminCache) gin.HandlerFunc {
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

		isAdmin, err := ac.IsAdmin(ctx, name)
		if err != nil {
			logrus.WithError(err).Error("query admin list failed")
			pkg.InternalError(c, "查询超级管理员名单失败")
			c.Abort()
			return
		}
		if isAdmin {
			c.Next()
			return
		}

		isReviewer, err := rc.IsReviewer(ctx, name)
		if err != nil {
			logrus.WithError(err).Error("query reviewer list failed")
			pkg.InternalError(c, "查询审核员名单失败")
			c.Abort()
			return
		}
		if !isReviewer {
			pkg.Fail(c, http.StatusForbidden, http.StatusForbidden, "需要审核员或超级管理员权限")
			c.Abort()
			return
		}
		c.Next()
	}
}
