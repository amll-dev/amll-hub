package middleware

import (
	"time"

	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// Logger 请求日志中间件
func Logger() gin.HandlerFunc {
	log := logrus.StandardLogger()
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		raw := c.Request.URL.RawQuery

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
