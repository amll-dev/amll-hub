package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/infrastructure"
	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
)

// GitHub OAuth state / 绑定令牌 的 Redis 前缀与有效期
const (
	githubOAuthStatePrefix = "oauth:state:"
	githubBindPrefix       = "bind:"
	githubOAuthStateTTL    = 10 * time.Minute
	githubBindTokenTTL     = 15 * time.Minute
)

// githubBindPayload 暂存在 Redis 中的 GitHub 绑定待选信息
type githubBindPayload struct {
	GithubID     int64  `json:"github_id"`
	GithubLogin  string `json:"github_login"`
	GithubEmail  string `json:"github_email"`
	GithubAvatar string `json:"github_avatar"`
}

// GithubBindInfo 绑定页展示用的预填信息
type GithubBindInfo struct {
	GithubLogin  string `json:"githubLogin"`
	GithubEmail  string `json:"githubEmail"`
	GithubAvatar string `json:"githubAvatar"`
}

// GithubBindLoginRequest 已有账号登录并绑定
type GithubBindLoginRequest struct {
	Token    string `json:"token" binding:"required"`
	Account  string `json:"account" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// GithubBindRegisterRequest 注册新账号并绑定
type GithubBindRegisterRequest struct {
	RegisterRequest
	Token string `json:"token" binding:"required"`
}

// GithubBindService GitHub 登录/绑定业务逻辑
type GithubBindService struct {
	oauth     *infrastructure.GithubOAuthClient
	auth      *AuthService
	repo      *repository.GithubBindingRepo
	rdb       *redis.Client
	jwtSecret string
	jwtTTL    time.Duration
	org       string
	siteURL   string
}

// NewGithubBindService 创建 GithubBindService
func NewGithubBindService(
	oauth *infrastructure.GithubOAuthClient,
	auth *AuthService,
	repo *repository.GithubBindingRepo,
	rdb *redis.Client,
	jwtSecret string,
	jwtTTL time.Duration,
	org string,
	siteURL string,
) *GithubBindService {
	return &GithubBindService{
		oauth:     oauth,
		auth:      auth,
		repo:      repo,
		rdb:       rdb,
		jwtSecret: jwtSecret,
		jwtTTL:    jwtTTL,
		org:       org,
		siteURL:   siteURL,
	}
}

// randomToken 生成随机十六进制串
func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		// rand.Read 在现代 Go 上几乎不会失败；退化为时间戳保证调用方逻辑继续
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// StartLogin 生成 state 并返回 GitHub 授权地址（匿名登录/注册场景）
func (s *GithubBindService) StartLogin(ctx context.Context) (string, error) {
	return s.startAuth(ctx, "")
}

// StartBind 已登录用户主动绑定：state 中记录站点用户名，回调时直接写绑定
func (s *GithubBindService) StartBind(ctx context.Context, username string) (string, error) {
	return s.startAuth(ctx, username)
}

func (s *GithubBindService) startAuth(ctx context.Context, username string) (string, error) {
	if !s.oauth.Enabled() {
		return "", ErrGithubOAuthDisabled
	}
	state := randomToken(16)
	// value 为空表示匿名登录；非空表示「已登录用户绑定」场景携带的站点用户名
	if err := s.rdb.Set(ctx, githubOAuthStatePrefix+state, username, githubOAuthStateTTL).Err(); err != nil {
		return "", fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	return s.oauth.AuthorizeURL(state), nil
}

// HandleCallback 处理 GitHub 回调，返回应跳转的前端地址
func (s *GithubBindService) HandleCallback(ctx context.Context, code, state string) (string, error) {
	if !s.oauth.Enabled() {
		return "", ErrGithubOAuthDisabled
	}
	// 一次性校验 state
	key := githubOAuthStatePrefix + state
	username, err := s.rdb.GetDel(ctx, key).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return "", ErrOAuthStateInvalid
		}
		// Redis 异常时 fail-closed，避免绕过 state 校验
		return "", fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	accessToken, err := s.oauth.ExchangeCode(ctx, code)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	ghUser, err := s.oauth.GetUser(ctx, accessToken)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	email := ghUser.Email
	if email == "" {
		email = s.oauth.GetPrimaryEmail(ctx, accessToken)
	}

	// 已登录用户绑定分支：直接把 GitHub 写入该站点账号
	if username != "" {
		if err := s.writeBinding(ctx, username, ghUser, email); err != nil {
			return "", err
		}
		return fmt.Sprintf("%s/profile/migration?githubBound=1", s.siteURL), nil
	}

	// 匿名登录分支：GitHub 已绑定则直接签发 JWT 登录
	if b, err := s.repo.GetByGithubID(ctx, ghUser.ID); err != nil {
		return "", fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	} else if b != nil {
		token, err := s.issueJWT(ctx, b.Username)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("%s/auth/github/callback#token=%s", s.siteURL, token), nil
	}

	// 未绑定：暂存待绑定信息，进入绑定页
	bindToken := randomToken(16)
	payload := githubBindPayload{
		GithubID:     ghUser.ID,
		GithubLogin:  ghUser.Login,
		GithubEmail:  email,
		GithubAvatar: ghUser.AvatarURL,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal bind payload: %w", err)
	}
	if err := s.rdb.Set(ctx, githubBindPrefix+bindToken, data, githubBindTokenTTL).Err(); err != nil {
		return "", fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	// 绑定票据同样放在 fragment 回传，避免落入访问日志
	return fmt.Sprintf("%s/bind-account#token=%s", s.siteURL, bindToken), nil
}

// GetBindInfo 读取绑定令牌对应的 GitHub 信息
func (s *GithubBindService) GetBindInfo(ctx context.Context, token string) (*GithubBindInfo, error) {
	payload, err := s.loadBindPayload(ctx, token)
	if err != nil {
		return nil, err
	}
	return &GithubBindInfo{
		GithubLogin:  payload.GithubLogin,
		GithubEmail:  payload.GithubEmail,
		GithubAvatar: payload.GithubAvatar,
	}, nil
}

// BindLogin 用已有站点账号登录并绑定
func (s *GithubBindService) BindLogin(ctx context.Context, req GithubBindLoginRequest) (*LoginResult, error) {
	payload, err := s.loadBindPayload(ctx, req.Token)
	if err != nil {
		return nil, err
	}

	result, err := s.auth.Login(ctx, req.Account, req.Password)
	if err != nil {
		return nil, err
	}
	username := result.User.Name

	binding := &model.UserGithubBinding{
		Username:     username,
		GithubID:     payload.GithubID,
		GithubLogin:  payload.GithubLogin,
		GithubEmail:  payload.GithubEmail,
		GithubAvatar: payload.GithubAvatar,
	}
	if err := s.createBinding(ctx, binding); err != nil {
		return nil, err
	}
	s.rdb.Del(ctx, githubBindPrefix+req.Token)
	return result, nil
}

// BindRegister 注册新站点账号并绑定
func (s *GithubBindService) BindRegister(ctx context.Context, req GithubBindRegisterRequest) (*LoginResult, error) {
	payload, err := s.loadBindPayload(ctx, req.Token)
	if err != nil {
		return nil, err
	}
	if err := s.auth.Register(ctx, req.RegisterRequest); err != nil {
		return nil, err
	}
	result, err := s.auth.Login(ctx, req.Username, req.Password)
	if err != nil {
		return nil, err
	}

	binding := &model.UserGithubBinding{
		Username:     result.User.Name,
		GithubID:     payload.GithubID,
		GithubLogin:  payload.GithubLogin,
		GithubEmail:  payload.GithubEmail,
		GithubAvatar: payload.GithubAvatar,
	}
	if err := s.createBinding(ctx, binding); err != nil {
		return nil, err
	}

	// 新注册账号尚无头像，直接用 GitHub 头像作为站点头像（失败不阻塞注册/绑定）；
	// 若用户随后在注册页另选了图片，前端会再上传一次覆盖这里的结果
	if payload.GithubAvatar != "" {
		userID := s.org + "/" + result.User.Name
		if _, err := s.auth.UpdateProfile(ctx, userID, UpdateProfileRequest{Avatar: payload.GithubAvatar}); err != nil {
			logrus.WithError(err).WithField("username", result.User.Name).
				Warn("绑定注册：同步 GitHub 头像失败（不影响注册与绑定）")
		} else {
			result.User.Avatar = payload.GithubAvatar
		}
	}

	s.rdb.Del(ctx, githubBindPrefix+req.Token)
	return result, nil
}

// GetBinding 查询某站点用户的绑定（未绑定返回 nil, nil）
func (s *GithubBindService) GetBinding(ctx context.Context, username string) (*model.UserGithubBinding, error) {
	return s.repo.GetByUsername(ctx, username)
}

// Unbind 解绑当前用户的 GitHub
func (s *GithubBindService) Unbind(ctx context.Context, username string) error {
	if err := s.repo.DeleteByUsername(ctx, username); err != nil {
		return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	return nil
}

// loadBindPayload 读取并解析 Redis 中的待绑定信息
func (s *GithubBindService) loadBindPayload(ctx context.Context, token string) (*githubBindPayload, error) {
	data, err := s.rdb.Get(ctx, githubBindPrefix+token).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, ErrBindTokenExpired
		}
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	var payload githubBindPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, ErrBindTokenExpired
	}
	return &payload, nil
}

// writeBinding 已登录用户绑定分支：直接写入绑定（含冲突校验）
func (s *GithubBindService) writeBinding(ctx context.Context, username string, gh *infrastructure.GithubUser, email string) error {
	return s.createBinding(ctx, &model.UserGithubBinding{
		Username:     username,
		GithubID:     gh.ID,
		GithubLogin:  gh.Login,
		GithubEmail:  email,
		GithubAvatar: gh.AvatarURL,
	})
}

// createBinding 写入绑定，前置双向唯一校验
func (s *GithubBindService) createBinding(ctx context.Context, b *model.UserGithubBinding) error {
	if existing, err := s.repo.GetByUsername(ctx, b.Username); err != nil {
		return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	} else if existing != nil {
		if existing.GithubID == b.GithubID {
			// 幂等：同一 GitHub 重复绑定视为成功
			return nil
		}
		return ErrAccountAlreadyBound
	}
	if existing, err := s.repo.GetByGithubID(ctx, b.GithubID); err != nil {
		return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	} else if existing != nil {
		return ErrGithubAlreadyBound
	}
	if err := s.repo.Create(ctx, b); err != nil {
		// 并发下唯一索引兜底
		return ErrAccountAlreadyBound
	}
	return nil
}

// issueJWT 为已绑定用户签发站点 JWT
func (s *GithubBindService) issueJWT(ctx context.Context, username string) (string, error) {
	claims := &pkg.Claims{
		Sub:  s.org + "/" + username,
		Name: username,
	}
	// 尽量取 Casdoor 资料补全展示字段；失败则退化为 GitHub 绑定信息
	if profile, err := s.auth.GetProfile(ctx, s.org+"/"+username); err == nil {
		claims.DisplayName = profile.DisplayName
		claims.Email = profile.Email
		claims.Avatar = profile.Avatar
	} else if b, err := s.repo.GetByUsername(ctx, username); err == nil && b != nil {
		logrus.WithField("username", username).Debug("fallback to github binding info for claims")
		claims.DisplayName = b.GithubLogin
		claims.Email = b.GithubEmail
		claims.Avatar = b.GithubAvatar
	}
	token, err := pkg.SignJWT(claims, s.jwtSecret, s.jwtTTL)
	if err != nil {
		return "", fmt.Errorf("签发 token 失败: %w", err)
	}
	return token, nil
}
