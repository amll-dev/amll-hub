package handler

import (
	"context"
	"strconv"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// NotFoundHandler 无歌词记录 handler
type NotFoundHandler struct {
	svc *service.NotFoundService
}

// NewNotFoundHandler 创建 handler
func NewNotFoundHandler(svc *service.NotFoundService) *NotFoundHandler {
	return &NotFoundHandler{svc: svc}
}

// GetRanking GET /api/v1/not-found-ranking
func (h *NotFoundHandler) GetRanking(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	limitStr := c.DefaultQuery("limit", "all")
	daysStr := c.DefaultQuery("days", "7")
	platform := c.Query("platform")

	days, err := strconv.Atoi(daysStr)
	if err != nil || days < 1 {
		days = 7
	}

	limit := -1 // -1 表示返回全部
	if limitStr != "all" {
		limit, err = strconv.Atoi(limitStr)
		if err != nil || limit < 1 {
			limit = -1
		}
	}

	total, items, err := h.svc.GetRanking(ctx, days, platform, limit)
	if err != nil {
		logrus.WithError(err).Error("get not-found ranking failed")
		pkg.InternalError(c, "查询排行榜失败")
		return
	}

	pkg.OK(c, gin.H{
		"total":          total,
		"returned":       len(items),
		"requestedLimit": limitStr,
		"days":           days,
		"items":          items,
	})
}

// GetStats GET /api/v1/not-found-stats
func (h *NotFoundHandler) GetStats(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	stats, err := h.svc.GetStats(ctx)
	if err != nil {
		logrus.WithError(err).Error("get not-found stats failed")
		pkg.InternalError(c, "查询统计失败")
		return
	}

	pkg.OK(c, stats)
}

// ListPureMusicWhitelist GET /api/v1/pure-music-whitelist
// 分页参数：page（默认 1）、limit（默认 100，范围 1-1000）
func (h *NotFoundHandler) ListPureMusicWhitelist(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	page, limit := parsePaging(c)
	offset := (page - 1) * limit

	items, total, err := h.svc.ListPureMusicWhitelist(ctx, limit, offset)
	if err != nil {
		logrus.WithError(err).Error("list pure music whitelist failed")
		pkg.InternalError(c, "查询纯音乐白名单失败")
		return
	}

	pkg.OK(c, gin.H{
		"total": total,
		"page":  page,
		"limit": limit,
		"items": items,
	})
}

// ListCloudMusicWhitelist GET /api/v1/cloud-music-whitelist
// 分页参数：page（默认 1）、limit（默认 100，范围 1-1000）
func (h *NotFoundHandler) ListCloudMusicWhitelist(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	page, limit := parsePaging(c)
	offset := (page - 1) * limit

	items, total, err := h.svc.ListCloudMusicWhitelist(ctx, limit, offset)
	if err != nil {
		logrus.WithError(err).Error("list cloud music whitelist failed")
		pkg.InternalError(c, "查询云盘音乐白名单失败")
		return
	}

	pkg.OK(c, gin.H{
		"total": total,
		"page":  page,
		"limit": limit,
		"items": items,
	})
}

// parsePaging 解析分页参数
func parsePaging(c *gin.Context) (int, int) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit < 1 || limit > 1000 {
		limit = 100
	}
	return page, limit
}

// GetClientIP 从请求中获取客户端 IP
// 使用 gin 的 ClientIP（处理受信代理），为空时回退到 RemoteAddr
func GetClientIP(c *gin.Context) string {
	if ip := c.ClientIP(); ip != "" {
		return ip
	}
	return c.Request.RemoteAddr
}
