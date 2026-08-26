package middleware

import (
	"net/http"
	"strings"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/gin-gonic/gin"
)

const (
	// UserIDKey context 中存储用户 ID 的 key
	UserIDKey = "user_id"
	// UserNameKey context 中存储用户名的 key
	UserNameKey = "user_name"
	// UserDisplayNameKey context 中存储显示名称的 key
	UserDisplayNameKey = "user_display_name"
	// UserAvatarKey context 中存储头像 URL 的 key
	UserAvatarKey = "user_avatar"
)

// Auth JWT 校验中间件
func Auth(jwtSecret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			pkg.Fail(c, http.StatusUnauthorized, http.StatusUnauthorized, "missing token")
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			pkg.Fail(c, http.StatusUnauthorized, http.StatusUnauthorized, "invalid authorization header")
			c.Abort()
			return
		}

		claims, err := pkg.ParseJWT(parts[1], jwtSecret)
		if err != nil {
			pkg.Fail(c, http.StatusUnauthorized, http.StatusUnauthorized, "invalid or expired token")
			c.Abort()
			return
		}

		c.Set(UserIDKey, claims.Sub)
		c.Set(UserNameKey, claims.Name)
		c.Set(UserDisplayNameKey, claims.DisplayName)
		c.Set(UserAvatarKey, claims.Avatar)
		c.Next()
	}
}

// GetUserID 从 context 获取用户 ID
func GetUserID(c *gin.Context) string {
	if v, ok := c.Get(UserIDKey); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// GetUserName 从 context 获取用户名
func GetUserName(c *gin.Context) string {
	if v, ok := c.Get(UserNameKey); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// GetUserDisplayName 从 context 获取显示名称
func GetUserDisplayName(c *gin.Context) string {
	if v, ok := c.Get(UserDisplayNameKey); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// GetUserAvatar 从 context 获取头像 URL
func GetUserAvatar(c *gin.Context) string {
	if v, ok := c.Get(UserAvatarKey); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}
