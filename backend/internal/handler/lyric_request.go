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

// LyricRequestHandler 歌词请愿 handler
type LyricRequestHandler struct {
	svc *service.LyricRequestService
}

// NewLyricRequestHandler 创建 LyricRequestHandler
func NewLyricRequestHandler(svc *service.LyricRequestService) *LyricRequestHandler {
	return &LyricRequestHandler{svc: svc}
}

// lyricRequestUser 读取登录用户（游客返回 nil）
func lyricRequestUser(c *gin.Context) *service.LyricRequestUser {
	u := currentUser(c)
	if u == nil {
		return nil
	}
	return &service.LyricRequestUser{
		Name:        u.Name,
		DisplayName: u.DisplayName,
		Avatar:      u.Avatar,
	}
}

// parseID 解析路径中的 id
func parseID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		pkg.BadRequest(c, "无效的 id")
		return 0, false
	}
	return id, true
}

// List GET /api/v1/lyric-requests
func (h *LyricRequestHandler) List(c *gin.Context) {
	h.list(c, "")
}

// ListMine GET /api/v1/lyric-requests/mine
func (h *LyricRequestHandler) ListMine(c *gin.Context) {
	user := lyricRequestUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	h.list(c, user.Name)
}

// Hot GET /api/v1/lyric-requests/hot
func (h *LyricRequestHandler) Hot(c *gin.Context) {
	pageSize, _ := strconv.Atoi(c.DefaultQuery("limit", "6"))
	if pageSize <= 0 || pageSize > 20 {
		pageSize = 6
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	result, err := h.svc.List(ctx, service.LyricRequestListParams{
		Status:   "pending",
		Sort:     "hot",
		Page:     1,
		PageSize: pageSize,
	}, middleware.GetUserName(c))
	if err != nil {
		writeLyricRequestErr(c, err)
		return
	}
	pkg.OK(c, result)
}

func (h *LyricRequestHandler) list(c *gin.Context, mine string) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "12"))

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	result, err := h.svc.List(ctx, service.LyricRequestListParams{
		Status:   c.Query("status"),
		Keyword:  c.Query("q"),
		Sort:     c.Query("sort"),
		Page:     page,
		PageSize: pageSize,
		Mine:     mine,
	}, mineOrViewer(c, mine))
	if err != nil {
		writeLyricRequestErr(c, err)
		return
	}
	pkg.OK(c, result)
}

// mineOrViewer 我的列表用本人；全站列表用可选登录用户（判定 supported）
func mineOrViewer(c *gin.Context, mine string) string {
	if mine != "" {
		return mine
	}
	return middleware.GetUserName(c)
}

// Get GET /api/v1/lyric-requests/:id
func (h *LyricRequestHandler) Get(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	item, err := h.svc.Get(ctx, id, middleware.GetUserName(c))
	if err != nil {
		writeLyricRequestErr(c, err)
		return
	}
	pkg.OK(c, item)
}

// Create POST /api/v1/lyric-requests
func (h *LyricRequestHandler) Create(c *gin.Context) {
	user := lyricRequestUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	var in service.CreateLyricRequestInput
	if err := c.ShouldBindJSON(&in); err != nil {
		pkg.BadRequest(c, "请求参数格式不正确")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	result, err := h.svc.Create(ctx, user, &in)
	if err != nil {
		writeLyricRequestErr(c, err)
		return
	}
	if result.Merged {
		pkg.OKWithMsg(c, result, "这首歌已经有请愿了，已为你增加一次请愿")
		return
	}
	pkg.OKWithMsg(c, result, "请愿已发布")
}

// Update PUT /api/v1/lyric-requests/:id
func (h *LyricRequestHandler) Update(c *gin.Context) {
	user := lyricRequestUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	id, ok := parseID(c)
	if !ok {
		return
	}
	var in service.CreateLyricRequestInput
	if err := c.ShouldBindJSON(&in); err != nil {
		pkg.BadRequest(c, "请求参数格式不正确")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	if err := h.svc.Update(ctx, id, user, &in); err != nil {
		writeLyricRequestErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "已保存")
}

// Withdraw DELETE /api/v1/lyric-requests/:id
func (h *LyricRequestHandler) Withdraw(c *gin.Context) {
	user := lyricRequestUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	id, ok := parseID(c)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	if err := h.svc.Withdraw(ctx, id, user); err != nil {
		writeLyricRequestErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "请愿已撤回")
}

// ToggleSupport POST /api/v1/lyric-requests/:id/support
func (h *LyricRequestHandler) ToggleSupport(c *gin.Context) {
	user := lyricRequestUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	id, ok := parseID(c)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	supported, count, err := h.svc.ToggleSupport(ctx, id, user)
	if err != nil {
		writeLyricRequestErr(c, err)
		return
	}
	pkg.OK(c, gin.H{"supported": supported, "supportCount": count})
}

// ListComments GET /api/v1/lyric-requests/:id/comments
func (h *LyricRequestHandler) ListComments(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	comments, err := h.svc.ListComments(ctx, id)
	if err != nil {
		writeLyricRequestErr(c, err)
		return
	}
	pkg.OK(c, comments)
}

// CreateComment POST /api/v1/lyric-requests/:id/comments
func (h *LyricRequestHandler) CreateComment(c *gin.Context) {
	user := lyricRequestUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	id, ok := parseID(c)
	if !ok {
		return
	}
	var body struct {
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		pkg.BadRequest(c, "评论内容必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	comment, err := h.svc.AddComment(ctx, id, user, body.Content)
	if err != nil {
		writeLyricRequestErr(c, err)
		return
	}
	pkg.OKWithMsg(c, comment, "评论成功")
}

// SetStatus POST /api/v1/admin/lyric-requests/:id/status
func (h *LyricRequestHandler) SetStatus(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		pkg.BadRequest(c, "status 字段必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	if err := h.svc.SetStatus(ctx, id, body.Status); err != nil {
		writeLyricRequestErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "状态已更新")
}

// writeLyricRequestErr 统一错误响应
func writeLyricRequestErr(c *gin.Context, err error) {
	var ve *service.ValidationError
	switch {
	case errors.As(err, &ve):
		pkg.BadRequest(c, ve.Message)
	case errors.Is(err, service.ErrLyricRequestNotFound):
		pkg.NotFound(c, "请愿不存在")
	case errors.Is(err, service.ErrForbidden):
		pkg.Forbidden(c)
	default:
		logrus.WithError(err).Error("lyric request failed")
		pkg.InternalError(c, "内部错误，请稍后重试")
	}
}
