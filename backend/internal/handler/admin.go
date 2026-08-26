package handler

import (
	"context"
	"regexp"

	"github.com/amll-dev/amll-hub/backend/internal/middleware"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// 超级管理员 handler：管理审核员名单
type AdminHandler struct {
	repo          *repository.ReviewerRepo
	reviewerCache *middleware.ReviewerCache
}

// 创建 AdminHandler
func NewAdminHandler(repo *repository.ReviewerRepo, rc *middleware.ReviewerCache) *AdminHandler {
	return &AdminHandler{repo: repo, reviewerCache: rc}
}

// 用户名格式：字母数字下划线连字符，2-100 位
var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{2,100}$`)

// ListReviewers GET /api/v1/admin/reviewers
// 列出全部审核员用户名
func (h *AdminHandler) ListReviewers(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	names, err := h.repo.ListAll(ctx)
	if err != nil {
		logrus.WithError(err).Error("list reviewers failed")
		pkg.InternalError(c, "查询审核员名单失败")
		return
	}
	pkg.OK(c, gin.H{"items": names, "total": len(names)})
}

// AddReviewer POST /api/v1/admin/reviewers
// 添加审核员 { username }
func (h *AdminHandler) AddReviewer(c *gin.Context) {
	var req struct {
		Username string `json:"username" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "username 必填")
		return
	}
	if !usernamePattern.MatchString(req.Username) {
		pkg.BadRequest(c, "用户名格式不合法")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	if err := h.repo.Add(ctx, req.Username); err != nil {
		logrus.WithError(err).Warn("add reviewer failed")
		pkg.BadRequest(c, "添加审核员失败")
		return
	}
	// 名单变更后立即失效缓存
	h.reviewerCache.Invalidate()
	pkg.OK(c, gin.H{"username": req.Username})
}

// RemoveReviewer DELETE /api/v1/admin/reviewers/:username
// 移除审核员
func (h *AdminHandler) RemoveReviewer(c *gin.Context) {
	username := c.Param("username")
	if !usernamePattern.MatchString(username) {
		pkg.BadRequest(c, "用户名格式不合法")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	if err := h.repo.Remove(ctx, username); err != nil {
		logrus.WithError(err).Warn("remove reviewer failed")
		pkg.BadRequest(c, "移除审核员失败")
		return
	}
	h.reviewerCache.Invalidate()
	pkg.OK(c, gin.H{"username": username})
}
