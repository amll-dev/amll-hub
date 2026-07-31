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

// OnlineSearchHandler 在线搜索 handler
type OnlineSearchHandler struct {
	svc *service.OnlineSearchService
}

func NewOnlineSearchHandler(svc *service.OnlineSearchService) *OnlineSearchHandler {
	return &OnlineSearchHandler{svc: svc}
}

// Search GET /api/v1/online/search?q=&platform=&limit=
func (h *OnlineSearchHandler) Search(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	platform := strings.TrimSpace(c.Query("platform"))
	limit := pkg.Clamp(pkg.ParseInt(c.Query("limit"), 5), 1, 20)

	if q == "" {
		pkg.BadRequest(c, "q 参数必填")
		return
	}

	switch platform {
	case "ncm", "qq", "kugou":
	default:
		pkg.BadRequest(c, "platform 参数非法（可选: ncm, qq, kugou）")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.Search(ctx, q, platform, limit)
	if err != nil {
		writeOnlineSearchErr(c, err)
		return
	}

	pkg.OK(c, result)
}

// GetSong GET /api/v1/online/songs/:platform/:songId
func (h *OnlineSearchHandler) GetSong(c *gin.Context) {
	platform := strings.TrimSpace(c.Param("platform"))
	songID := strings.TrimSpace(c.Param("songId"))

	if err := validateOnlinePlatform(platform); err != nil {
		pkg.BadRequest(c, err.Error())
		return
	}

	if songID == "" {
		pkg.BadRequest(c, "songId 参数必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.GetSong(ctx, platform, songID)
	if err != nil {
		writeOnlineSearchErr(c, err)
		return
	}

	pkg.OK(c, result)
}

// GetLyric GET /api/v1/online/lyrics/:platform/:songId
func (h *OnlineSearchHandler) GetLyric(c *gin.Context) {
	platform := strings.TrimSpace(c.Param("platform"))
	songID := strings.TrimSpace(c.Param("songId"))

	if err := validateOnlinePlatform(platform); err != nil {
		pkg.BadRequest(c, err.Error())
		return
	}

	if songID == "" {
		pkg.BadRequest(c, "songId 参数必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.GetLyric(ctx, platform, songID)
	if err != nil {
		writeOnlineSearchErr(c, err)
		return
	}

	pkg.OK(c, result)
}

// validateOnlinePlatform 校验在线搜索平台参数
func validateOnlinePlatform(platform string) error {
	switch platform {
	case "ncm", "qq", "kugou":
		return nil
	}
	return errors.New("platform 参数非法（可选: ncm, qq, kugou）")
}

// writeOnlineSearchErr 统一处理在线搜索服务错误
func writeOnlineSearchErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrInvalidInput):
		pkg.BadRequest(c, "请求参数非法")
	case errors.Is(err, service.ErrUpstreamUnavailable):
		pkg.Fail(c, http.StatusBadGateway, 502, "在线搜索服务暂不可用")
	default:
		logrus.WithError(err).Error("online search unknown error")
		pkg.InternalError(c, "在线搜索失败")
	}
}
