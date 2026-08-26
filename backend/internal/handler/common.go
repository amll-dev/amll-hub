package handler

import (
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// defaultTimeout 默认请求超时
const defaultTimeout = 10 * time.Second

// longTimeout 用于流式/外部请求
const longTimeout = 60 * time.Second

// maxTempImageSize 临时图片上传大小上限
const maxTempImageSize = 100 << 20

// readLimited 最多读取 max 字节，超出则报错。
// 用于在读取请求体/上传文件前限制大小
func readLimited(r io.Reader, max int64) ([]byte, error) {
	content, err := io.ReadAll(io.LimitReader(r, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(content)) > max {
		return nil, fmt.Errorf("文件大小超过上限 %d 字节", max)
	}
	return content, nil
}

// writeUpstreamErr 上游服务（service.ErrUpstreamUnavailable）不可用时的统一 502 响应，
// message 为面向用户的服务名提示
func writeUpstreamErr(c *gin.Context, err error, message string) {
	logrus.WithError(err).Warn("upstream service unavailable")
	pkg.Fail(c, http.StatusBadGateway, http.StatusBadGateway, message)
}
