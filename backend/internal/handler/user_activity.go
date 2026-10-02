package handler

import (
	"context"
	"strconv"

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

	year := 0
	if y := c.Query("year"); y != "" {
		var err error
		if year, err = strconv.Atoi(y); err != nil || year < 2000 || year > 9999 {
			pkg.BadRequest(c, "无效的 year")
			return
		}
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
