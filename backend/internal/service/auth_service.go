package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
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
	// casdoorTokenTTL Casdoor access token 缓存时间
	casdoorTokenTTL = 24 * time.Minute * 60
)

// casdoorTokenKey 登录用户的 Casdoor access token 缓存键
func casdoorTokenKey(userID string) string {
	return "casdoor:token:" + userID
}

// casdoorSessionKey 验证码登录用户的 Casdoor session cookie 缓存键
func casdoorSessionKey(userID string) string {
	return "casdoor:session:" + userID
}

// imageExtByContentType http.DetectContentType 的结果 → 规范扩展名
//
// 只覆盖 Go 能嗅探出来的类型；tiff / avif 嗅探不到，单独在 sniffImageExt 里补魔数。
var imageExtByContentType = map[string]string{
	"image/jpeg":   ".jpg",
	"image/png":    ".png",
	"image/gif":    ".gif",
	"image/webp":   ".webp",
	"image/bmp":    ".bmp",
	"image/x-icon": ".ico",
}

// sniffImageExt 按**文件内容**判定图片格式，返回规范扩展名；识别不出返回空串。
func sniffImageExt(data []byte) string {
	if ct := http.DetectContentType(data); ct != "" {
		if ext, ok := imageExtByContentType[ct]; ok {
			return ext
		}
	}
	// Go 的嗅探器不认 ISO-BMFF（avif/heic）与 tiff，这里按魔数补齐
	if len(data) >= 12 {
		if bytes.Equal(data[4:8], []byte("ftyp")) {
			switch string(data[8:12]) {
			case "avif", "avis":
				return ".avif"
			}
		}
	}
	if len(data) >= 4 {
		// II*\0 / MM\0* 都是 tiff 的字节序标记
		if bytes.Equal(data[:4], []byte{'I', 'I', 0x2A, 0x00}) ||
			bytes.Equal(data[:4], []byte{'M', 'M', 0x00, 0x2A}) {
			return ".tiff"
		}
	}
	return ""
}

// isSVG 判断是否为 SVG：Go 的嗅探器把 XML 报成 text/xml，需要看内容里有没有 <svg
func isSVG(data []byte) bool {
	head := data
	if len(head) > 512 {
		head = head[:512]
	}
	return strings.Contains(strings.ToLower(string(head)), "<svg")
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
func NewAuthService(
	casdoor *infrastructure.CasdoorClient,
	rdb *redis.Client,
	jwtSecret string,
	jwtTTL time.Duration,
	org string,
) *AuthService {
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

// saveCasdoorToken 缓存用户的 Casdoor access token（密码登录走 OAuth 得到）。
func (s *AuthService) saveCasdoorToken(ctx context.Context, userID, token string) {
	if token == "" {
		return
	}
	if err := s.rdb.Set(ctx, casdoorTokenKey(userID), token, casdoorTokenTTL).Err(); err != nil {
		logrus.WithFields(logrus.Fields{"user_id": userID, "error": err}).Warn("save casdoor token failed")
	}
}

// saveCasdoorSession 缓存验证码登录用户的 Casdoor session cookie。
func (s *AuthService) saveCasdoorSession(ctx context.Context, userID string, cookies []*http.Cookie) {
	if len(cookies) == 0 {
		return
	}
	data, err := json.Marshal(cookies)
	if err != nil {
		return
	}
	if err := s.rdb.Set(ctx, casdoorSessionKey(userID), data, casdoorTokenTTL).Err(); err != nil {
		logrus.WithFields(logrus.Fields{"user_id": userID, "error": err}).Warn("save casdoor session failed")
	}
}

func (s *AuthService) loadCasdoorToken(ctx context.Context, userID string) string {
	token, err := s.rdb.Get(ctx, casdoorTokenKey(userID)).Result()
	if err != nil {
		return ""
	}
	return token
}

func (s *AuthService) loadCasdoorSession(ctx context.Context, userID string) []*http.Cookie {
	data, err := s.rdb.Get(ctx, casdoorSessionKey(userID)).Bytes()
	if err != nil {
		return nil
	}
	var cookies []*http.Cookie
	if err := json.Unmarshal(data, &cookies); err != nil {
		return nil
	}
	return cookies
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

	user, accessToken, err := s.casdoor.Login(ctx, username, password)
	if err != nil {
		logrus.WithFields(logrus.Fields{"username": username, "error": err}).Warn("casdoor login failed")
		locked := s.recordLoginFail(ctx, username)
		if locked {
			return nil, ErrAccountLocked
		}
		return nil, ErrInvalidCredentials
	}

	s.clearLoginFail(ctx, username)
	// 缓存 Casdoor access token：后续改邮箱/手机号要调以登录用户身份鉴权的接口
	s.saveCasdoorToken(ctx, s.org+"/"+user.Name, accessToken)

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
func (s *AuthService) resolveLoginDest(ctx context.Context, dest string) (string, error) {
	if strings.Contains(dest, "@") {
		return dest, nil
	}
	user, err := s.casdoor.GetUserByPhone(ctx, dest)
	if err != nil {
		return "", err
	}
	if user.Phone != "" {
		return user.Phone, nil
	}
	return toE164(dest), nil
}

func (s *AuthService) LoginByCode(ctx context.Context, dest, code string) (*LoginResult, error) {
	if !strings.Contains(dest, "@") {
		dest = toE164(dest)
	}
	if s.isLoginLocked(ctx, dest) {
		return nil, ErrAccountLocked
	}

	// 传给 Casdoor 的 username 必须与库里存的格式一致
	casdoorDest := dest
	if !strings.Contains(dest, "@") {
		if resolved, rErr := s.resolveLoginDest(ctx, dest); rErr == nil {
			casdoorDest = resolved
		}
	}

	user, cookies, err := s.casdoor.LoginByCode(ctx, casdoorDest, code)
	if err != nil {
		logrus.WithFields(logrus.Fields{"dest": dest, "error": err}).Warn("casdoor login by code failed")
		locked := s.recordLoginFail(ctx, dest)
		if locked {
			return nil, ErrAccountLocked
		}
		return nil, ErrInvalidCredentials
	}

	s.clearLoginFail(ctx, dest)
	// 缓存 Casdoor session（该登录方式没有 OAuth token，只有会话 cookie）
	s.saveCasdoorSession(ctx, s.org+"/"+user.Name, cookies)

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
	phone := toE164(req.Phone)
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
	var user *infrastructure.CasdoorUser
	var err error
	if checkType == "email" {
		user, err = s.casdoor.GetUserByEmail(ctx, dest)
	} else {
		// GetUserByPhone 内部会自动尝试裸号 / E.164 两种格式，这里不要预加前缀
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

// defaultCountryCode 默认国家区号
const defaultCountryCode = "+86"

// toE164 把手机号补成 E.164 格式（+86xxxxxxxxxxx）。
// 已是 E.164 的原样返回；含非数字字符（说明根本不是手机号）也原样返回，交给上游报错。
func toE164(phone string) string {
	phone = strings.TrimSpace(phone)
	if phone == "" {
		return phone
	}
	if strings.HasPrefix(phone, "+") {
		return phone
	}
	for _, r := range phone {
		if r < '0' || r > '9' {
			return phone
		}
	}
	return defaultCountryCode + phone
}

// 发送验证码。
// dest 若是手机号，会被补成 E.164 格式（Casdoor 只认这种）。
func (s *AuthService) SendVerificationCode(ctx context.Context, checkType, dest, captchaType, captchaToken, method string) error {
	return s.sendCodeRaw(ctx, checkType, dest, captchaType, captchaToken, method)
}

// sendCodeRaw 按给定 dest 发码。
func (s *AuthService) sendCodeRaw(ctx context.Context, checkType, dest, captchaType, captchaToken, method string) error {
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
	originalDest := dest
	if checkType == "phone" {
		if user, uErr := s.casdoor.GetUserByPhone(ctx, dest); uErr == nil && user.Phone != "" {
			dest = user.Phone
		} else {
			dest = toE164(dest)
		}
	}
	cookies, err := s.casdoor.SendVerificationCode(ctx, checkType, dest, captchaType, captchaToken, method)
	if err != nil {
		logrus.WithFields(logrus.Fields{
			"dest": dest, "input_dest": originalDest,
			"check_type": checkType, "method": method, "error": err,
		}).Warn("casdoor send verification code failed")
		mapped := mapSendCodeErr(err)
		// method=login 时 Casdoor 会用 dest 反查用户；查不到就报 "user does not exist"。
		// 先自己按 dest 查一次：能查到说明账号确实存在，是格式不一致导致上游反查失败。
		if errors.Is(mapped, ErrUserNotFound) && method != "signup" && s.destExists(ctx, checkType, originalDest) {
			logrus.WithFields(logrus.Fields{"dest": dest, "input_dest": originalDest, "check_type": checkType}).Warn("dest exists in casdoor but send-verification-code could not resolve it")
			return ErrDestLookupFailed
		}
		return mapped
	}
	s.saveCasdoorCookies(ctx, dest, cookies)
	s.markSendCodeSent(ctx, dest)
	return nil
}

// destExists 确认目标地址在 Casdoor 里确实对应某个用户
func (s *AuthService) destExists(ctx context.Context, checkType, dest string) bool {
	var err error
	if checkType == "phone" {
		_, err = s.casdoor.GetUserByPhone(ctx, dest)
	} else {
		_, err = s.casdoor.GetUserByEmail(ctx, dest)
	}
	return err == nil
}

// mapSendCodeErr 把 Casdoor 的发码失败原因翻译成用户能看懂 / 能处理的提示。
// Casdoor 侧常见失败：未配置短信 provider、用户不存在、人机验证失败、区号缺失。
func mapSendCodeErr(err error) error {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "please add a SMS provider"),
		strings.Contains(msg, "SMS provider"):
		return fmt.Errorf("%w: Casdoor 应用尚未配置短信服务，手机验证码暂不可用，请改用邮箱验证", ErrProviderNotConfigured)
	case strings.Contains(msg, "please add an Email provider"),
		strings.Contains(msg, "Email provider"):
		return fmt.Errorf("%w: Casdoor 应用尚未配置邮件服务，邮箱验证码暂不可用", ErrProviderNotConfigured)
	case strings.Contains(msg, "the user does not exist"),
		strings.Contains(msg, "doesn't exist"):
		return ErrUserNotFound
	case strings.Contains(msg, "Turing test failed"),
		strings.Contains(msg, "captcha"):
		return ErrCaptchaFailed
	case strings.Contains(msg, "Phone number is invalid"),
		strings.Contains(msg, "invalid in your region"):
		return ErrInvalidPhone
	}
	return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
}

func (s *AuthService) ForgotPassword(ctx context.Context, dest, code, newPassword string) error {

	var user *infrastructure.CasdoorUser
	var err error
	// 与发码时的 checkType 保持一致（ResetPassword 页按是否含 @ 判定）
	checkType := "phone"
	if strings.Contains(dest, "@") {
		checkType = "email"
		user, err = s.casdoor.GetUserByEmail(ctx, dest)
	} else {
		dest = toE164(dest)
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
	updatedCookies, err := s.casdoor.VerifyCode(ctx, checkType, dest, user.Name, code, cookies)
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

	// 改邮箱 / 手机号前必须先通过身份验证（凭证 10 分钟有效，用完即失效）
	changingEmail := req.Email != "" && req.Email != user.Email
	changingPhone := req.Phone != "" && toE164(req.Phone) != toE164(user.Phone)
	if changingEmail || changingPhone {
		if _, err := s.RequireIdentity(ctx, userID); err != nil {
			return nil, err
		}
	}

	// 邮箱 / 手机号走 Casdoor 官方 reset-email-or-phone
	accessToken := s.loadCasdoorToken(ctx, userID)
	sessionCookies := s.loadCasdoorSession(ctx, userID)
	if changingEmail || changingPhone {
		if accessToken == "" && len(sessionCookies) == 0 {
			logrus.WithField("user_id", userID).Warn("missing casdoor credential, user needs to re-login")
			return nil, ErrCasdoorCredentialMissing
		}
	}

	// 修改邮箱
	if changingEmail {
		if req.Code == "" {
			return nil, ErrInvalidInput
		}
		if err := s.casdoor.ResetEmailOrPhone(ctx, "email", req.Email, req.Code, accessToken, sessionCookies); err != nil {
			logrus.WithFields(logrus.Fields{"email": req.Email, "error": err}).Warn("casdoor reset email failed")
			return nil, mapResetContactErr(err)
		}
		s.clearCasdoorCookies(ctx, req.Email)
		user.Email = req.Email
		columns = append(columns, "email")
	}
	// 修改手机号
	if changingPhone {
		phone := toE164(req.Phone)
		if req.PhoneCode == "" {
			return nil, ErrInvalidInput
		}
		if err := s.casdoor.ResetEmailOrPhone(ctx, "phone", phone, req.PhoneCode, accessToken, sessionCookies); err != nil {
			logrus.WithFields(logrus.Fields{"phone": phone, "error": err}).Warn("casdoor reset phone failed")
			return nil, mapResetContactErr(err)
		}
		s.clearCasdoorCookies(ctx, phone)
		user.Phone = phone
		columns = append(columns, "phone")
	}
	if req.Avatar != "" {
		user.Avatar = req.Avatar
		columns = append(columns, "avatar")
	}

	// 邮箱/手机号已由 reset-email-orPhone 直接落库，只需把其余字段（昵称/头像）同步过去
	if len(columns) > 0 {
		syncColumns := make([]string, 0, len(columns))
		for _, c := range columns {
			if c != "email" && c != "phone" {
				syncColumns = append(syncColumns, c)
			}
		}
		if len(syncColumns) > 0 {
			if err := s.casdoor.UpdateUser(ctx, user, syncColumns); err != nil {
				logrus.WithFields(logrus.Fields{"user_id": userID, "error": err}).Warn("casdoor update user failed")
				return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
			}
		}
	}

	// 联系方式已更新，身份验证凭证立即失效
	if changingEmail || changingPhone {
		s.clearIdentity(ctx, userID)
	}

	// 重新拉取，确保返回的是 Casdoor 里的最新资料
	if changingEmail || changingPhone {
		if fresh, err := s.casdoor.GetUser(ctx, owner, name); err == nil {
			profile := toUserProfile(fresh)
			return &profile, nil
		}
	}
	profile := toUserProfile(user)
	return &profile, nil
}

// mapResetContactErr 把 Casdoor 的错误映射成对用户友好的类型
func mapResetContactErr(err error) error {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "already exists"):
		return ErrUserAlreadyExists
	case strings.Contains(msg, "already been used"), strings.Contains(msg, "expired"), strings.Contains(msg, "已失效"):
		return ErrCodeExpired
	case strings.Contains(msg, "Invalid Email"), strings.Contains(msg, "Phone number is invalid"), strings.Contains(msg, "is invalid"):
		return ErrInvalidInput
	}
	return ErrInvalidCode
}

// ChangePassword 修改密码。
func (s *AuthService) ChangePassword(ctx context.Context, userID, oldPassword, newPassword string) error {
	owner, name, err := splitUserID(userID)
	if err != nil {
		return ErrInvalidInput
	}
	if newPassword == "" {
		return ErrInvalidInput
	}

	if oldPassword != "" {
		// 兼容直传旧密码的调用（前端当前不使用）
		if err := s.casdoor.SetPassword(ctx, owner, name, oldPassword, newPassword); err != nil {
			logrus.WithFields(logrus.Fields{"user_id": userID, "error": err}).Warn("casdoor set password failed")
			return ErrInvalidCredentials
		}
		s.clearIdentity(ctx, userID)
		return nil
	}

	cred, err := s.RequireIdentity(ctx, userID)
	if err != nil {
		return err
	}
	if cred.Code == "" {
		return ErrIdentityNotVerified
	}
	if err := s.casdoor.ResetPassword(ctx, owner, name, newPassword, cred.Code, cred.Cookies); err != nil {
		logrus.WithFields(logrus.Fields{"user_id": userID, "method": cred.Method, "error": err}).Warn("casdoor reset password failed")
		s.clearIdentity(ctx, userID)
		return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	s.clearIdentity(ctx, userID)
	return nil
}

// UploadAvatar 上传头像。
func (s *AuthService) UploadAvatar(ctx context.Context, userID string, fileBytes []byte, filename string) (string, error) {
	_, name, err := splitUserID(userID)
	if err != nil {
		return "", ErrInvalidInput
	}

	// 校验文件大小（上限 50MB）
	if int64(len(fileBytes)) > maxAvatarSize {
		return "", ErrInvalidInput
	}

	// 按内容魔数判定格式。
	ext := sniffImageExt(fileBytes)
	if ext == "" && isSVG(fileBytes) {
		ext = ".svg"
	}
	if ext == "" {
		logrus.WithFields(logrus.Fields{
			"user_id":      userID,
			"filename":     filename,
			"content_type": http.DetectContentType(fileBytes),
			"size":         len(fileBytes),
		}).Warn("avatar upload rejected: unrecognized image format")
		return "", ErrInvalidInput
	}

	// 同一用户固定对象名：换头像是覆盖，不会堆积垃圾对象
	storedName := name + ext
	avatarURL, err := s.casdoor.UploadAvatar(ctx, fileBytes, storedName, name)
	if err != nil {
		logrus.WithFields(logrus.Fields{"user_id": userID, "error": err}).Warn("casdoor upload avatar failed")
		return "", mapUploadAvatarErr(err)
	}

	// 写入用户 avatar 字段
	avatarURL = withAvatarVersion(avatarURL)
	if _, err = s.UpdateProfile(ctx, userID, UpdateProfileRequest{Avatar: avatarURL}); err != nil {
		return "", err
	}

	return avatarURL, nil
}

// mapUploadAvatarErr 把 Casdoor 的上传失败翻译成可操作的提示。
func mapUploadAvatarErr(err error) error {
	msg := err.Error()
	if strings.Contains(msg, "Unauthorized operation") {
		logrus.Warn("casdoor rejected avatar upload: the application is not treated as a privileged subject " +
			"(move the Casdoor app to the built-in organization or enable its admin permission)")
		return fmt.Errorf("%w: Casdoor 拒绝了应用身份的头像上传（Unauthorized operation），"+
			"请在 Casdoor 后台把该应用移到 built-in 组织，或在应用编辑页开启管理员权限",
			ErrCasdoorPermissionDenied)
	}
	return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
}

// withAvatarVersion 给头像 URL 追加版本参数。
func withAvatarVersion(avatarURL string) string {
	if avatarURL == "" {
		return avatarURL
	}
	sep := "?"
	if strings.Contains(avatarURL, "?") {
		sep = "&"
	}
	return fmt.Sprintf("%s%sv=%d", avatarURL, sep, time.Now().UnixMilli())
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
