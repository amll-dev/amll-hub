package handler

import (
	"context"
	"strconv"
	"strings"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
)

// UserActivityHandler 个人活动统计
type UserActivityHandler struct {
	svc *service.UserActivityService
}

// NewUserActivityHandler 创建 handler
func NewUserActivityHandler(svc *service.UserActivityService) *UserActivityHandler {
	return &UserActivityHandler{svc: svc}
}

// Get GET /api/v1/users/me/activity?year=2026
func (h *UserActivityHandler) Get(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}

	year, ok := parseActivityYear(c)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	data, err := h.svc.GetActivity(ctx, user.Name, year)
	if err != nil {
		pkg.InternalError(c, "查询活动统计失败")
		return
	}
	pkg.OK(c, data)
}

// GetPublic GET /api/v1/users/:name/activity?year=2026
// 访客视角：只统计已通过投稿，不含审核行为。
func (h *UserActivityHandler) GetPublic(c *gin.Context) {
	name := strings.TrimSpace(c.Param("name"))
	if !validProfileName(name) {
		pkg.BadRequest(c, "无效的用户名")
		return
	}

	year, ok := parseActivityYear(c)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	data, err := h.svc.GetPublicActivity(ctx, name, year)
	if err != nil {
		pkg.InternalError(c, "查询活动统计失败")
		return
	}
	pkg.OK(c, data)
}

// parseActivityYear 解析 year 查询参数；非法时已写响应并返回 false
func parseActivityYear(c *gin.Context) (int, bool) {
	raw := c.Query("year")
	if raw == "" {
		return 0, true
	}
	year, err := strconv.Atoi(raw)
	if err != nil || year < 2000 || year > 9999 {
		pkg.BadRequest(c, "无效的 year")
		return 0, false
	}
	return year, true
}
