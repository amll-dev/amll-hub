package handler

import (
	"context"
	"errors"
	"net/http"

	"github.com/amll-dev/amll-hub/backend/internal/middleware"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// AuthGithubHandler GitHub OAuth 登录/绑定 handler
type AuthGithubHandler struct {
	svc           *service.GithubBindService
	reviewerCache *middleware.ReviewerCache
	adminCache    *middleware.AdminCache
}

// NewAuthGithubHandler 创建 AuthGithubHandler
func NewAuthGithubHandler(svc *service.GithubBindService, rc *middleware.ReviewerCache, ac *middleware.AdminCache) *AuthGithubHandler {
	return &AuthGithubHandler{svc: svc, reviewerCache: rc, adminCache: ac}
}

// Login GET /api/v1/auth/github/login
// 跳转 GitHub 授权页（匿名登录/注册）
func (h *AuthGithubHandler) Login(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	authorizeURL, err := h.svc.StartLogin(ctx)
	if err != nil {
		writeGithubErr(c, err)
		return
	}
	c.Redirect(http.StatusFound, authorizeURL)
}

// BindURL GET /api/v1/auth/github/bind-url
func (h *AuthGithubHandler) BindURL(c *gin.Context) {
	username := middleware.GetUserName(c)
	if username == "" {
		pkg.Unauthorized(c)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	authorizeURL, err := h.svc.StartBind(ctx, username)
	if err != nil {
		writeGithubErr(c, err)
		return
	}
	pkg.OK(c, gin.H{"url": authorizeURL})
}

// Callback GET /api/v1/auth/github/callback
// GitHub 回调：校验 state → 换 token → 签发 JWT 或进入绑定页
func (h *AuthGithubHandler) Callback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")
	if code == "" || state == "" {
		pkg.BadRequest(c, "缺少 code 或 state 参数")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	redirectURL, err := h.svc.HandleCallback(ctx, code, state)
	if err != nil {
		writeGithubErr(c, err)
		return
	}
	c.Redirect(http.StatusFound, redirectURL)
}

// BindInfo POST /api/v1/auth/github/bind/info
// 绑定页预填信息（票据走请求体，避免出现在 URL 与访问日志中）
func (h *AuthGithubHandler) BindInfo(c *gin.Context) {
	var req struct {
		Token string `json:"token"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Token == "" {
		pkg.BadRequest(c, "缺少绑定凭证")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	info, err := h.svc.GetBindInfo(ctx, req.Token)
	if err != nil {
		writeGithubErr(c, err)
		return
	}
	pkg.OK(c, info)
}

// BindLogin POST /api/v1/auth/github/bind/login
// 已有账号登录并绑定
func (h *AuthGithubHandler) BindLogin(c *gin.Context) {
	var req service.GithubBindLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "token、账号、密码必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.BindLogin(ctx, req)
	if err != nil {
		writeGithubErr(c, err)
		return
	}
	h.enrichReviewer(c, &result.User)
	pkg.OK(c, result)
}

// BindRegister POST /api/v1/auth/github/bind/register
// 注册新账号并绑定
func (h *AuthGithubHandler) BindRegister(c *gin.Context) {
	var req service.GithubBindRegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "参数错误")
		return
	}
	if req.Token == "" || req.Username == "" || req.Password == "" ||
		req.Email == "" || req.EmailCode == "" || req.DisplayName == "" {
		pkg.BadRequest(c, "token、用户名、昵称、密码、邮箱、邮箱验证码必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.BindRegister(ctx, req)
	if err != nil {
		writeGithubErr(c, err)
		return
	}
	h.enrichReviewer(c, &result.User)
	pkg.OK(c, result)
}

// Unbind DELETE /api/v1/user/github/binding
func (h *AuthGithubHandler) Unbind(c *gin.Context) {
	username := middleware.GetUserName(c)
	if username == "" {
		pkg.Unauthorized(c)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	if err := h.svc.Unbind(ctx, username); err != nil {
		writeGithubErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "已解绑 GitHub")
}

// enrichReviewer 复用 AuthHandler 的审核员/管理员标记逻辑
func (h *AuthGithubHandler) enrichReviewer(c *gin.Context, p *service.UserProfile) {
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

// writeGithubErr 统一处理 GitHub 登录/绑定错误
func writeGithubErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrGithubOAuthDisabled):
		pkg.Fail(c, http.StatusServiceUnavailable, http.StatusServiceUnavailable, "站点尚未配置 GitHub 登录，请联系管理员")
	case errors.Is(err, service.ErrOAuthStateInvalid):
		pkg.BadRequest(c, "登录已过期，请重新发起")
	case errors.Is(err, service.ErrBindTokenExpired):
		pkg.Fail(c, http.StatusGone, http.StatusGone, "授权已过期，请重新登录")
	case errors.Is(err, service.ErrAccountAlreadyBound):
		pkg.Fail(c, http.StatusConflict, http.StatusConflict, "该账号已绑定其他 GitHub，请先解绑")
	case errors.Is(err, service.ErrGithubAlreadyBound):
		pkg.Fail(c, http.StatusConflict, http.StatusConflict, "该 GitHub 账号已绑定其他站点账号")
	case errors.Is(err, service.ErrAccountLocked):
		pkg.Fail(c, http.StatusTooManyRequests, http.StatusTooManyRequests, "账户已锁定，请稍后再试")
	case errors.Is(err, service.ErrInvalidCredentials):
		pkg.Fail(c, http.StatusUnauthorized, http.StatusUnauthorized, "用户名或密码错误")
	case errors.Is(err, service.ErrInvalidCode):
		pkg.BadRequest(c, "验证码错误")
	case errors.Is(err, service.ErrCodeExpired):
		pkg.BadRequest(c, "验证码已失效，请重新获取")
	case errors.Is(err, service.ErrUserAlreadyExists):
		pkg.Fail(c, http.StatusConflict, http.StatusConflict, "用户名或邮箱已存在")
	case errors.Is(err, service.ErrInvalidInput):
		pkg.BadRequest(c, "请求参数非法")
	default:
		writeUpstreamErrOrInternal(c, err)
	}
}

// writeUpstreamErrOrInternal 上游错误给 502，其余给 500（并去掉错误前缀细节）
func writeUpstreamErrOrInternal(c *gin.Context, err error) {
	if errors.Is(err, service.ErrUpstreamUnavailable) {
		logrus.WithError(err).Warn("github oauth upstream unavailable")
		pkg.Fail(c, http.StatusBadGateway, http.StatusBadGateway, "GitHub 服务暂不可用，请稍后再试")
		return
	}
	logrus.WithError(err).Warn("github oauth unknown error")
	pkg.InternalError(c, "内部错误")
}
