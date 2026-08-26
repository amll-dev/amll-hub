package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/sirupsen/logrus"

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

// 规范化手机号格式
func normalizePhone(phone string) string {
	phone = strings.TrimSpace(phone)
	if phone == "" {
		return phone
	}
	if strings.HasPrefix(phone, "+") {
		return phone
	}
	return "+86" + phone
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
		// Redis出错时fail-closed
		logrus.WithFields(logrus.Fields{"dest": dest, "error": err}).Error("redis check sendcode cooldown failed, fail-closed")
		return ErrSendCodeCooldown
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
		// Redis出错时fail-closed
		logrus.WithFields(logrus.Fields{"username": username, "error": err}).Error("redis check login lock failed, fail-closed")
		return true
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
		logrus.WithField("error", err).Warn("marshal casdoor cookies failed")
		return
	}
	key := "casdoor:cookies:" + dest
	if err := s.rdb.Set(ctx, key, data, cookieCacheTTL).Err(); err != nil {
		logrus.WithField("error", err).Warn("save casdoor cookies failed")
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
	IsReviewer  bool   `json:"isReviewer"`
	IsAdmin     bool   `json:"isAdmin"`
}

// Login 登录
func (s *AuthService) Login(ctx context.Context, username, password string) (*LoginResult, error) {
	if s.isLoginLocked(ctx, username) {
		return nil, ErrAccountLocked
	}

	user, _, err := s.casdoor.Login(ctx, username, password)
	if err != nil {
		logrus.WithFields(logrus.Fields{"username": username, "error": err}).Warn("casdoor login failed")
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
	if !strings.Contains(dest, "@") {
		dest = normalizePhone(dest)
	}
	if s.isLoginLocked(ctx, dest) {
		return nil, ErrAccountLocked
	}

	user, err := s.casdoor.LoginByCode(ctx, dest, code)
	if err != nil {
		logrus.WithFields(logrus.Fields{"dest": dest, "error": err}).Warn("casdoor login by code failed")
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
	EmailCode   string `json:"emailCode"`
	Phone       string `json:"phone"`
	Code        string `json:"code"`
	DisplayName string `json:"displayName"`
}

// Register 注册
func (s *AuthService) Register(ctx context.Context, req RegisterRequest) error {
	phone := normalizePhone(req.Phone)
	if err := s.casdoor.Signup(ctx, infrastructure.SignupRequest{
		Username:    req.Username,
		Password:    req.Password,
		Email:       req.Email,
		EmailCode:   req.EmailCode,
		Phone:       phone,
		PhoneCode:   req.Code,
		DisplayName: req.DisplayName,
	}); err != nil {
		logrus.WithFields(logrus.Fields{"username": req.Username, "error": err}).Warn("casdoor signup failed")
		errMsg := err.Error()
		lowerMsg := strings.ToLower(errMsg)
		switch {
		case strings.Contains(lowerMsg, "username") && strings.Contains(lowerMsg, "exist"):
			return ErrUserAlreadyExists
		case strings.Contains(lowerMsg, "phone") && strings.Contains(lowerMsg, "exist"):
			return ErrUserAlreadyExists
		case strings.Contains(lowerMsg, "email") && strings.Contains(lowerMsg, "exist"):
			return ErrUserAlreadyExists
		case strings.Contains(lowerMsg, "already") && strings.Contains(lowerMsg, "exist"):
			return ErrUserAlreadyExists
		case strings.Contains(lowerMsg, "verification") || strings.Contains(lowerMsg, "code"):
			return ErrInvalidCode
		case strings.Contains(lowerMsg, "phone") && (strings.Contains(lowerMsg, "invalid") || strings.Contains(lowerMsg, "format")):
			return ErrInvalidInput
		default:
			return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
		}
	}
	return nil
}

// GetCaptcha 获取验证码信息
func (s *AuthService) GetCaptcha(ctx context.Context) (json.RawMessage, error) {
	return s.casdoor.GetCaptcha(ctx)
}

// 检查账号是否存在
func (s *AuthService) CheckUserExists(ctx context.Context, checkType, dest, method string) error {
	if checkType == "phone" {
		dest = normalizePhone(dest)
	}
	var user *infrastructure.CasdoorUser
	var err error
	if checkType == "email" {
		user, err = s.casdoor.GetUserByEmail(ctx, dest)
	} else {
		user, err = s.casdoor.GetUserByPhone(ctx, dest)
	}
	if method == "login" {
		if err != nil {
			errMsg := err.Error()
			if strings.Contains(errMsg, "未注册") {
				return ErrUserNotFound
			}
			return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
		}
	} else { // signup
		if err == nil && user != nil {
			return ErrUserAlreadyExists
		}
	}
	_ = user
	return nil
}

// 发送验证码
func (s *AuthService) SendVerificationCode(ctx context.Context, checkType, dest, captchaType, captchaToken, method string) error {
	if checkType == "phone" {
		dest = normalizePhone(dest)
	}
	if err := s.checkSendCodeCooldown(ctx, dest); err != nil {
		return err
	}
	if captchaType == "" {
		data, err := s.casdoor.GetCaptcha(ctx)
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
	cookies, err := s.casdoor.SendVerificationCode(ctx, checkType, dest, captchaType, captchaToken, method)
	if err != nil {
		logrus.WithFields(logrus.Fields{"dest": dest, "error": err}).Warn("casdoor send verification code failed")
		return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	s.saveCasdoorCookies(ctx, dest, cookies)
	s.markSendCodeSent(ctx, dest)
	return nil
}

func (s *AuthService) ForgotPassword(ctx context.Context, dest, code, newPassword string) error {

	var user *infrastructure.CasdoorUser
	var err error
	if strings.Contains(dest, "@") {
		user, err = s.casdoor.GetUserByEmail(ctx, dest)
	} else {
		dest = normalizePhone(dest)
		user, err = s.casdoor.GetUserByPhone(ctx, dest)
	}
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "未注册") {
			logrus.WithField("dest", dest).Warn("forgot password: user not found")
			return ErrUserNotFound
		}
		logrus.WithFields(logrus.Fields{"dest": dest, "error": err}).Warn("casdoor get user failed")
		return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	cookies, err := s.loadCasdoorCookies(ctx, dest)
	if err != nil {
		// cookies 过期或不存在
		return ErrCodeExpired
	}
	updatedCookies, err := s.casdoor.VerifyCode(ctx, dest, user.Name, code, cookies)
	if err != nil {
		logrus.WithFields(logrus.Fields{"dest": dest, "error": err}).Warn("casdoor verify code failed")
		errMsg := err.Error()
		if strings.Contains(errMsg, "already been used") || strings.Contains(errMsg, "expired") || strings.Contains(errMsg, "已失效") {
			return ErrCodeExpired
		}
		return ErrInvalidCode
	}
	if err := s.casdoor.ResetPassword(ctx, user.Owner, user.Name, newPassword, code, updatedCookies); err != nil {
		logrus.WithFields(logrus.Fields{"dest": dest, "error": err}).Warn("casdoor reset password failed")
		return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	s.clearCasdoorCookies(ctx, dest)
	return nil
}

// GetProfile 获取用户资料
func (s *AuthService) GetProfile(ctx context.Context, userID string) (*UserProfile, error) {
	owner, name, err := splitUserID(userID)
	if err != nil {
		return nil, ErrInvalidInput
	}
	user, err := s.casdoor.GetUser(ctx, owner, name)
	if err != nil {
		logrus.WithFields(logrus.Fields{"user_id": userID, "error": err}).Warn("casdoor get user failed")
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	profile := toUserProfile(user)
	return &profile, nil
}

// UpdateProfileRequest 更新资料请求
type UpdateProfileRequest struct {
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
	Code        string `json:"code"` // 邮箱验证码
	Phone       string `json:"phone"`
	PhoneCode   string `json:"phoneCode"` // 手机验证码
	Avatar      string `json:"avatar"`
}

// UpdateProfile 更新用户资料
func (s *AuthService) UpdateProfile(ctx context.Context, userID string, req UpdateProfileRequest) (*UserProfile, error) {
	owner, name, err := splitUserID(userID)
	if err != nil {
		return nil, ErrInvalidInput
	}

	user, err := s.casdoor.GetUser(ctx, owner, name)
	if err != nil {
		logrus.WithFields(logrus.Fields{"user_id": userID, "error": err}).Warn("casdoor get user failed")
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	columns := []string{}
	if req.DisplayName != "" {
		user.DisplayName = req.DisplayName
		columns = append(columns, "displayName")
	}
	// 修改邮箱
	if req.Email != "" && req.Email != user.Email {
		if req.Code == "" {
			return nil, ErrInvalidInput
		}
		// 用 send-verification-code 时保存的 Casdoor session cookies 校验验证码
		cookies, err := s.loadCasdoorCookies(ctx, req.Email)
		if err != nil {
			return nil, ErrCodeExpired
		}
		if _, err := s.casdoor.VerifyCode(ctx, req.Email, name, req.Code, cookies); err != nil {
			logrus.WithFields(logrus.Fields{"email": req.Email, "error": err}).Warn("casdoor verify email code failed")
			errMsg := err.Error()
			if strings.Contains(errMsg, "already been used") || strings.Contains(errMsg, "expired") || strings.Contains(errMsg, "已失效") {
				return nil, ErrCodeExpired
			}
			return nil, ErrInvalidCode
		}
		s.clearCasdoorCookies(ctx, req.Email)
		user.Email = req.Email
		columns = append(columns, "email")
	}
	// 修改手机号
	if req.Phone != "" {
		phone := normalizePhone(req.Phone)
		if phone != user.Phone {
			if req.PhoneCode == "" {
				return nil, ErrInvalidInput
			}
			cookies, err := s.loadCasdoorCookies(ctx, phone)
			if err != nil {
				return nil, ErrCodeExpired
			}
			if _, err := s.casdoor.VerifyCode(ctx, phone, name, req.PhoneCode, cookies); err != nil {
				logrus.WithFields(logrus.Fields{"phone": phone, "error": err}).Warn("casdoor verify phone code failed")
				errMsg := err.Error()
				if strings.Contains(errMsg, "already been used") || strings.Contains(errMsg, "expired") || strings.Contains(errMsg, "已失效") {
					return nil, ErrCodeExpired
				}
				return nil, ErrInvalidCode
			}
			s.clearCasdoorCookies(ctx, phone)
			user.Phone = phone
			columns = append(columns, "phone")
		}
	}
	if req.Avatar != "" {
		user.Avatar = req.Avatar
		columns = append(columns, "avatar")
	}

	if len(columns) == 0 {
		profile := toUserProfile(user)
		return &profile, nil
	}

	if err := s.casdoor.UpdateUser(ctx, user, columns); err != nil {
		logrus.WithFields(logrus.Fields{"user_id": userID, "error": err}).Warn("casdoor update user failed")
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
	if err := s.casdoor.SetPassword(ctx, owner, name, oldPassword, newPassword); err != nil {
		logrus.WithFields(logrus.Fields{"user_id": userID, "error": err}).Warn("casdoor set password failed")
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

	avatarURL, err := s.casdoor.UploadAvatar(ctx, fileBytes, filename, name)
	if err != nil {
		logrus.WithFields(logrus.Fields{"user_id": userID, "error": err}).Warn("casdoor upload avatar failed")
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
