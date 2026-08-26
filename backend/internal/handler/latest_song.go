package handler

import (
	"context"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
)

// LatestSongHandler 最新收录 handler
type LatestSongHandler struct {
	svc *service.LatestSongService
}

func NewLatestSongHandler(svc *service.LatestSongService) *LatestSongHandler {
	return &LatestSongHandler{svc: svc}
}

// List GET /api/v1/latest-songs
func (h *LatestSongHandler) List(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	list, err := h.svc.List(ctx)
	if err != nil {
		pkg.InternalError(c, "查询最新收录失败")
		return
	}
	pkg.OK(c, list)
}
