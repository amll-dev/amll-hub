package middleware

import (
	"context"
	"crypto/subtle"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	logrus "github.com/sirupsen/logrus"
)

// RateLimitRule 一条限流规则。
//
// Prefix 按**最长匹配**生效，所以更严格的规则可以写在更具体的前缀上；
// Limit <= 0 表示该前缀不限流（媒体流、健康检查这类不该被卡的路径）。
type RateLimitRule struct {
	Prefix string
	Limit  int
	Window time.Duration
}

// DefaultRateLimitRules 默认配额：越贵、越容易被滥用的接口越严。
//
// 粒度是「IP + 前缀 + 时间窗」，够挡住脚本刷接口；不做按用户限流，
// 因为中间件在鉴权之前执行，那时还拿不到用户身份。
var DefaultRateLimitRules = []RateLimitRule{
	// 不限流：播放器会发大量 Range 请求，索引导出与健康检查也不该被卡
	{Prefix: "/health", Limit: 0},
	{Prefix: "/api/v1/uploads/file", Limit: 0},
	{Prefix: "/api/v1/index/", Limit: 0},
	{Prefix: "/api/v1/store/artifacts", Limit: 0},

	// 最危险：发码接口，按 IP 卡死，挡住短信/邮件轰炸
	{Prefix: "/api/v1/auth/send-code", Limit: 5, Window: time.Minute},
	{Prefix: "/api/v1/auth/login/mfa/send-code", Limit: 5, Window: time.Minute},
	{Prefix: "/api/v1/auth/mfa/setup/send-code", Limit: 5, Window: time.Minute},
	{Prefix: "/api/v1/auth/identity/code", Limit: 5, Window: time.Minute},
	{Prefix: "/api/v1/auth/register", Limit: 10, Window: time.Minute},
	{Prefix: "/api/v1/auth/login", Limit: 20, Window: time.Minute},
	{Prefix: "/api/v1/auth", Limit: 60, Window: time.Minute},

	// 单请求成本高的接口
	//
	// 搜索给了 120/min：前端 300ms 防抖 + Tab 切换 + 分页都会发请求，
	// 按 30/min 卡会让正常用户搜索两次就吃 429；脚本刷接口的量级远高于此。
	{Prefix: "/api/v1/lyrics/parse", Limit: 30, Window: time.Minute},
	{Prefix: "/api/v1/search", Limit: 120, Window: time.Minute},
	{Prefix: "/api/v1/online", Limit: 120, Window: time.Minute},
	{Prefix: "/api/v1/lyrics", Limit: 120, Window: time.Minute},
	{Prefix: "/ws/", Limit: 60, Window: time.Minute},

	{Prefix: "/api/", Limit: 300, Window: time.Minute},
	{Prefix: "/", Limit: 600, Window: time.Minute},
}

// rateLimitScript 计数 + 首次写入时设置 TTL，保证 INCR 与 EXPIRE 原子执行。
//
// 分开两条命令会出现「INCR 成功、EXPIRE 失败」的窗口，留下永不过期的计数键，
// 那个 IP 会在这个前缀上被永久限流。
var rateLimitScript = redis.NewScript(`
local n = redis.call('INCR', KEYS[1])
if n == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return n
`)

// RateLimitEnabled 是否启用全站限流（RATE_LIMIT_ENABLED=false 可紧急关闭）
func RateLimitEnabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("RATE_LIMIT_ENABLED")))
	return v != "false" && v != "0" && v != "off"
}

// RateLimit 基于 Redis 的固定窗口限流中间件。
//
// serviceToken 非空时，携带合法 X-Service-Token 的内部调用（Worker）直接放行：
// 同步一次会集中请求媒体接口，按 IP 卡会把自家 Worker 卡死。
func RateLimit(rdb *redis.Client, rules []RateLimitRule, serviceToken string) gin.HandlerFunc {
	if rdb == nil {
		logrus.Warn("限流未启用：Redis 客户端为空")
		return func(c *gin.Context) { c.Next() }
	}
	return func(c *gin.Context) {
		// 预检请求不该计数：一个页面可能发几十个 OPTIONS
		if c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}
		if serviceToken != "" {
			got := c.GetHeader(ServiceTokenHeader)
			if subtle.ConstantTimeCompare([]byte(got), []byte(serviceToken)) == 1 {
				c.Next()
				return
			}
		}
		rule, ok := matchRateLimitRule(c.Request.URL.Path, rules)
		if !ok || rule.Limit <= 0 {
			c.Next()
			return
		}

		window := rule.Window
		if window <= 0 {
			window = time.Minute
		}
		windowMs := window.Milliseconds()
		windowSec := int64(window / time.Second)
		if windowSec <= 0 {
			windowSec = 60
		}

		now := time.Now().Unix()
		bucket := now / windowSec
		key := fmt.Sprintf("ratelimit:%s:%s:%d", rule.Prefix, c.ClientIP(), bucket)

		ctx, cancel := context.WithTimeout(c.Request.Context(), 200*time.Millisecond)
		n, err := rateLimitScript.Run(ctx, rdb, []string{key}, windowMs).Int64()
		cancel()
		if err != nil {
			// 限流不该成为全站单点：Redis 抖动时放行，只记日志
			logrus.WithError(err).Debug("rate limit check failed, allow request")
			c.Next()
			return
		}
		if n > int64(rule.Limit) {
			c.Header("Retry-After", strconv.FormatInt(windowSec-now%windowSec, 10))
			pkg.Fail(c, http.StatusTooManyRequests, http.StatusTooManyRequests, "请求过于频繁，请稍后再试")
			c.Abort()
			return
		}
		c.Next()
	}
}

// matchRateLimitRule 取最长前缀匹配的规则
func matchRateLimitRule(path string, rules []RateLimitRule) (RateLimitRule, bool) {
	var best RateLimitRule
	found := false
	for _, r := range rules {
		if r.Prefix == "" || !strings.HasPrefix(path, r.Prefix) {
			continue
		}
		if !found || len(r.Prefix) > len(best.Prefix) {
			best = r
			found = true
		}
	}
	return best, found
}
