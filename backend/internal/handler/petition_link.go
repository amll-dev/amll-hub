package handler

import (
	"context"
	"errors"
	"strconv"

	"github.com/amll-dev/amll-hub/backend/internal/middleware"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// PetitionLinkHandler 投稿 ↔ 歌词请愿关联
type PetitionLinkHandler struct {
	svc       *service.PetitionLinkService
	reviewers *middleware.ReviewerCache
	admins    *middleware.AdminCache
}

// NewPetitionLinkHandler 创建 PetitionLinkHandler
func NewPetitionLinkHandler(
	svc *service.PetitionLinkService,
	reviewers *middleware.ReviewerCache,
	admins *middleware.AdminCache,
) *PetitionLinkHandler {
	return &PetitionLinkHandler{svc: svc, reviewers: reviewers, admins: admins}
}

// Match POST /api/v1/lyric-requests/match
// 投稿表单解析出平台 ID 后，用来查询是否有对应的待处理请愿
func (h *PetitionLinkHandler) Match(c *gin.Context) {
	if middleware.GetUserName(c) == "" {
		pkg.Unauthorized(c)
		return
	}
	var body struct {
		PlatformIDs map[string][]string `json:"platformIds"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		pkg.BadRequest(c, "参数错误")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	items, err := h.svc.Match(ctx, body.PlatformIDs)
	if err != nil {
		logrus.WithError(err).Error("match petitions failed")
		pkg.InternalError(c, "查询关联请愿失败")
		return
	}
	pkg.OK(c, gin.H{"items": items})
}

// List GET /api/v1/submissions/:id/petitions
func (h *PetitionLinkHandler) List(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	items, err := h.svc.ListBySubmission(ctx, id)
	if err != nil {
		logrus.WithError(err).Error("list petition links failed")
		pkg.InternalError(c, "查询关联请愿失败")
		return
	}
	pkg.OK(c, gin.H{"items": items})
}

// Unbind DELETE /api/v1/submissions/:id/petitions/:requestId
func (h *PetitionLinkHandler) Unbind(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	id, ok := parseID(c)
	if !ok {
		return
	}
	requestID, err := strconv.ParseInt(c.Param("requestId"), 10, 64)
	if err != nil || requestID <= 0 {
		pkg.BadRequest(c, "无效的 requestId")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	canManage := false
	if h.reviewers != nil {
		if ok, err := h.reviewers.IsReviewer(ctx, user.Name); err == nil && ok {
			canManage = true
		}
	}
	if !canManage && h.admins != nil {
		if ok, err := h.admins.IsAdmin(ctx, user.Name); err == nil && ok {
			canManage = true
		}
	}

	if err := h.svc.Unbind(ctx, id, requestID, user.Name, canManage); err != nil {
		switch {
		case errors.Is(err, service.ErrPetitionLinkNotFound):
			pkg.NotFound(c, "关联不存在")
		case errors.Is(err, service.ErrSubmissionNotFound):
			pkg.NotFound(c, "投稿不存在")
		case errors.Is(err, service.ErrForbidden):
			pkg.Forbidden(c)
		default:
			logrus.WithError(err).Error("unbind petition failed")
			pkg.InternalError(c, "解除关联失败")
		}
		return
	}
	pkg.OKWithMsg(c, nil, "已解除关联")
}
