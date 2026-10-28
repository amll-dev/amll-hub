package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/amll-dev/amll-hub/backend/internal/middleware"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// 公开主页投稿列表的默认每页条数与上限
const (
	publicSubmissionPageSize    = 20
	publicSubmissionMaxPageSize = 50
)

// 允许的列表筛选值（白名单，其它值一律忽略）
var (
	publicSubmissionSorts     = map[string]bool{"newest": true, "oldest": true, "updated": true}
	publicSubmissionLanguages = map[string]bool{"zh": true, "en": true, "ja": true, "ko": true, "others": true}
	publicSubmissionStatuses  = map[string]bool{
		"all": true, "processing": true,
		"draft": true, "pending": true, "reviewing": true, "revised": true,
		"need_revision": true, "missing_audio": true,
		"approved": true, "rejected": true, "closed": true,
	}
)

// UserProfileHandler 公开用户主页
type UserProfileHandler struct {
	svc *service.UserProfileService
}

// NewUserProfileHandler 创建 handler
func NewUserProfileHandler(svc *service.UserProfileService) *UserProfileHandler {
	return &UserProfileHandler{svc: svc}
}

// Get GET /api/v1/users/:name
func (h *UserProfileHandler) Get(c *gin.Context) {
	name, ok := profileNameParam(c)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	profile, err := h.svc.GetPublicProfile(ctx, name, middleware.GetUserName(c))
	if err != nil {
		writeUserProfileErr(c, err)
		return
	}
	pkg.OK(c, profile)
}

// ListSubmissions GET /api/v1/users/:name/submissions
func (h *UserProfileHandler) ListSubmissions(c *gin.Context) {
	name, ok := profileNameParam(c)
	if !ok {
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", strconv.Itoa(publicSubmissionPageSize)))
	if limit < 1 {
		limit = publicSubmissionPageSize
	}
	if limit > publicSubmissionMaxPageSize {
		limit = publicSubmissionMaxPageSize
	}

	q := service.PublicSubmissionQuery{Page: page, Limit: limit}
	if v := c.Query("status"); publicSubmissionStatuses[v] {
		q.Status = v
	}
	if v := c.Query("language"); publicSubmissionLanguages[v] {
		q.Language = v
	}
	if v := c.Query("sort"); publicSubmissionSorts[v] {
		q.Sort = v
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	// 只有本人（登录且用户名一致）才能看到非 approved 的投稿
	isSelf := middleware.GetUserName(c) == name

	list, err := h.svc.ListPublicSubmissions(ctx, name, isSelf, q)
	if err != nil {
		writeUserProfileErr(c, err)
		return
	}
	pkg.OK(c, list)
}

// UpdateMe PUT /api/v1/users/me/profile
func (h *UserProfileHandler) UpdateMe(c *gin.Context) {
	username := middleware.GetUserName(c)
	if username == "" {
		pkg.Unauthorized(c)
		return
	}

	var req service.UpdateMyProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "请求体格式错误")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	fields, err := h.svc.UpdateMyProfile(ctx, username, req)
	if err != nil {
		writeUserProfileErr(c, err)
		return
	}
	pkg.OK(c, fields)
}

// UploadBanner POST /api/v1/users/me/banner
func (h *UserProfileHandler) UploadBanner(c *gin.Context) {
	username := middleware.GetUserName(c)
	if username == "" {
		pkg.Unauthorized(c)
		return
	}

	fh, err := c.FormFile("file")
	if err != nil {
		pkg.BadRequest(c, "file 字段必填")
		return
	}
	f, err := fh.Open()
	if err != nil {
		logrus.WithError(err).Warn("open profile banner failed")
		pkg.BadRequest(c, "读取文件失败")
		return
	}
	defer f.Close()

	content, err := readLimited(f, service.MaxProfileBannerSize)
	if err != nil {
		pkg.BadRequest(c, err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	key, err := h.svc.UploadBanner(ctx, username, content)
	if err != nil {
		writeUserProfileErr(c, err)
		return
	}
	pkg.OK(c, gin.H{"bannerKey": key})
}

// profileNameParam 读取并校验 :name 路径参数；非法时已写响应并返回 false
func profileNameParam(c *gin.Context) (string, bool) {
	name := strings.TrimSpace(c.Param("name"))
	if !validProfileName(name) {
		pkg.BadRequest(c, "无效的用户名")
		return "", false
	}
	return name, true
}

// validProfileName 用户名长度与非法字符校验（Casdoor username 是字符串主键）
func validProfileName(name string) bool {
	if name == "" || len(name) > 100 {
		return false
	}
	if strings.ContainsAny(name, "/\\") || strings.Contains(name, "..") {
		return false
	}
	return true
}

// writeUserProfileErr 统一映射主页相关错误
func writeUserProfileErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrUserNotFound):
		pkg.Fail(c, http.StatusNotFound, http.StatusNotFound, "用户不存在")
	case errors.Is(err, service.ErrInvalidInput):
		pkg.BadRequest(c, "参数不合法")
	case errors.Is(err, service.ErrUpstreamUnavailable):
		pkg.Fail(c, http.StatusBadGateway, http.StatusBadGateway, "用户服务暂不可用")
	default:
		logrus.WithError(err).Error("user profile operation failed")
		pkg.InternalError(c, "服务异常，请稍后重试")
	}
}
