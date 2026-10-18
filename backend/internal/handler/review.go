package handler

import (
	"context"
	"strconv"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
)

// ReviewHandler 审核 handler
type ReviewHandler struct {
	svc *service.ReviewService
}

// NewReviewHandler 创建审核 handler
func NewReviewHandler(svc *service.ReviewService) *ReviewHandler {
	return &ReviewHandler{svc: svc}
}

// Review POST /api/v1/submissions/:id/review
func (h *ReviewHandler) Review(c *gin.Context) {
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

	var req service.ReviewInput
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "参数错误")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.svc.Review(ctx, user, id, &req); err != nil {
		writeSubmissionErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "审核完成")
}

// MarkReviewing POST /api/v1/submissions/:id/mark-reviewing
func (h *ReviewHandler) MarkReviewing(c *gin.Context) {
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

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	held, err := h.svc.MarkReviewing(ctx, user, id)
	if err != nil {
		writeSubmissionErr(c, err)
		return
	}
	msg := "已标记为审核中"
	if !held {
		msg = "该稿件正由其他审核员处理"
	}
	pkg.OKWithMsg(c, gin.H{"held": held}, msg)
}

// Heartbeat POST /api/v1/submissions/:id/review-heartbeat
// 审核员停留在详情页期间定时刷新审核占用租约
func (h *ReviewHandler) Heartbeat(c *gin.Context) {
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

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	held, status, err := h.svc.Heartbeat(ctx, user, id)
	if err != nil {
		writeSubmissionErr(c, err)
		return
	}
	pkg.OK(c, gin.H{"held": held, "status": status})
}

// ReleaseReview POST /api/v1/submissions/:id/release-review
// 审核员离开详情页时释放审核占用
func (h *ReviewHandler) ReleaseReview(c *gin.Context) {
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

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.svc.ReleaseReview(ctx, user, id); err != nil {
		writeSubmissionErr(c, err)
		return
	}
	pkg.OK(c, nil)
}
