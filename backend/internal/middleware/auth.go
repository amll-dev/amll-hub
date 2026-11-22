package middleware

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
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
	// SessionVersionKeyPrefix 用户会话版本号在 Redis 中的键前缀
	SessionVersionKeyPrefix = "auth:sessionVersion:"
)

// Auth JWT 校验中间件。
// 传入 Redis 时额外校验 token 的 ver 会话版本，用于「不是我」一键踢下线；
// 不传时只做签名/有效期校验（后台任务、测试等场景）。
func Auth(jwtSecret string, rdb ...*redis.Client) gin.HandlerFunc {
	var client *redis.Client
	if len(rdb) > 0 {
		client = rdb[0]
	}
	return func(c *gin.Context) {
		token := bearerToken(c.GetHeader("Authorization"))
		if token == "" {
			pkg.Fail(c, http.StatusUnauthorized, http.StatusUnauthorized, "missing token")
			c.Abort()
			return
		}
		if !setClaims(c, token, jwtSecret, client) {
			c.Abort()
			return
		}
		c.Next()
	}
}

// sessionVersionValid 校验 token 的会话版本号。
// 旧 token 没有 ver claim，按 0 处理；Redis 不可用时放行，避免鉴权被缓存故障拖垮。
func sessionVersionValid(rdb *redis.Client, userID string, ver int64) bool {
	if rdb == nil || userID == "" {
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	current, err := rdb.Get(ctx, SessionVersionKeyPrefix+userID).Int64()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			current = 0
		} else {
			logrus.WithError(err).Warn("read session version failed, skip version check")
			return true
		}
	}
	return ver == current
}

// ServiceTokenHeader 内部服务调用时携带固定 token 的头
const ServiceTokenHeader = "X-Service-Token"

// ServiceName 内部调用放行时写入 context 的虚拟用户名
const ServiceName = "service"

// AuthOrService 校验 JWT；携带合法 service token 的内部调用直接放行
func AuthOrService(jwtSecret, serviceToken string) gin.HandlerFunc {
	auth := Auth(jwtSecret)
	return func(c *gin.Context) {
		if serviceToken != "" {
			got := c.GetHeader(ServiceTokenHeader)
			if subtle.ConstantTimeCompare([]byte(got), []byte(serviceToken)) == 1 {
				c.Set(UserNameKey, ServiceName)
				c.Next()
				return
			}
		}
		auth(c)
	}
}

// OptionalAuth 公开接口的可选认证
func OptionalAuth(jwtSecret string, rdb ...*redis.Client) gin.HandlerFunc {
	var client *redis.Client
	if len(rdb) > 0 {
		client = rdb[0]
	}
	return func(c *gin.Context) {
		if token := bearerToken(c.GetHeader("Authorization")); token != "" {
			if claims, err := pkg.ParseJWT(token, jwtSecret); err == nil {
				if sessionVersionValid(client, claims.Sub, claims.Ver) {
					applyClaims(c, claims)
				}
			}
		}
		c.Next()
	}
}

// bearerToken 从 Authorization 头解析出 Bearer token（格式非法返回空串）
func bearerToken(authHeader string) string {
	if authHeader == "" {
		return ""
	}
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return parts[1]
}

// applyClaims 把解析好的 claims 写入 context，Auth / OptionalAuth 共用
func applyClaims(c *gin.Context, claims *pkg.Claims) {
	c.Set(UserIDKey, claims.Sub)
	c.Set(UserNameKey, claims.Name)
	c.Set(UserDisplayNameKey, claims.DisplayName)
	c.Set(UserAvatarKey, claims.Avatar)
}

// setClaims 解析 JWT 并写入 context；失败时写响应并返回 false
func setClaims(c *gin.Context, token, jwtSecret string, rdb *redis.Client) bool {
	claims, err := pkg.ParseJWT(token, jwtSecret)
	if err != nil {
		pkg.Fail(c, http.StatusUnauthorized, http.StatusUnauthorized, "invalid or expired token")
		return false
	}
	if !sessionVersionValid(rdb, claims.Sub, claims.Ver) {
		pkg.Fail(c, http.StatusUnauthorized, http.StatusUnauthorized, "登录状态已失效，请重新登录")
		return false
	}
	applyClaims(c, claims)
	return true
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
