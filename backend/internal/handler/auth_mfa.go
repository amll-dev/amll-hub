package handler

import (
	"context"

	"github.com/amll-dev/amll-hub/backend/internal/middleware"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/gin-gonic/gin"
)

// GetMfaStatus GET /api/v1/auth/mfa
// 查询当前用户的 MFA 状态
func (h *AuthHandler) GetMfaStatus(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	status, err := h.svc.GetMfaStatus(ctx, userID)
	if err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OK(c, status)
}

// StartMfaSetup POST /api/v1/auth/mfa/setup/start
// 初始化 MFA 绑定
func (h *AuthHandler) StartMfaSetup(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}

	var req struct {
		MfaType string `json:"mfaType" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "mfaType 必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.StartMfaSetup(ctx, userID, req.MfaType)
	if err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OK(c, result)
}

// SendMfaSetupCode POST /api/v1/auth/mfa/setup/send-code
// 给 MFA 绑定会话发送邮箱/短信验证码
func (h *AuthHandler) SendMfaSetupCode(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}

	var req struct {
		ChallengeID  string `json:"challengeId" binding:"required"`
		CaptchaType  string `json:"captchaType"`
		CaptchaToken string `json:"captchaToken"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "challengeId 必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.svc.SendMfaSetupCode(ctx, userID, req.ChallengeID, req.CaptchaType, req.CaptchaToken); err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "验证码已发送")
}

// CompleteMfaSetup POST /api/v1/auth/mfa/setup/complete
// 校验验证码并启用 MFA
func (h *AuthHandler) CompleteMfaSetup(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}

	var req struct {
		ChallengeID string `json:"challengeId" binding:"required"`
		Passcode    string `json:"passcode" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "challengeId 和 passcode 必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.CompleteMfaSetup(ctx, userID, req.ChallengeID, req.Passcode)
	if err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OK(c, result)
}

// DisableMfa POST /api/v1/auth/mfa/disable
// 关闭全部 MFA
func (h *AuthHandler) DisableMfa(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.svc.DisableMfa(ctx, userID); err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "多因素认证已关闭")
}

// SetPreferredMfa POST /api/v1/auth/mfa/preferred
// 设置首选 MFA 因子
func (h *AuthHandler) SetPreferredMfa(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}

	var req struct {
		MfaType string `json:"mfaType" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "mfaType 必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.svc.SetPreferredMfa(ctx, userID, req.MfaType); err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "已设为首选验证方式")
}
