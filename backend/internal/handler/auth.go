package handler

import (
	"context"
	"io"
	"path/filepath"
	"strings"

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
		msg := err.Error()
		if strings.Contains(msg, "锁定") {
			pkg.Fail(c, 429, 429, msg)
			return
		}
		pkg.Fail(c, 401, 401, msg)
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
		logrus.WithError(err).Warn("register failed")
		pkg.Fail(c, 400, 400, "注册失败: "+err.Error())
		return
	}
	pkg.OKWithMsg(c, nil, "注册成功")
}

// SendCode POST /api/v1/auth/send-code
func (h *AuthHandler) SendCode(c *gin.Context) {
	var req struct {
		CheckType string `json:"checkType"`
		Dest      string `json:"dest" binding:"required"`
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

	if err := h.svc.SendVerificationCode(ctx, req.CheckType, req.Dest); err != nil {
		msg := err.Error()
		if strings.Contains(msg, "60s") {
			pkg.Fail(c, 429, 429, msg)
			return
		}
		logrus.WithError(err).Warn("send verification code failed")
		pkg.Fail(c, 502, 502, "发送验证码失败: "+msg)
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
		logrus.WithError(err).Warn("forgot password failed")
		pkg.Fail(c, 400, 400, "密码重置失败: "+err.Error())
		return
	}
	pkg.OKWithMsg(c, nil, "密码重置成功")
}

// GetProfile GET /api/v1/auth/profile
func (h *AuthHandler) GetProfile(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Fail(c, 401, 401, "unauthorized")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	profile, err := h.svc.GetProfile(ctx, userID)
	if err != nil {
		logrus.WithError(err).Warn("get profile failed")
		pkg.Fail(c, 502, 502, "获取资料失败: "+err.Error())
		return
	}
	pkg.OK(c, profile)
}

// UpdateProfile PUT /api/v1/auth/profile
func (h *AuthHandler) UpdateProfile(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Fail(c, 401, 401, "unauthorized")
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
		logrus.WithError(err).Warn("update profile failed")
		pkg.Fail(c, 400, 400, "更新资料失败: "+err.Error())
		return
	}
	pkg.OK(c, profile)
}

// ChangePassword POST /api/v1/auth/change-password
func (h *AuthHandler) ChangePassword(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Fail(c, 401, 401, "unauthorized")
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
		logrus.WithError(err).Warn("change password failed")
		pkg.Fail(c, 400, 400, "密码修改失败: "+err.Error())
		return
	}
	pkg.OKWithMsg(c, nil, "密码修改成功")
}

// UploadAvatar POST /api/v1/auth/avatar
func (h *AuthHandler) UploadAvatar(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Fail(c, 401, 401, "unauthorized")
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
		pkg.Fail(c, 400, 400, "头像上传失败: "+err.Error())
		return
	}
	pkg.OK(c, gin.H{"avatar": avatarURL})
}
