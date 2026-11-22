package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/infrastructure"
	"github.com/amll-dev/amll-hub/backend/internal/middleware"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// AuthHandler 认证 handler
type AuthHandler struct {
	svc           *service.AuthService
	oneClick      *service.OneClickService
	reviewerCache *middleware.ReviewerCache
	adminCache    *middleware.AdminCache
}

// NewAuthHandler 创建 AuthHandler
func NewAuthHandler(svc *service.AuthService, oneClick *service.OneClickService, rc *middleware.ReviewerCache, ac *middleware.AdminCache) *AuthHandler {
	return &AuthHandler{svc: svc, oneClick: oneClick, reviewerCache: rc, adminCache: ac}
}

// loginMeta 提取本次登录的客户端信息，供 Casdoor 与站内风险判定使用
func loginMeta(c *gin.Context) infrastructure.LoginMeta {
	return infrastructure.LoginMeta{
		DeviceID:  c.GetHeader("X-Device-ID"),
		ClientIP:  c.ClientIP(),
		UserAgent: c.GetHeader("User-Agent"),
	}
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

	result, err := h.svc.Login(ctx, req.Username, req.Password, loginMeta(c))
	if err != nil {
		writeAuthErr(c, err)
		return
	}
	h.enrichReviewer(c, result.User)
	pkg.OK(c, result)
}

// LoginMfa POST /api/v1/auth/login/mfa
// 完成密码登录后的二次验证
func (h *AuthHandler) LoginMfa(c *gin.Context) {
	var req struct {
		ChallengeID  string `json:"challengeId" binding:"required"`
		MfaType      string `json:"mfaType" binding:"required"`
		Passcode     string `json:"passcode"`
		RecoveryCode string `json:"recoveryCode"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "challengeId 和 mfaType 必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.VerifyMfaLogin(ctx, req.ChallengeID, req.MfaType, req.Passcode, req.RecoveryCode, loginMeta(c))
	if err != nil {
		writeAuthErr(c, err)
		return
	}
	h.enrichReviewer(c, result.User)
	pkg.OK(c, result)
}

// SendLoginMfaCode POST /api/v1/auth/login/mfa/send-code
// 给 MFA 会话发送邮箱/短信验证码
func (h *AuthHandler) SendLoginMfaCode(c *gin.Context) {
	var req struct {
		ChallengeID  string `json:"challengeId" binding:"required"`
		MfaType      string `json:"mfaType" binding:"required"`
		CaptchaType  string `json:"captchaType"`
		CaptchaToken string `json:"captchaToken"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "challengeId 和 mfaType 必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.svc.SendMfaCode(ctx, req.ChallengeID, req.MfaType, req.CaptchaType, req.CaptchaToken); err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "验证码已发送")
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

	result, err := h.svc.LoginByCode(ctx, req.Dest, req.Code, loginMeta(c))
	if err != nil {
		writeAuthErr(c, err)
		return
	}
	h.enrichReviewer(c, result.User)
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

// GetIdentityStatus GET /api/v1/auth/identity
// 查询可用的身份验证方式与当前验证状态
func (h *AuthHandler) GetIdentityStatus(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	status, err := h.svc.GetIdentityStatus(ctx, userID)
	if err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OK(c, status)
}

// SendIdentityCode POST /api/v1/auth/identity/code
// 向账号自身已绑定的手机 / 邮箱发送身份验证验证码（目标地址由后端决定）
func (h *AuthHandler) SendIdentityCode(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}

	var req struct {
		Method       string `json:"method" binding:"required"`
		CaptchaType  string `json:"captchaType"`
		CaptchaToken string `json:"captchaToken"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "验证方式必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.svc.SendIdentityCode(ctx, userID, req.Method, req.CaptchaType, req.CaptchaToken); err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "验证码已发送")
}

// VerifyIdentity POST /api/v1/auth/identity/verify
// 身份验证，通过后返回凭证有效期（秒）
func (h *AuthHandler) VerifyIdentity(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}

	var req service.VerifyIdentityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "参数错误")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	ttl, err := h.svc.VerifyIdentity(ctx, userID, req)
	if err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OK(c, gin.H{"verified": true, "expiresIn": ttl})
}

// ChangePassword POST /api/v1/auth/change-password
func (h *AuthHandler) ChangePassword(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}

	// oldPassword 可为空：此时要求已通过手机 / 邮箱身份验证
	var req struct {
		OldPassword string `json:"oldPassword"`
		NewPassword string `json:"newPassword" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "新密码必填")
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
// OneClickEnabled 一键登录是否可用（未配置 PNVS 时前端隐藏入口）
func (h *AuthHandler) OneClickEnabled(c *gin.Context) {
	pkg.OK(c, gin.H{"enabled": h.oneClick.Enabled()})
}

// OneClickAuthToken 获取 H5 取号 SDK 临时凭据
func (h *AuthHandler) OneClickAuthToken(c *gin.Context) {
	if !h.oneClick.Allow(c.Request.Context(), "auth:oneclick:token:"+c.ClientIP(), 10, time.Minute) {
		writeAuthErr(c, service.ErrOneClickRateLimited)
		return
	}
	token, err := h.oneClick.AuthToken(c.Request.Context())
	if err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OK(c, token)
}

// OneClickLogin 用 H5 SDK 返回的 spToken 登录
func (h *AuthHandler) OneClickLogin(c *gin.Context) {
	if !h.oneClick.Allow(c.Request.Context(), "auth:oneclick:login:"+c.ClientIP(), 10, time.Minute) {
		writeAuthErr(c, service.ErrOneClickRateLimited)
		return
	}

	var req struct {
		SpToken string `json:"spToken"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "请求参数有误")
		return
	}

	result, err := h.oneClick.Login(c.Request.Context(), req.SpToken, loginMeta(c))
	if err != nil {
		writeAuthErr(c, err)
		return
	}
	if result.User != nil {
		h.enrichReviewer(c, result.User)
	}
	pkg.OK(c, result)
}

// OneClickNativeLogin 用 Android/iOS 原生 SDK 的运营商 token 登录
func (h *AuthHandler) OneClickNativeLogin(c *gin.Context) {
	if !h.oneClick.Allow(c.Request.Context(), "auth:oneclick:native:"+c.ClientIP(), 10, time.Minute) {
		writeAuthErr(c, service.ErrOneClickRateLimited)
		return
	}

	var req struct {
		Token string `json:"token"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "请求参数有误")
		return
	}

	result, err := h.oneClick.LoginNative(c.Request.Context(), req.Token, loginMeta(c))
	if err != nil {
		writeAuthErr(c, err)
		return
	}
	if result.User != nil {
		h.enrichReviewer(c, result.User)
	}
	pkg.OK(c, result)
}

// RevokeSessions 递增会话版本，踢掉该账号已签发的所有 JWT
func (h *AuthHandler) RevokeSessions(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}
	if err := h.svc.RevokeSessions(c.Request.Context(), userID); err != nil {
		logrus.WithError(err).Warn("revoke sessions failed")
		pkg.InternalError(c, "操作失败，请稍后重试")
		return
	}
	pkg.OKWithMsg(c, nil, "已退出所有设备")
}

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

	// 限制头像大小为 5MB（与 service.maxAvatarSize 保持一致）
	const maxAvatarUpload = 5 * 1024 * 1024
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
	case errors.Is(err, service.ErrMfaChallengeExpired):
		pkg.Fail(c, http.StatusGone, http.StatusGone, "二次验证已过期，请重新登录")
	case errors.Is(err, service.ErrMfaTooManyAttempts):
		pkg.Fail(c, http.StatusTooManyRequests, http.StatusTooManyRequests, "验证失败次数过多，请重新登录")
	case errors.Is(err, service.ErrMfaMethodUnavailable):
		pkg.BadRequest(c, "该验证方式不可用")
	case errors.Is(err, service.ErrMfaMethodEnabled):
		pkg.Fail(c, http.StatusConflict, http.StatusConflict, "该验证方式已启用，如需更换请先关闭后重新绑定")
	case errors.Is(err, service.ErrMfaSetupDisabled):
		pkg.Fail(c, http.StatusServiceUnavailable, http.StatusServiceUnavailable, "二次认证功能维护中，暂不可开启")
	case errors.Is(err, service.ErrMfaSetupRequired):
		pkg.Fail(c, http.StatusForbidden, http.StatusForbidden, "请先完成多因素认证设置")
	case errors.Is(err, service.ErrMfaOperationFailed):
		// Casdoor 的原始 msg 可能带组织名、应用名和内部端点，只记日志不外传
		logrus.WithError(err).Warn("mfa operation failed")
		pkg.Fail(c, http.StatusBadGateway, http.StatusBadGateway, "操作失败，请稍后重试")
	case errors.Is(err, service.ErrPasswordUpdateRequired):
		pkg.Fail(c, http.StatusForbidden, http.StatusForbidden, "密码已过期，请先重置密码")
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
	case errors.Is(err, service.ErrWeakPassword):
		pkg.BadRequest(c, "密码需为 8~128 位，且至少包含字母和数字")
	case errors.Is(err, service.ErrAvatarTooLarge):
		pkg.BadRequest(c, "头像不能超过 5MB")
	case errors.Is(err, service.ErrAvatarFormatUnsupported):
		pkg.BadRequest(c, "头像格式不支持，仅接受 JPEG / PNG / WebP / AVIF")
	case errors.Is(err, service.ErrIdentityNotVerified):
		pkg.Fail(c, http.StatusForbidden, http.StatusForbidden, "请先完成身份验证")
	case errors.Is(err, service.ErrIdentityLocked):
		pkg.Fail(c, http.StatusTooManyRequests, http.StatusTooManyRequests, "验证失败次数过多，请稍后再试")
	case errors.Is(err, service.ErrIdentityMethodUnavailable):
		pkg.BadRequest(c, "该验证方式不可用：账号资料里的手机号/邮箱未正确填写，请在 Casdoor 中补全后再试")
	case errors.Is(err, service.ErrCasdoorPermissionDenied):
		detail := err.Error()
		if idx := strings.Index(detail, ": "); idx >= 0 {
			detail = detail[idx+2:]
		}
		pkg.Fail(c, http.StatusBadGateway, http.StatusBadGateway, detail)
	case errors.Is(err, service.ErrCasdoorCredentialMissing):
		pkg.Fail(c, http.StatusUnauthorized, http.StatusUnauthorized, "登录状态已过期，请重新登录后再试")
	case errors.Is(err, service.ErrCaptchaFailed):
		// 带稳定业务码：前端靠它决定「保留验证码弹窗重试」还是「关闭弹窗」
		pkg.Fail(c, http.StatusBadRequest, pkg.CodeCaptchaFailed, "人机验证未通过，请重试")
	case errors.Is(err, service.ErrDestLookupFailed):
		pkg.Fail(c, http.StatusBadGateway, http.StatusBadGateway, "认证服务无法定位该账号的联系方式，请联系管理员检查认证服务配置")
	case errors.Is(err, service.ErrInvalidPhone):
		pkg.BadRequest(c, "手机号格式有误，请检查后重试")
	case errors.Is(err, service.ErrQRTicketExpired):
		pkg.Fail(c, http.StatusGone, http.StatusGone, "二维码已过期，请在网页端重新生成")
	case errors.Is(err, service.ErrQRTicketAlreadyScanned):
		pkg.Fail(c, http.StatusConflict, http.StatusConflict, "该二维码已被其他账号扫码")
	case errors.Is(err, service.ErrProviderNotConfigured):
		detail := err.Error()
		if idx := strings.Index(detail, ": "); idx >= 0 {
			detail = detail[idx+2:]
		}
		pkg.Fail(c, http.StatusBadGateway, http.StatusBadGateway, detail)
	case errors.Is(err, service.ErrUpstreamUnavailable):
		writeUpstreamErr(c, err, "认证服务暂不可用")
	case errors.Is(err, service.ErrOneClickDisabled):
		pkg.Fail(c, http.StatusServiceUnavailable, pkg.CodeOneClickDisabled, "一键登录暂未开放")
	case errors.Is(err, service.ErrOneClickInvalidToken):
		pkg.Fail(c, http.StatusBadRequest, pkg.CodeOneClickInvalidToken, "本机号码校验已过期，请重新尝试或改用其他登录方式")
	case errors.Is(err, service.ErrOneClickUserNotFound):
		pkg.Fail(c, http.StatusUnauthorized, pkg.CodeOneClickUserNotFound, "该手机号尚未注册，请先注册后再登录")
	case errors.Is(err, service.ErrOneClickMfaRequired):
		pkg.Fail(c, http.StatusUnauthorized, pkg.CodeOneClickMfaRequired, "该账号已开启两步验证，请使用密码或验证码登录")
	case errors.Is(err, service.ErrOneClickRateLimited):
		pkg.Fail(c, http.StatusTooManyRequests, pkg.CodeOneClickRateLimited, "操作过于频繁，请稍后再试")
	default:
		logrus.WithError(err).Warn("auth service unknown error")
		pkg.InternalError(c, "内部错误")
	}
}
