package handler

import (
	"context"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
)

// RevisionHandler 审核员修订版 handler
type RevisionHandler struct {
	svc *service.RevisionService
}

// NewRevisionHandler 创建审核修订 handler
func NewRevisionHandler(svc *service.RevisionService) *RevisionHandler {
	return &RevisionHandler{svc: svc}
}

// GetEditorContext GET /api/v1/submissions/:id/editor-context
// 审核员进入编辑器时拉取：原投稿 TTML + 可选音频列表
func (h *RevisionHandler) GetEditorContext(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	id, ok := parseIDParam(c)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	data, err := h.svc.GetEditorContext(ctx, id)
	if err != nil {
		writeSubmissionErr(c, err)
		return
	}
	pkg.OK(c, data)
}

// Save POST /api/v1/submissions/:id/revision
func (h *RevisionHandler) Save(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	id, ok := parseIDParam(c)
	if !ok {
		return
	}

	var req service.SaveRevisionInput
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "参数错误")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.svc.SaveRevision(ctx, user, id, &req); err != nil {
		writeSubmissionErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "已保存")
}

// GetRevisionContent GET /api/v1/submissions/:id/revision/ttml
// 投稿者与审核员查看修订版 TTML 原文
func (h *RevisionHandler) GetRevisionContent(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	id, ok := parseIDParam(c)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	content, err := h.svc.GetRevisionContent(ctx, user, id)
	if err != nil {
		writeSubmissionErr(c, err)
		return
	}
	c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(content))
}

// Adopt POST /api/v1/submissions/:id/revision/adopt
// 投稿者确认采用审核员修订版
func (h *RevisionHandler) Adopt(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	id, ok := parseIDParam(c)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.svc.AdoptRevision(ctx, user, id); err != nil {
		writeSubmissionErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "已采用审核员的修订版，投稿通过")
}

// Reject POST /api/v1/submissions/:id/revision/reject
// 投稿者选择保留原版
func (h *RevisionHandler) Reject(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	id, ok := parseIDParam(c)
	if !ok {
		return
	}

	var req struct {
		Reason string `json:"reason"`
	}
	// 允许空 body：reason可省略
	_ = c.ShouldBindJSON(&req)

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.svc.RejectRevision(ctx, user, id, req.Reason); err != nil {
		writeSubmissionErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "已保留你的版本，投稿转为需修改")
}

// parseIDParam 解析路径中的 :id，非法时直接写错误响应并返回 false
func parseIDParam(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		pkg.BadRequest(c, "无效的 id")
		return 0, false
	}
	return id, true
}
