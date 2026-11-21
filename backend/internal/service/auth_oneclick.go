package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"

	"github.com/amll-dev/amll-hub/backend/internal/infrastructure"
)

// OneClickService 网页「本机号码一键登录」
type OneClickService struct {
	auth    *AuthService
	pnvs    *infrastructure.AliyunPnvsClient
	casdoor *infrastructure.CasdoorClient
	rdb     *redis.Client
	org     string
}

// NewOneClickService 创建一键登录服务；pnvs 为 nil 表示功能未配置
func NewOneClickService(
	auth *AuthService,
	pnvs *infrastructure.AliyunPnvsClient,
	casdoor *infrastructure.CasdoorClient,
	rdb *redis.Client,
	org string,
) *OneClickService {
	return &OneClickService{auth: auth, pnvs: pnvs, casdoor: casdoor, rdb: rdb, org: org}
}

// Enabled 是否已配置一键登录
func (s *OneClickService) Enabled() bool {
	return s != nil && s.pnvs != nil
}

// Allow 固定窗口限流：同一 key 在 window 内最多 limit 次
func (s *OneClickService) Allow(ctx context.Context, key string, limit int64, window time.Duration) bool {
	if s == nil || s.rdb == nil {
		return true
	}
	n, err := s.rdb.Incr(ctx, key).Result()
	if err != nil {
		// Redis 异常时不阻断登录入口，仅记录日志
		logrus.WithError(err).Warn("one-click rate limit check failed")
		return true
	}
	if n == 1 {
		_ = s.rdb.Expire(ctx, key, window).Err()
	}
	return n <= limit
}

// AuthToken 获取 H5 取号 SDK 所需的临时凭据
func (s *OneClickService) AuthToken(ctx context.Context) (*infrastructure.OneClickAuthToken, error) {
	if !s.Enabled() {
		return nil, ErrOneClickDisabled
	}
	return s.pnvs.GetAuthToken(ctx)
}

// Login 用 H5 SDK 返回的 spToken 完成登录
func (s *OneClickService) Login(ctx context.Context, spToken string, meta infrastructure.LoginMeta) (*LoginResult, error) {
	if !s.Enabled() {
		return nil, ErrOneClickDisabled
	}
	if strings.TrimSpace(spToken) == "" {
		return nil, ErrOneClickInvalidToken
	}

	accessToken, err := s.casdoor.ExchangeMobileOneClickH5(ctx, spToken)
	if err != nil {
		return nil, classifyOneClickErr(err)
	}

	return s.finishCasdoorLogin(ctx, accessToken, meta)
}

// LoginNative 用 Android/iOS 原生 SDK 返回的运营商 token 完成登录。
// 原生 SDK 自己完成取号，Hub 只负责把 token 转给 Casdoor 的 native grant。
func (s *OneClickService) LoginNative(ctx context.Context, token string, meta infrastructure.LoginMeta) (*LoginResult, error) {
	if s == nil || s.casdoor == nil {
		return nil, ErrOneClickDisabled
	}
	if strings.TrimSpace(token) == "" {
		return nil, ErrOneClickInvalidToken
	}

	accessToken, err := s.casdoor.ExchangeMobileOneClickNative(ctx, token)
	if err != nil {
		return nil, classifyOneClickErr(err)
	}

	return s.finishCasdoorLogin(ctx, accessToken, meta)
}

// finishCasdoorLogin Casdoor 换 token 成功后的公共收尾：查用户、缓存凭证、签本地 JWT
func (s *OneClickService) finishCasdoorLogin(ctx context.Context, accessToken string, meta infrastructure.LoginMeta) (*LoginResult, error) {
	user, err := s.casdoor.GetUserInfo(ctx, accessToken)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	fullID := s.org + "/" + user.Name
	// 一键登录走的是 OAuth token 端点，Casdoor 只返回 access token，不会下发
	// 会话 Cookie。这里把 access token 缓存下来，供改邮箱/手机号等需要用户身份的接口使用。
	s.auth.saveCasdoorToken(ctx, fullID, accessToken)

	return s.auth.completeLogin(ctx, fullID, nil, meta)
}

// classifyOneClickErr 把 Casdoor token 端点的错误映射成前端可区分的业务错误
func classifyOneClickErr(err error) error {
	var oauthErr *infrastructure.CasdoorOAuthError
	if !errors.As(err, &oauthErr) {
		return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	desc := strings.ToLower(oauthErr.Code + " " + oauthErr.Description)
	switch {
	case strings.Contains(desc, "mfa") || strings.Contains(desc, "multi-factor"):
		return ErrOneClickMfaRequired
	case strings.Contains(desc, "does not exist"),
		strings.Contains(desc, "not allow"),
		strings.Contains(desc, "sign up"),
		strings.Contains(desc, "signup"):
		return ErrOneClickUserNotFound
	default:
		return ErrOneClickInvalidToken
	}
}
