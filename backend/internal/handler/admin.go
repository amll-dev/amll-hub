package handler

import (
	"context"
	"regexp"

	"github.com/amll-dev/amll-hub/backend/internal/middleware"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// 超级管理员 handler：管理审核员名单
type AdminHandler struct {
	repo          *repository.ReviewerRepo
	reviewerCache *middleware.ReviewerCache
	users         *service.UserSearchService
}

// 创建 AdminHandler
func NewAdminHandler(
	repo *repository.ReviewerRepo,
	rc *middleware.ReviewerCache,
	users *service.UserSearchService,
) *AdminHandler {
	return &AdminHandler{repo: repo, reviewerCache: rc, users: users}
}

// 用户名格式：字母数字下划线连字符，2-100 位
var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{2,100}$`)

// reviewerItem 审核员展示信息
type reviewerItem struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
}

// ListReviewers GET /api/v1/admin/reviewers
// 列出全部审核员
func (h *AdminHandler) ListReviewers(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	names, err := h.repo.ListAll(ctx)
	if err != nil {
		logrus.WithError(err).Error("list reviewers failed")
		pkg.InternalError(c, "查询审核员名单失败")
		return
	}

	items := make([]reviewerItem, 0, len(names))
	if h.users != nil && len(names) > 0 {
		infos := h.users.GetInfos(ctx, names)
		for _, name := range names {
			item := reviewerItem{Name: name}
			if u, ok := infos[name]; ok {
				item.DisplayName = u.DisplayName
				item.Avatar = u.Avatar
			}
			items = append(items, item)
		}
	} else {
		for _, name := range names {
			items = append(items, reviewerItem{Name: name})
		}
	}
	pkg.OK(c, gin.H{"items": items, "total": len(items)})
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
