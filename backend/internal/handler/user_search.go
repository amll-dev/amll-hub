package handler

import (
	"context"
	"strings"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
)

// UserSearchHandler 站点用户搜索
type UserSearchHandler struct {
	svc *service.UserSearchService
}

// NewUserSearchHandler 创建 handler
func NewUserSearchHandler(svc *service.UserSearchService) *UserSearchHandler {
	return &UserSearchHandler{svc: svc}
}

// Search GET /api/v1/users/search?q=&limit=
func (h *UserSearchHandler) Search(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	limit := pkg.Clamp(pkg.ParseInt(c.Query("limit"), 20), 1, 50)

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	result, err := h.svc.Search(ctx, q, limit)
	if err != nil {
		writeUpstreamErr(c, err, "用户服务暂不可用")
		return
	}
	pkg.OK(c, result)
}
