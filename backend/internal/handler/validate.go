package handler

import (
	"context"
	"io"
	"net/http"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// ValidateHandler TTML 校验 handler
type ValidateHandler struct {
	svc *service.ValidateService
}

// NewValidateHandler 创建 handler
func NewValidateHandler(svc *service.ValidateService) *ValidateHandler {
	return &ValidateHandler{svc: svc}
}

// Validate POST /api/v1/submissions/validate
// 接收原始 TTML 文本 (body) 或 multipart 文件,调用 Worker 校验
func (h *ValidateHandler) Validate(c *gin.Context) {
	if currentUser(c) == nil {
		pkg.Unauthorized(c)
		return
	}

	var content []byte
	var err error

	if file, _, fErr := c.Request.FormFile("file"); fErr == nil {
		// multipart 文件上传
		defer file.Close()
		content, err = io.ReadAll(io.LimitReader(file, 10*1024*1024))
		if err != nil {
			pkg.BadRequest(c, "读取文件失败")
			return
		}
	} else {
		// raw body (text/plain)
		content, err = io.ReadAll(io.LimitReader(c.Request.Body, 10*1024*1024))
		if err != nil {
			pkg.BadRequest(c, "读取内容失败")
			return
		}
	}

	if len(content) == 0 {
		pkg.BadRequest(c, "TTML 内容不能为空")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.Validate(ctx, content)
	if err != nil {
		logrus.WithError(err).Error("validate ttml failed")
		pkg.Fail(c, http.StatusBadGateway, http.StatusBadGateway, "校验服务不可用")
		return
	}

	pkg.OK(c, result)
}
