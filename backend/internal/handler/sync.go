package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// SyncHandler 同步相关 handler
type SyncHandler struct {
	svc *service.SyncService
}

func NewSyncHandler(svc *service.SyncService) *SyncHandler {
	return &SyncHandler{svc: svc}
}

// Trigger POST /api/v1/sync
// 触发同步任务
func (h *SyncHandler) Trigger(c *gin.Context) {
	// triggered_by 默认 api，可由 header X-Triggered-By 覆盖（github_action / cron）
	triggeredBy := c.GetHeader("X-Triggered-By")
	if triggeredBy == "" {
		triggeredBy = "api"
	}
	triggeredBy = strings.ToLower(triggeredBy)
	switch triggeredBy {
	case "api", "cron", "github_action":
	default:
		triggeredBy = "api"
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	result, err := h.svc.TriggerSync(ctx, triggeredBy)
	if err != nil {
		if errors.Is(err, service.ErrUpstreamUnavailable) {
			pkg.Fail(c, http.StatusBadGateway, 502, "触发同步失败，上游服务不可用")
			return
		}
		logrus.WithError(err).Error("trigger sync failed")
		pkg.InternalError(c, "触发同步失败")
		return
	}

	pkg.OK(c, result)
}

// Status GET /api/v1/sync/status
func (h *SyncHandler) Status(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	result, err := h.svc.GetStatus(ctx)
	if err != nil {
		logrus.WithError(err).Error("get sync status failed")
		pkg.InternalError(c, "查询同步状态失败")
		return
	}

	pkg.OK(c, result)
}
