package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/amll-dev/amll-hub/backend/internal/middleware"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// SubmissionHandler 投稿 handler
type SubmissionHandler struct {
	svc           *service.SubmissionService
	reviewerCache *middleware.ReviewerCache
}

// NewSubmissionHandler 创建 handler
func NewSubmissionHandler(svc *service.SubmissionService, rc *middleware.ReviewerCache) *SubmissionHandler {
	return &SubmissionHandler{svc: svc, reviewerCache: rc}
}

// Create POST /api/v1/submissions
func (h *SubmissionHandler) Create(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}

	var req service.CreateSubmissionInput
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "参数错误")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	id, err := h.svc.Create(ctx, user, &req)
	if err != nil {
		writeSubmissionErr(c, err)
		return
	}
	pkg.OK(c, gin.H{"id": id})
}

// List GET /api/v1/submissions
func (h *SubmissionHandler) List(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	q := service.SubmissionListQuery{
		Mode:     c.DefaultQuery("mode", "creator"),
		Status:   c.DefaultQuery("status", "all"),
		Language: c.Query("language"),
		Search:   c.Query("search"),
		Page:     page,
		Limit:    limit,
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	// reviewer 模式查询全部投稿
	if q.Mode == "reviewer" {
		ok, err := h.reviewerCache.IsReviewer(ctx, user.Name)
		if err != nil {
			logrus.WithError(err).Error("query reviewer list failed")
			pkg.InternalError(c, "查询审核员名单失败")
			return
		}
		if !ok {
			pkg.Fail(c, http.StatusForbidden, http.StatusForbidden, "需要审核员权限")
			return
		}
	}

	result, err := h.svc.List(ctx, user, q)
	if err != nil {
		logrus.WithError(err).Error("list submissions failed")
		pkg.InternalError(c, "查询列表失败")
		return
	}
	pkg.OK(c, gin.H{
		"total": result.Total,
		"items": result.Items,
	})
}

// GetDetail GET /api/v1/submissions/:id
func (h *SubmissionHandler) GetDetail(c *gin.Context) {
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

	isReviewer := false
	if h.reviewerCache != nil {
		isReviewer, _ = h.reviewerCache.IsReviewer(c.Request.Context(), user.Name)
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	detail, err := h.svc.GetDetail(ctx, user, id, isReviewer)
	if err != nil {
		writeSubmissionErr(c, err)
		return
	}
	pkg.OK(c, detail)
}

// Stats GET /api/v1/submissions/stats
func (h *SubmissionHandler) Stats(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}

	mode := c.DefaultQuery("mode", "creator")
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	// reviewer 模式查询全局统计
	if mode == "reviewer" {
		ok, err := h.reviewerCache.IsReviewer(ctx, user.Name)
		if err != nil {
			logrus.WithError(err).Error("query reviewer list failed")
			pkg.InternalError(c, "查询审核员名单失败")
			return
		}
		if !ok {
			pkg.Fail(c, http.StatusForbidden, http.StatusForbidden, "需要审核员权限")
			return
		}
	}

	stats, err := h.svc.Stats(ctx, user, mode)
	if err != nil {
		logrus.WithError(err).Error("get submission stats failed")
		pkg.InternalError(c, "查询统计失败")
		return
	}
	pkg.OK(c, stats)
}

// UpdateFile PUT /api/v1/submissions/:id/file
func (h *SubmissionHandler) UpdateFile(c *gin.Context) {
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
		FileName string                         `json:"fileName" binding:"required"`
		Metadata *service.CreateSubmissionInput `json:"metadata,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "参数错误")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.svc.UpdateFile(ctx, user, id, req.FileName, req.Metadata); err != nil {
		writeSubmissionErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "文件已更新")
}

// Close POST /api/v1/submissions/:id/close
func (h *SubmissionHandler) Close(c *gin.Context) {
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

	// 检查是否审核员
	isReviewer := false
	if h.reviewerCache != nil {
		isReviewer, _ = h.reviewerCache.IsReviewer(c.Request.Context(), user.Name)
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.svc.Close(ctx, user, id, isReviewer); err != nil {
		writeSubmissionErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "已关闭")
}

// GetTtml GET /api/v1/submissions/:id/ttml
// 返回投稿的 TTML 文件纯文本内容
func (h *SubmissionHandler) GetTtml(c *gin.Context) {
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

	// 检查是否审核员
	isReviewer := false
	if h.reviewerCache != nil {
		isReviewer, _ = h.reviewerCache.IsReviewer(c.Request.Context(), user.Name)
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	content, err := h.svc.GetTtmlContent(ctx, user, id, isReviewer)
	if err != nil {
		writeSubmissionErr(c, err)
		return
	}

	c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(content))
}

// currentUser 从 gin.Context 提取登录用户信息
func currentUser(c *gin.Context) *service.SubmissionUser {
	nameStr := middleware.GetUserName(c)
	if nameStr == "" {
		return nil
	}
	return &service.SubmissionUser{
		Name:        nameStr,
		DisplayName: middleware.GetUserDisplayName(c),
		Avatar:      middleware.GetUserAvatar(c),
	}
}

// writeSubmissionErr 统一处理投稿服务错误
func writeSubmissionErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrSubmissionNotFound):
		pkg.NotFound(c, "投稿不存在")
	case errors.Is(err, service.ErrMissingFile):
		pkg.BadRequest(c, "缺少文件")
	case errors.Is(err, service.ErrFileNotFound):
		pkg.Fail(c, http.StatusNotFound, http.StatusNotFound, "文件未上传或已过期")
	case errors.Is(err, service.ErrInvalidStatus):
		pkg.Fail(c, http.StatusConflict, http.StatusConflict, "投稿当前状态不允许此操作")
	case errors.Is(err, service.ErrForbidden):
		pkg.Fail(c, http.StatusForbidden, http.StatusForbidden, "无权操作该投稿")
	case errors.Is(err, service.ErrUpstreamUnavailable):
		writeUpstreamErr(c, err, "上游服务暂不可用")
	default:
		logrus.WithError(err).Error("submission service unknown error")
		pkg.InternalError(c, "内部错误")
	}
}
