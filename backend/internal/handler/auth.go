package handler

import (
	"context"
	"errors"
	"io"
	"path/filepath"

	"github.com/amll-dev/amll-hub/backend/internal/middleware"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// AuthHandler 认证 handler
type AuthHandler struct {
	svc *service.AuthService
}

// NewAuthHandler 创建 AuthHandler
func NewAuthHandler(svc *service.AuthService) *AuthHandler {
	return &AuthHandler{svc: svc}
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
	pkg.OK(c, result)
}

// Register POST /api/v1/auth/register
func (h *AuthHandler) Register(c *gin.Context) {
	var req service.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "参数错误")
		return
	}
	if req.Username == "" || req.Password == "" || req.Email == "" || req.Code == "" {
		pkg.BadRequest(c, "用户名、密码、邮箱、验证码必填")
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

	if err := h.svc.SendVerificationCode(ctx, req.CheckType, req.Dest, req.CaptchaType, req.CaptchaToken); err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "验证码已发送")
}

// ForgotPassword POST /api/v1/auth/forgot-password
func (h *AuthHandler) ForgotPassword(c *gin.Context) {
	var req struct {
		Email       string `json:"email" binding:"required"`
		Code        string `json:"code" binding:"required"`
		NewPassword string `json:"newPassword" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "邮箱、验证码、新密码必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.svc.ForgotPassword(ctx, req.Email, req.Code, req.NewPassword); err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "密码重置成功")
}

// GetProfile GET /api/v1/auth/profile
func (h *AuthHandler) GetProfile(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Fail(c, 401, 401, "未登录")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	profile, err := h.svc.GetProfile(ctx, userID)
	if err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OK(c, profile)
}

// UpdateProfile PUT /api/v1/auth/profile
func (h *AuthHandler) UpdateProfile(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Fail(c, 401, 401, "未登录")
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
		pkg.Fail(c, 401, 401, "未登录")
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
		pkg.Fail(c, 401, 401, "未登录")
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		pkg.BadRequest(c, "请上传文件")
		return
	}
	defer file.Close()

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		logrus.WithError(err).Warn("read avatar file failed")
		pkg.InternalError(c, "读取文件失败")
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
		pkg.Fail(c, 429, 429, "账户已锁定，请稍后再试")
	case errors.Is(err, service.ErrInvalidCredentials):
		pkg.Fail(c, 401, 401, "用户名或密码错误")
	case errors.Is(err, service.ErrSendCodeCooldown):
		pkg.Fail(c, 429, 429, "验证码发送过于频繁，请稍后再试")
	case errors.Is(err, service.ErrInvalidInput):
		pkg.BadRequest(c, "请求参数非法")
	case errors.Is(err, service.ErrUpstreamUnavailable):
		pkg.Fail(c, 502, 502, "认证服务暂不可用")
	default:
		logrus.WithError(err).Warn("auth service unknown error")
		pkg.InternalError(c, "内部错误")
	}
}
