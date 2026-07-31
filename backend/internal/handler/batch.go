package handler

import (
	"context"
	"net/http"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
)

// BatchHandler 批量查询 handler
type BatchHandler struct {
	svc *service.BatchService
}

func NewBatchHandler(svc *service.BatchService) *BatchHandler {
	return &BatchHandler{svc: svc}
}

// BatchRequest 批量查询请求
type BatchRequest struct {
	Platform string   `json:"platform" binding:"required"`
	IDs      []string `json:"ids" binding:"required"`
}

// Post POST /api/v1/batch
func (h *BatchHandler) Post(c *gin.Context) {
	var req BatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "请求参数非法")
		return
	}
	if !pkg.IsValidPlatform(req.Platform) {
		pkg.BadRequest(c, "platform 参数非法")
		return
	}
	if len(req.IDs) == 0 {
		pkg.BadRequest(c, "ids 不能为空")
		return
	}
	if len(req.IDs) > 500 {
		pkg.BadRequest(c, "ids 数量不能超过 500")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	items, err := h.svc.BatchGetByPlatform(ctx, req.Platform, req.IDs)
	if err != nil {
		pkg.Fail(c, http.StatusInternalServerError, 500, "批量查询失败: "+err.Error())
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 200,
		"data": items,
	})
}
