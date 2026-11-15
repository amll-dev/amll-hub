package middleware

import (
	"regexp"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const RequestIDKey = "X-Request-ID"

// validRequestIDPattern 客户端传入的 request id 只接受长度 <= 64 的
// 字母/数字/._:- 。
//
// 直接信任客户端值的两个后果：
//  1. 日志膨胀：header 值可以任意长，原样写进 logrus 字段会把单条日志撑到几十 KB；
//  2. 追踪污染：所有人都能传同一个 request_id，真出问题时反而无法用它对账。
//
// 合法字符集按常见网关/W3C traceparent 风格收敛，不合法就重新生成。
var validRequestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,64}$`)

// RequestID 注入请求追踪 ID
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		rid := c.GetHeader(RequestIDKey)
		if !validRequestIDPattern.MatchString(rid) {
			rid = uuid.NewString()
		}
		c.Set("request_id", rid)
		c.Writer.Header().Set(RequestIDKey, rid)
		c.Next()
	}
}

// GetRequestID 从 Context 获取 request id
func GetRequestID(c *gin.Context) string {
	if v, ok := c.Get("request_id"); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}
