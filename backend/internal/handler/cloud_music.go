package handler

import (
	"context"
	"errors"
	"strings"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
)

// CloudMusicHandler 云音乐解析 handler
type CloudMusicHandler struct {
	svc *service.CloudMusicService
}

func NewCloudMusicHandler(svc *service.CloudMusicService) *CloudMusicHandler {
	return &CloudMusicHandler{svc: svc}
}

// Search GET /api/v1/ncm/search?q=&limit=
// limit 默认 10，范围 1-100
func (h *CloudMusicHandler) Search(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	if q == "" {
		pkg.BadRequest(c, "q 参数必填")
		return
	}
	limit := pkg.Clamp(pkg.ParseInt(c.Query("limit"), 10), 1, 100)

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.Search(ctx, q, limit)
	if err != nil {
		writeCloudMusicErr(c, err)
		return
	}
	pkg.OK(c, result)
}

// ParseMusic GET /api/v1/ncm/parse-music?songId=&level=
// level 默认 exhigh，可选: standard/exhigh/lossless/hires/jyeffect/jymaster/sky/dolby
func (h *CloudMusicHandler) ParseMusic(c *gin.Context) {
	songID := strings.TrimSpace(c.Query("songId"))
	if songID == "" {
		pkg.BadRequest(c, "songId 参数必填")
		return
	}
	level := strings.TrimSpace(c.DefaultQuery("level", "exhigh"))

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.ParseMusic(ctx, songID, level)
	if err != nil {
		writeCloudMusicErr(c, err)
		return
	}
	pkg.OK(c, result)
}

// ParsePlaylist GET /api/v1/ncm/parse-playlist?playlistId=
func (h *CloudMusicHandler) ParsePlaylist(c *gin.Context) {
	playlistID := strings.TrimSpace(c.Query("playlistId"))
	if playlistID == "" {
		pkg.BadRequest(c, "playlistId 参数必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.ParsePlaylist(ctx, playlistID)
	if err != nil {
		writeCloudMusicErr(c, err)
		return
	}
	pkg.OK(c, result)
}

// writeCloudMusicErr 统一处理云音乐解析服务错误
func writeCloudMusicErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrInvalidInput):
		pkg.BadRequest(c, "请求参数非法")
	case errors.Is(err, service.ErrUpstreamUnavailable):
		writeUpstreamErr(c, err, "云音乐解析服务暂不可用")
	default:
		pkg.InternalError(c, "解析失败")
	}
}
