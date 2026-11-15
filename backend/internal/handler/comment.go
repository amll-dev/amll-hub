package handler

import (
	"context"
	"strconv"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// CommentHandler 评论 handler
type CommentHandler struct {
	svc *service.SubmissionService
}

// NewCommentHandler 创建评论 handler
func NewCommentHandler(svc *service.SubmissionService) *CommentHandler {
	return &CommentHandler{svc: svc}
}

// List GET /api/v1/submissions/:id/comments
func (h *CommentHandler) List(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}

	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		pkg.BadRequest(c, "无效的 id")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	// 把调用者身份传进 service：可见范围 = 本人 + 审核员/管理员，越权返回 404。
	// 审核名单查询失败时按非审核员处理（fail-closed），不放大可见范围。
	isReviewer, err := h.svc.CanManageSubmission(ctx, user.Name)
	if err != nil {
		logrus.WithError(err).Warn("check reviewer for comment list failed")
		isReviewer = false
	}

	comments, err := h.svc.ListComments(ctx, id, user.Name, isReviewer)
	if err != nil {
		writeSubmissionErr(c, err)
		return
	}

	pkg.OK(c, comments)
}

// Create POST /api/v1/submissions/:id/comments
func (h *CommentHandler) Create(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}

	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		pkg.BadRequest(c, "无效的 id")
		return
	}

	var req struct {
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "评论内容必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	// 与 List 一致：只有投稿者本人或审核员/管理员能评论，
	// 归属不符按 404 处理（不泄露投稿是否存在）。
	isReviewer, err := h.svc.CanManageSubmission(ctx, user.Name)
	if err != nil {
		logrus.WithError(err).Warn("check reviewer for add comment failed")
		isReviewer = false
	}

	if err := h.svc.AddComment(ctx, user, id, req.Content, isReviewer); err != nil {
		writeSubmissionErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "评论成功")
}
