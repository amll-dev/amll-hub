package handler

import (
	"context"
	"errors"
	"net/http"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// StatsHandler 词库统计 handler
type StatsHandler struct {
	svc *service.StatsService
}

func NewStatsHandler(svc *service.StatsService) *StatsHandler {
	return &StatsHandler{svc: svc}
}

// Get GET /api/v1/stats
func (h *StatsHandler) Get(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	stats, err := h.svc.GetStats(ctx)
	if err != nil {
		logrus.WithError(err).Error("get stats failed")
		if errors.Is(err, service.ErrUpstreamUnavailable) {
			pkg.Fail(c, http.StatusBadGateway, 502, "统计服务暂不可用")
			return
		}
		pkg.InternalError(c, "统计失败")
		return
	}

	pkg.OK(c, stats)
}
