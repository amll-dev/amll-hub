package middleware

import (
	"strings"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/gin-gonic/gin"
)

const (
	// UserIDKey context 中存储用户 ID 的 key
	UserIDKey = "user_id"
	// UserNameKey context 中存储用户名的 key
	UserNameKey = "user_name"
)

// Auth JWT 校验中间件
func Auth(jwtSecret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			pkg.Fail(c, 401, 401, "missing token")
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			pkg.Fail(c, 401, 401, "invalid authorization header")
			c.Abort()
			return
		}

		claims, err := pkg.ParseJWT(parts[1], jwtSecret)
		if err != nil {
			pkg.Fail(c, 401, 401, "invalid or expired token")
			c.Abort()
			return
		}

		c.Set(UserIDKey, claims.Sub)
		c.Set(UserNameKey, claims.Name)
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
