package middleware

import (
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// sensitiveParams 落日志前需要打码的 query 参数（凭据、验证码、PII）
var sensitiveParams = []string{"token", "code", "password", "email", "secret", "ticket"}

// sanitizeQuery 把敏感参数的值替换成 ***，其余参数原样保留。
//
// 反序列化失败时不回退到原文——那等于把可能含凭据的原始串写进日志。
func sanitizeQuery(raw string) string {
	if raw == "" {
		return ""
	}
	q, err := url.ParseQuery(raw)
	if err != nil {
		return "<unparsable>"
	}
	for _, k := range sensitiveParams {
		if _, ok := q[k]; ok {
			q[k] = []string{"***"}
		}
	}
	return q.Encode()
}

// Logger 请求日志中间件
func Logger() gin.HandlerFunc {
	log := logrus.StandardLogger()
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		// WS 的 JWT、验证码、邮箱等都在 query 里，原样落盘等于把凭据写进日志
		raw := sanitizeQuery(c.Request.URL.RawQuery)

		c.Next()

		latency := time.Since(start)
		rid := GetRequestID(c)
		fields := logrus.Fields{
			"request_id": rid,
			"method":     c.Request.Method,
			"path":       path,
			"query":      raw,
			"status":     c.Writer.Status(),
			"latency_ms": latency.Milliseconds(),
			"client_ip":  c.ClientIP(),
			"user_agent": c.Request.UserAgent(),
			"resp_size":  c.Writer.Size(),
		}
		if len(c.Errors) > 0 {
			fields["errors"] = c.Errors.String()
		}

		switch {
		case c.Writer.Status() >= 500:
			log.WithFields(fields).Error("request completed")
		case c.Writer.Status() >= 400:
			log.WithFields(fields).Warn("request completed")
		default:
			log.WithFields(fields).Info("request completed")
		}
	}
}
