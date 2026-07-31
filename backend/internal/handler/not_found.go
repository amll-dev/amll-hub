package handler

import (
	"context"
	"net/http"
	"strconv"

	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
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
// 参数：
//   - limit: 返回数量（默认 all，可设置具体数量，超过总数返回全部）
//   - days: 时间范围（默认 7，最大 7，每周清空）
//   - platform: 平台筛选
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
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "查询排行榜失败: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":           200,
		"total":          total,
		"returned":       len(items),
		"requestedLimit": limitStr,
		"days":           days,
		"data":           items,
	})
}

// GetStats GET /api/v1/not-found-stats
func (h *NotFoundHandler) GetStats(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	stats, err := h.svc.GetStats(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "查询统计失败: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 200,
		"data": stats,
	})
}

// ListPureMusicWhitelist GET /api/v1/pure-music-whitelist
func (h *NotFoundHandler) ListPureMusicWhitelist(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	limit, offset := parsePaging(c)

	items, total, err := h.svc.ListPureMusicWhitelist(ctx, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "查询纯音乐白名单失败: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":   200,
		"total":  total,
		"offset": offset,
		"limit":  limit,
		"data":   items,
	})
}

// ListCloudMusicWhitelist GET /api/v1/cloud-music-whitelist
func (h *NotFoundHandler) ListCloudMusicWhitelist(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	limit, offset := parsePaging(c)

	items, total, err := h.svc.ListCloudMusicWhitelist(ctx, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "查询云盘音乐白名单失败: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":   200,
		"total":  total,
		"offset": offset,
		"limit":  limit,
		"data":   items,
	})
}

// parsePaging 解析分页参数
func parsePaging(c *gin.Context) (int, int) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit < 1 || limit > 1000 {
		limit = 100
	}
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

// GetClientIP 从请求中获取客户端 IP
// 使用 gin 的 ClientIP（处理受信代理），为空时回退到 RemoteAddr
func GetClientIP(c *gin.Context) string {
	if ip := c.ClientIP(); ip != "" {
		return ip
	}
	return c.Request.RemoteAddr
}
