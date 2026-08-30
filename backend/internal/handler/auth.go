package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"

	"github.com/amll-dev/amll-hub/backend/internal/middleware"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// AuthHandler 认证 handler
type AuthHandler struct {
	svc           *service.AuthService
	reviewerCache *middleware.ReviewerCache
	adminCache    *middleware.AdminCache
}

// NewAuthHandler 创建 AuthHandler
func NewAuthHandler(svc *service.AuthService, rc *middleware.ReviewerCache, ac *middleware.AdminCache) *AuthHandler {
	return &AuthHandler{svc: svc, reviewerCache: rc, adminCache: ac}
}

// 根据用户名查询审核员/超级管理员缓存
func (h *AuthHandler) enrichReviewer(c *gin.Context, p *service.UserProfile) {
	if p == nil || p.Name == "" {
		return
	}
	if h.reviewerCache != nil {
		ok, _ := h.reviewerCache.IsReviewer(c.Request.Context(), p.Name)
		p.IsReviewer = ok
	}
	if h.adminCache != nil {
		ok, _ := h.adminCache.IsAdmin(c.Request.Context(), p.Name)
		p.IsAdmin = ok
	}
}

// Login POST /api/v1/auth/login
func (h *AuthHandler) Login(c *gin.Context) {
	var req struct {
		Username string `json:"username" binding:"required"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "用户名和密码必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.Login(ctx, req.Username, req.Password)
	if err != nil {
		writeAuthErr(c, err)
		return
	}
	h.enrichReviewer(c, &result.User)
	pkg.OK(c, result)
}

// LoginByCode POST /api/v1/auth/login-code
// 验证码登录
func (h *AuthHandler) LoginByCode(c *gin.Context) {
	var req struct {
		Dest string `json:"dest" binding:"required"`
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "邮箱/手机号和验证码必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.LoginByCode(ctx, req.Dest, req.Code)
	if err != nil {
		writeAuthErr(c, err)
		return
	}
	h.enrichReviewer(c, &result.User)
	pkg.OK(c, result)
}

// Register POST /api/v1/auth/register
func (h *AuthHandler) Register(c *gin.Context) {
	var req service.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "参数错误")
		return
	}
	if req.Username == "" || req.Password == "" || req.Phone == "" || req.Code == "" || req.Email == "" || req.EmailCode == "" || req.DisplayName == "" {
		pkg.BadRequest(c, "用户名、昵称、密码、手机号、手机验证码、邮箱、邮箱验证码必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.svc.Register(ctx, req); err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "注册成功")
}

// SendCode POST /api/v1/auth/send-code
func (h *AuthHandler) SendCode(c *gin.Context) {
	var req struct {
		CheckType    string `json:"checkType"`
		Dest         string `json:"dest" binding:"required"`
		Method       string `json:"method"`
		CaptchaType  string `json:"captchaType"`
		CaptchaToken string `json:"captchaToken"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "dest 参数必填")
		return
	}
	if req.CheckType == "" {
		req.CheckType = "email"
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.svc.SendVerificationCode(ctx, req.CheckType, req.Dest, req.CaptchaType, req.CaptchaToken, req.Method); err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "验证码已发送")
}

// POST /api/v1/auth/check-user
// 检查账号是否存在
func (h *AuthHandler) CheckUser(c *gin.Context) {
	var req struct {
		CheckType string `json:"checkType"`
		Dest      string `json:"dest" binding:"required"`
		Method    string `json:"method"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "dest 参数必填")
		return
	}
	if req.CheckType == "" {
		req.CheckType = "email"
	}
	if req.Method == "" {
		req.Method = "login"
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.svc.CheckUserExists(ctx, req.CheckType, req.Dest, req.Method); err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "校验通过")
}

// ForgotPassword POST /api/v1/auth/forgot-password
func (h *AuthHandler) ForgotPassword(c *gin.Context) {
	var req struct {
		Dest        string `json:"dest" binding:"required"`
		Code        string `json:"code" binding:"required"`
		NewPassword string `json:"newPassword" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "手机号/邮箱、验证码、新密码必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.svc.ForgotPassword(ctx, req.Dest, req.Code, req.NewPassword); err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "密码重置成功")
}

// GetCaptcha GET /api/v1/auth/captcha
func (h *AuthHandler) GetCaptcha(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	data, err := h.svc.GetCaptcha(ctx)
	if err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OK(c, json.RawMessage(data))
}

// GetProfile GET /api/v1/auth/profile
func (h *AuthHandler) GetProfile(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	profile, err := h.svc.GetProfile(ctx, userID)
	if err != nil {
		writeAuthErr(c, err)
		return
	}
	h.enrichReviewer(c, profile)
	pkg.OK(c, profile)
}

// UpdateProfile PUT /api/v1/auth/profile
func (h *AuthHandler) UpdateProfile(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}

	var req service.UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "参数错误")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	profile, err := h.svc.UpdateProfile(ctx, userID, req)
	if err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OK(c, profile)
}

// ChangePassword POST /api/v1/auth/change-password
func (h *AuthHandler) ChangePassword(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}

	var req struct {
		OldPassword string `json:"oldPassword" binding:"required"`
		NewPassword string `json:"newPassword" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "旧密码和新密码必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.svc.ChangePassword(ctx, userID, req.OldPassword, req.NewPassword); err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "密码修改成功")
}

// UploadAvatar POST /api/v1/auth/avatar
func (h *AuthHandler) UploadAvatar(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		pkg.BadRequest(c, "请上传文件")
		return
	}
	defer file.Close()

	// 限制头像大小为 50MB
	const maxAvatarUpload = 50 * 1024 * 1024
	fileBytes, err := readLimited(file, maxAvatarUpload)
	if err != nil {
		logrus.WithError(err).Warn("read avatar file failed")
		pkg.BadRequest(c, err.Error())
		return
	}

	filename := header.Filename
	if filename == "" {
		filename = "avatar"
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	avatarURL, err := h.svc.UploadAvatar(ctx, userID, fileBytes, filename)
	if err != nil {
		logrus.WithError(err).WithField("filename", filepath.Base(filename)).Warn("upload avatar failed")
		writeAuthErr(c, err)
		return
	}
	pkg.OK(c, gin.H{"avatar": avatarURL})
}

// writeAuthErr 统一处理认证服务错误
func writeAuthErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrAccountLocked):
		pkg.Fail(c, http.StatusTooManyRequests, http.StatusTooManyRequests, "账户已锁定，请稍后再试")
	case errors.Is(err, service.ErrInvalidCredentials):
		pkg.Fail(c, http.StatusUnauthorized, http.StatusUnauthorized, "用户名或密码错误")
	case errors.Is(err, service.ErrInvalidCode):
		pkg.Fail(c, http.StatusBadRequest, http.StatusBadRequest, "验证码错误")
	case errors.Is(err, service.ErrCodeExpired):
		pkg.Fail(c, http.StatusBadRequest, http.StatusBadRequest, "验证码已失效，请重新获取")
	case errors.Is(err, service.ErrUserNotFound):
		pkg.Fail(c, http.StatusNotFound, http.StatusNotFound, "该手机号/邮箱未注册")
	case errors.Is(err, service.ErrUserAlreadyExists):
		pkg.Fail(c, http.StatusConflict, http.StatusConflict, "用户名或手机号已存在")
	case errors.Is(err, service.ErrSendCodeCooldown):
		pkg.Fail(c, http.StatusTooManyRequests, http.StatusTooManyRequests, "验证码发送过于频繁，请稍后再试")
	case errors.Is(err, service.ErrInvalidInput):
		pkg.BadRequest(c, "请求参数非法")
	case errors.Is(err, service.ErrUpstreamUnavailable):
		writeUpstreamErr(c, err, "认证服务暂不可用")
	default:
		logrus.WithError(err).Warn("auth service unknown error")
		pkg.InternalError(c, "内部错误")
	}
}
