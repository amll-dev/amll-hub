package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/infrastructure"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/redis/go-redis/v9"
)

const (
	sendCodeCooldown = 60 * time.Second
	loginLockTTL     = 15 * time.Minute
	maxLoginFails    = 10
	loginFailTTL     = 15 * time.Minute
	maxAvatarSize    = 50 * 1024 * 1024 // 50MB
	cookieCacheTTL   = 10 * time.Minute // Casdoor session cookie 缓存时间
)

// allowedAvatarExts 允许的头像文件扩展名
var allowedAvatarExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".webp": true,
	".gif": true, ".bmp": true, ".svg": true, ".ico": true,
	".tiff": true, ".tif": true, ".avif": true,
}

// AuthService 认证业务逻辑
type AuthService struct {
	casdoor   *infrastructure.CasdoorClient
	rdb       *redis.Client
	jwtSecret string
	jwtTTL    time.Duration
	org       string
}

// NewAuthService 创建 AuthService
func NewAuthService(casdoor *infrastructure.CasdoorClient, rdb *redis.Client, jwtSecret string, jwtTTL time.Duration, org string) *AuthService {
	return &AuthService{
		casdoor:   casdoor,
		rdb:       rdb,
		jwtSecret: jwtSecret,
		jwtTTL:    jwtTTL,
		org:       org,
	}
}

// JWTSecret 返回 JWT 密钥（供 router 挂载中间件用）
func (s *AuthService) JWTSecret() string {
	return s.jwtSecret
}

// ---- 限流/锁定辅助 ----

func (s *AuthService) checkSendCodeCooldown(ctx context.Context, dest string) error {
	key := "casdoor:sendcode:" + dest
	n, err := s.rdb.Exists(ctx, key).Result()
	if err != nil {
		return nil // Redis 出错不阻塞业务
	}
	if n > 0 {
		return ErrSendCodeCooldown
	}
	return nil
}

func (s *AuthService) markSendCodeSent(ctx context.Context, dest string) {
	key := "casdoor:sendcode:" + dest
	_ = s.rdb.Set(ctx, key, 1, sendCodeCooldown).Err()
}

func (s *AuthService) isLoginLocked(ctx context.Context, username string) bool {
	key := "casdoor:loginlock:" + username
	n, err := s.rdb.Exists(ctx, key).Result()
	if err != nil {
		return false
	}
	return n > 0
}

func (s *AuthService) recordLoginFail(ctx context.Context, username string) bool {
	key := "casdoor:loginfail:" + username
	count, err := s.rdb.Incr(ctx, key).Result()
	if err != nil {
		return false
	}
	if count == 1 {
		_ = s.rdb.Expire(ctx, key, loginFailTTL).Err()
	}
	if count >= maxLoginFails {
		lockKey := "casdoor:loginlock:" + username
		_ = s.rdb.Set(ctx, lockKey, 1, loginLockTTL).Err()
		_ = s.rdb.Del(ctx, key).Err()
		return true
	}
	return false
}

func (s *AuthService) clearLoginFail(ctx context.Context, username string) {
	_ = s.rdb.Del(ctx, "casdoor:loginfail:"+username).Err()
}

func (s *AuthService) saveCasdoorCookies(ctx context.Context, dest string, cookies []*http.Cookie) {
	if len(cookies) == 0 {
		return
	}
	data, err := json.Marshal(cookies)
	if err != nil {
		slog.Warn("marshal casdoor cookies failed", "error", err)
		return
	}
	key := "casdoor:cookies:" + dest
	if err := s.rdb.Set(ctx, key, data, cookieCacheTTL).Err(); err != nil {
		slog.Warn("save casdoor cookies failed", "error", err)
	}
}

func (s *AuthService) loadCasdoorCookies(ctx context.Context, dest string) ([]*http.Cookie, error) {
	key := "casdoor:cookies:" + dest
	data, err := s.rdb.Get(ctx, key).Bytes()
	if err != nil {
		return nil, fmt.Errorf("验证码已失效，请重新发送验证码")
	}
	var cookies []*http.Cookie
	if err := json.Unmarshal(data, &cookies); err != nil {
		return nil, fmt.Errorf("验证码状态异常，请重新发送验证码")
	}
	return cookies, nil
}

func (s *AuthService) clearCasdoorCookies(ctx context.Context, dest string) {
	_ = s.rdb.Del(ctx, "casdoor:cookies:"+dest).Err()
}

// LoginResult 登录返回
type LoginResult struct {
	Token string      `json:"token"`
	User  UserProfile `json:"user"`
}

// UserProfile 用户资料
type UserProfile struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
	Avatar      string `json:"avatar"`
	Phone       string `json:"phone,omitempty"`
}

// Login 登录
func (s *AuthService) Login(ctx context.Context, username, password string) (*LoginResult, error) {
	if s.isLoginLocked(ctx, username) {
		return nil, ErrAccountLocked
	}

	user, _, err := s.casdoor.Login(username, password)
	if err != nil {
		slog.Warn("casdoor login failed", "username", username, "error", err)
		locked := s.recordLoginFail(ctx, username)
		if locked {
			return nil, ErrAccountLocked
		}
		return nil, ErrInvalidCredentials
	}

	s.clearLoginFail(ctx, username)

	claims := &pkg.Claims{
		Sub:         s.org + "/" + user.Name,
		Name:        user.Name,
		DisplayName: user.DisplayName,
		Email:       user.Email,
		Avatar:      user.Avatar,
	}
	token, err := pkg.SignJWT(claims, s.jwtSecret, s.jwtTTL)
	if err != nil {
		return nil, fmt.Errorf("签发 token 失败: %w", err)
	}

	return &LoginResult{
		Token: token,
		User:  toUserProfile(user),
	}, nil
}

// LoginByCode 验证码登录
func (s *AuthService) LoginByCode(ctx context.Context, dest, code string) (*LoginResult, error) {
	if s.isLoginLocked(ctx, dest) {
		return nil, ErrAccountLocked
	}

	user, err := s.casdoor.LoginByCode(dest, code)
	if err != nil {
		slog.Warn("casdoor login by code failed", "dest", dest, "error", err)
		locked := s.recordLoginFail(ctx, dest)
		if locked {
			return nil, ErrAccountLocked
		}
		return nil, ErrInvalidCredentials
	}

	s.clearLoginFail(ctx, dest)

	claims := &pkg.Claims{
		Sub:         s.org + "/" + user.Name,
		Name:        user.Name,
		DisplayName: user.DisplayName,
		Email:       user.Email,
		Avatar:      user.Avatar,
	}
	token, err := pkg.SignJWT(claims, s.jwtSecret, s.jwtTTL)
	if err != nil {
		return nil, fmt.Errorf("签发 token 失败: %w", err)
	}

	return &LoginResult{
		Token: token,
		User:  toUserProfile(user),
	}, nil
}

// RegisterRequest 注册请求
type RegisterRequest struct {
	Username    string `json:"username"`
	Password    string `json:"password"`
	Email       string `json:"email"`
	Code        string `json:"code"`
	DisplayName string `json:"displayName"`
}

// Register 注册
func (s *AuthService) Register(ctx context.Context, req RegisterRequest) error {
	if err := s.casdoor.Signup(infrastructure.SignupRequest{
		Username:    req.Username,
		Password:    req.Password,
		Email:       req.Email,
		EmailCode:   req.Code,
		DisplayName: req.DisplayName,
	}); err != nil {
		slog.Warn("casdoor signup failed", "username", req.Username, "error", err)
		return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	return nil
}

// GetCaptcha 获取验证码信息
func (s *AuthService) GetCaptcha() (json.RawMessage, error) {
	return s.casdoor.GetCaptcha()
}

// SendVerificationCode 发送验证码
func (s *AuthService) SendVerificationCode(ctx context.Context, checkType, dest, captchaType, captchaToken string) error {
	if err := s.checkSendCodeCooldown(ctx, dest); err != nil {
		return err
	}
	if captchaType == "" {
		data, err := s.casdoor.GetCaptcha()
		if err == nil {
			var c struct {
				Type  string `json:"type"`
				Token string `json:"captchaToken"`
			}
			_ = json.Unmarshal(data, &c)
			if c.Type != "" {
				captchaType = c.Type
				if captchaToken == "" {
					captchaToken = c.Token
				}
			}
		}
	}
	cookies, err := s.casdoor.SendVerificationCode(checkType, dest, captchaType, captchaToken)
	if err != nil {
		slog.Warn("casdoor send verification code failed", "dest", dest, "error", err)
		return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	s.saveCasdoorCookies(ctx, dest, cookies)
	s.markSendCodeSent(ctx, dest)
	return nil
}

func (s *AuthService) ForgotPassword(ctx context.Context, email, code, newPassword string) error {
	user, err := s.casdoor.GetUserByEmail(email)
	if err != nil {
		slog.Warn("casdoor get user by email failed", "email", email, "error", err)
		return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	cookies, err := s.loadCasdoorCookies(ctx, email)
	if err != nil {
		return ErrInvalidInput
	}
	if err := s.casdoor.VerifyCode(email, code, cookies); err != nil {
		slog.Warn("casdoor verify code failed", "email", email, "error", err)
		return ErrInvalidCredentials
	}
	if err := s.casdoor.ResetPassword(user.Owner, user.Name, newPassword, code, cookies); err != nil {
		slog.Warn("casdoor reset password failed", "email", email, "error", err)
		return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	s.clearCasdoorCookies(ctx, email)
	return nil
}

// GetProfile 获取用户资料
func (s *AuthService) GetProfile(ctx context.Context, userID string) (*UserProfile, error) {
	owner, name, err := splitUserID(userID)
	if err != nil {
		return nil, ErrInvalidInput
	}
	user, err := s.casdoor.GetUser(owner, name)
	if err != nil {
		slog.Warn("casdoor get user failed", "user_id", userID, "error", err)
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	profile := toUserProfile(user)
	return &profile, nil
}

// UpdateProfileRequest 更新资料请求
type UpdateProfileRequest struct {
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
	Code        string `json:"code"`
	Avatar      string `json:"avatar"`
}

// UpdateProfile 更新用户资料
func (s *AuthService) UpdateProfile(ctx context.Context, userID string, req UpdateProfileRequest) (*UserProfile, error) {
	owner, name, err := splitUserID(userID)
	if err != nil {
		return nil, ErrInvalidInput
	}

	user, err := s.casdoor.GetUser(owner, name)
	if err != nil {
		slog.Warn("casdoor get user failed", "user_id", userID, "error", err)
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	columns := []string{}
	if req.DisplayName != "" {
		user.DisplayName = req.DisplayName
		columns = append(columns, "displayName")
	}
	if req.Email != "" {
		if req.Code == "" {
			return nil, ErrInvalidInput
		}
		user.Email = req.Email
		columns = append(columns, "email")
	}
	if req.Avatar != "" {
		user.Avatar = req.Avatar
		columns = append(columns, "avatar")
	}

	if len(columns) == 0 {
		profile := toUserProfile(user)
		return &profile, nil
	}

	if err := s.casdoor.UpdateUser(user, columns); err != nil {
		slog.Warn("casdoor update user failed", "user_id", userID, "error", err)
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	profile := toUserProfile(user)
	return &profile, nil
}

// ChangePassword 修改密码（需旧密码）
func (s *AuthService) ChangePassword(ctx context.Context, userID, oldPassword, newPassword string) error {
	owner, name, err := splitUserID(userID)
	if err != nil {
		return ErrInvalidInput
	}
	if err := s.casdoor.SetPassword(owner, name, oldPassword, newPassword); err != nil {
		slog.Warn("casdoor set password failed", "user_id", userID, "error", err)
		return ErrInvalidCredentials
	}
	return nil
}

// UploadAvatar 上传头像
func (s *AuthService) UploadAvatar(ctx context.Context, userID string, fileBytes []byte, filename string) (string, error) {
	owner, name, err := splitUserID(userID)
	if err != nil {
		return "", ErrInvalidInput
	}

	// 校验文件大小（上限 50MB）
	if int64(len(fileBytes)) > maxAvatarSize {
		return "", ErrInvalidInput
	}

	// 校验扩展名
	ext := strings.ToLower(filepath.Ext(filename))
	if !allowedAvatarExts[ext] {
		return "", ErrInvalidInput
	}

	// 嗅探内容类型确认是图片
	contentType := http.DetectContentType(fileBytes)
	if !strings.HasPrefix(contentType, "image/") && contentType != "text/xml; charset=utf-8" {
		// svg 的 contentType 可能是 text/xml
		if ext != ".svg" {
			return "", ErrInvalidInput
		}
	}

	avatarURL, err := s.casdoor.UploadAvatar(fileBytes, filename, name)
	if err != nil {
		slog.Warn("casdoor upload avatar failed", "user_id", userID, "error", err)
		return "", fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	// 写入用户 avatar 字段
	_, err = s.UpdateProfile(ctx, owner+"/"+name, UpdateProfileRequest{Avatar: avatarURL})
	if err != nil {
		return "", err
	}

	return avatarURL, nil
}

// ---- 辅助函数 ----

func splitUserID(userID string) (owner, name string, err error) {
	parts := strings.SplitN(userID, "/", 2)
	if len(parts) != 2 {
		return "", "", errors.New("invalid user id")
	}
	return parts[0], parts[1], nil
}

func toUserProfile(user *infrastructure.CasdoorUser) UserProfile {
	return UserProfile{
		Name:        user.Name,
		DisplayName: user.DisplayName,
		Email:       user.Email,
		Avatar:      user.Avatar,
		Phone:       user.Phone,
	}
}
