package service

import (
	"context"
	"errors"
	"fmt"
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
		return errors.New("请 60s 后再试")
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

// ---- 业务方法 ----

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
		return nil, errors.New("账户已锁定，请 15 分钟后再试")
	}

	user, _, err := s.casdoor.Login(username, password)
	if err != nil {
		locked := s.recordLoginFail(ctx, username)
		if locked {
			return nil, errors.New("登录失败次数过多，账户已锁定 15 分钟")
		}
		return nil, fmt.Errorf("用户名或密码错误")
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
	return s.casdoor.Signup(infrastructure.SignupRequest{
		Username:    req.Username,
		Password:    req.Password,
		Email:       req.Email,
		EmailCode:   req.Code,
		DisplayName: req.DisplayName,
	})
}

// SendVerificationCode 发送验证码
func (s *AuthService) SendVerificationCode(ctx context.Context, checkType, dest string) error {
	if err := s.checkSendCodeCooldown(ctx, dest); err != nil {
		return err
	}
	if err := s.casdoor.SendVerificationCode(checkType, dest); err != nil {
		return err
	}
	s.markSendCodeSent(ctx, dest)
	return nil
}

// ForgotPassword 忘记密码（用验证码重置）
func (s *AuthService) ForgotPassword(ctx context.Context, email, code, newPassword string) error {
	user, err := s.casdoor.GetUserByEmail(email)
	if err != nil {
		return err
	}
	return s.casdoor.ResetPassword(user.Owner, user.Name, newPassword, email, code)
}

// GetProfile 获取用户资料
func (s *AuthService) GetProfile(ctx context.Context, userID string) (*UserProfile, error) {
	owner, name, err := splitUserID(userID)
	if err != nil {
		return nil, err
	}
	user, err := s.casdoor.GetUser(owner, name)
	if err != nil {
		return nil, err
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
		return nil, err
	}

	user, err := s.casdoor.GetUser(owner, name)
	if err != nil {
		return nil, err
	}

	columns := []string{}
	if req.DisplayName != "" {
		user.DisplayName = req.DisplayName
		columns = append(columns, "displayName")
	}
	if req.Email != "" {
		if req.Code == "" {
			return nil, errors.New("修改邮箱需提供验证码")
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
		return nil, err
	}

	profile := toUserProfile(user)
	return &profile, nil
}

// ChangePassword 修改密码（需旧密码）
func (s *AuthService) ChangePassword(ctx context.Context, userID, oldPassword, newPassword string) error {
	owner, name, err := splitUserID(userID)
	if err != nil {
		return err
	}
	return s.casdoor.SetPassword(owner, name, oldPassword, newPassword)
}

// UploadAvatar 上传头像
func (s *AuthService) UploadAvatar(ctx context.Context, userID string, fileBytes []byte, filename string) (string, error) {
	owner, name, err := splitUserID(userID)
	if err != nil {
		return "", err
	}

	// 校验文件大小（上限 50MB）
	if int64(len(fileBytes)) > maxAvatarSize {
		return "", errors.New("头像文件大小不能超过 50MB")
	}

	// 校验扩展名
	ext := strings.ToLower(filepath.Ext(filename))
	if !allowedAvatarExts[ext] {
		return "", errors.New("不支持的头像格式")
	}

	// 嗅探内容类型确认是图片
	contentType := http.DetectContentType(fileBytes)
	if !strings.HasPrefix(contentType, "image/") && contentType != "text/xml; charset=utf-8" {
		// svg 的 contentType 可能是 text/xml
		if ext != ".svg" {
			return "", errors.New("文件不是图片")
		}
	}

	avatarURL, err := s.casdoor.UploadAvatar(fileBytes, filename, name)
	if err != nil {
		return "", err
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
