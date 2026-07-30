package handler

import (
	"context"
	"strconv"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
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
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		pkg.BadRequest(c, "无效的 id")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	comments, err := h.svc.ListComments(ctx, id)
	if err != nil {
		pkg.InternalError(c, "查询评论失败: "+err.Error())
		return
	}
	c.JSON(200, gin.H{
		"code": 200,
		"data": comments,
	})
}

// Create POST /api/v1/submissions/:id/comments
func (h *CommentHandler) Create(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Fail(c, 401, 401, "未登录")
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

	if err := h.svc.AddComment(ctx, user, id, req.Content); err != nil {
		writeSubmissionErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "评论成功")
}
