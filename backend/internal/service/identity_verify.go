package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/sirupsen/logrus"

	"github.com/amll-dev/amll-hub/backend/internal/infrastructure"
)

// 身份验证

const (
	// identityVerifyTTL 身份验证凭证有效期
	identityVerifyTTL = 10 * time.Minute
	// maxIdentityFails 身份验证失败次数上限，超出后临时锁定
	maxIdentityFails = 10
	// identityFailTTL 失败计数 / 锁定时长
	identityFailTTL = 15 * time.Minute
)

// 身份验证方式
const (
	IdentityMethodPhone = "phone"
	IdentityMethodEmail = "email"
)

// identityVerifyTTLSeconds 凭证有效期（秒）
const identityVerifyTTLSeconds = int(identityVerifyTTL / time.Second)

// identityCredential Redis 中保存的验证凭证
type identityCredential struct {
	Method   string         `json:"method"`
	Dest     string         `json:"dest"`
	Code     string         `json:"code"`
	Cookies  []*http.Cookie `json:"cookies"`
	ExpireAt int64          `json:"expireAt"`
}

// IdentityStatus 身份验证状态
type IdentityStatus struct {
	/** 当前账号可用的验证方式 */
	Methods []string `json:"methods"`
	/** 是否已通过验证 */
	Verified bool `json:"verified"`
	/** 已通过的验证方式（未验证时为空） */
	VerifiedMethod string `json:"verifiedMethod,omitempty"`
	/** 凭证剩余有效秒数（未验证时为 0） */
	Remaining int `json:"remaining"`
}

func identityKey(userID string) string {
	return "casdoor:idverify:" + userID
}

func identityFailKey(userID string) string {
	return "casdoor:idverifyfail:" + userID
}

// isUsablePhone 判断 Casdoor 的 phone 字段是否真的可用于短信验证。
func isUsablePhone(phone string) bool {
	phone = strings.TrimSpace(phone)
	if phone == "" {
		return false
	}
	if strings.ContainsAny(phone, "@ \t\r\n") {
		return false
	}
	// 去掉 E.164 前缀的 + 后必须全是数字
	digits := strings.TrimPrefix(phone, "+")
	if digits == "" {
		return false
	}
	for _, r := range digits {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// resolveIdentityDest 取出账号自身已绑定的目标地址。
func resolveIdentityDest(user *infrastructure.CasdoorUser, method string) string {
	if method == IdentityMethodPhone {
		return strings.TrimSpace(user.Phone)
	}
	return strings.TrimSpace(user.Email)
}

// SendIdentityCode 向账号自身已绑定的手机 / 邮箱发送身份验证验证码。
func (s *AuthService) SendIdentityCode(ctx context.Context, userID, method, captchaType, captchaToken string) error {
	if method != IdentityMethodPhone && method != IdentityMethodEmail {
		return ErrIdentityMethodUnavailable
	}
	owner, name, err := splitUserID(userID)
	if err != nil {
		return ErrInvalidInput
	}
	user, err := s.casdoor.GetUser(ctx, owner, name)
	if err != nil {
		logrus.WithFields(logrus.Fields{"user_id": userID, "error": err}).Warn("casdoor get user failed")
		return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	dest := resolveIdentityDest(user, method)
	if method == IdentityMethodPhone && !isUsablePhone(dest) {
		logrus.WithFields(logrus.Fields{"user_id": userID, "phone": dest}).Warn("refuse to send code to invalid phone field")
		return ErrIdentityMethodUnavailable
	}
	if dest == "" {
		return ErrIdentityMethodUnavailable
	}
	// method 传 login：目标是已注册账号的登录验证
	return s.sendCodeRaw(ctx, method, dest, captchaType, captchaToken, "login")
}

// GetIdentityStatus 查询当前账号可用的验证方式与验证状态
func (s *AuthService) GetIdentityStatus(ctx context.Context, userID string) (*IdentityStatus, error) {
	owner, name, err := splitUserID(userID)
	if err != nil {
		return nil, ErrInvalidInput
	}
	user, err := s.casdoor.GetUser(ctx, owner, name)
	if err != nil {
		logrus.WithFields(logrus.Fields{"user_id": userID, "error": err}).Warn("casdoor get user failed")
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	// 只列真正可用的验证方式
	available := make([]string, 0, 2)
	if isUsablePhone(user.Phone) {
		available = append(available, IdentityMethodPhone)
	} else if strings.TrimSpace(user.Phone) != "" {
		logrus.WithFields(logrus.Fields{
			"user_id": userID,
			"phone":   user.Phone,
		}).Warn("casdoor phone field is not a valid phone number, phone verification disabled")
	}
	if strings.TrimSpace(user.Email) != "" {
		available = append(available, IdentityMethodEmail)
	}

	status := &IdentityStatus{Methods: available}
	cred, err := s.loadIdentityCredential(ctx, userID)
	if err != nil {
		return status, nil // 未验证 / 凭证异常，都按未验证处理
	}
	status.VerifiedMethod = cred.Method
	if left := time.Until(time.Unix(cred.ExpireAt, 0)); left > 0 {
		status.Verified = true
		status.Remaining = int(left.Seconds())
	}
	return status, nil
}

func (s *AuthService) loadIdentityCredential(ctx context.Context, userID string) (*identityCredential, error) {
	data, err := s.rdb.Get(ctx, identityKey(userID)).Bytes()
	if err != nil {
		return nil, ErrIdentityNotVerified
	}
	var cred identityCredential
	if err := json.Unmarshal(data, &cred); err != nil {
		return nil, ErrIdentityNotVerified
	}
	if cred.ExpireAt <= time.Now().Unix() {
		_ = s.rdb.Del(ctx, identityKey(userID)).Err()
		return nil, ErrIdentityNotVerified
	}
	return &cred, nil
}

// RequireIdentity 校验身份验证凭证，未通过则返回 ErrIdentityNotVerified
func (s *AuthService) RequireIdentity(ctx context.Context, userID string) (*identityCredential, error) {
	return s.loadIdentityCredential(ctx, userID)
}

// clearIdentity 清除身份验证凭证（联系方式改完即失效，密码改完由调用方清除）
func (s *AuthService) clearIdentity(ctx context.Context, userID string) {
	_ = s.rdb.Del(ctx, identityKey(userID)).Err()
	_ = s.rdb.Del(ctx, identityFailKey(userID)).Err()
}

// isIdentityLocked 失败次数过多时临时锁定验证入口
func (s *AuthService) isIdentityLocked(ctx context.Context, userID string) bool {
	n, err := s.rdb.Exists(ctx, identityFailKey(userID)).Result()
	if err != nil {
		logrus.WithFields(logrus.Fields{"user_id": userID, "error": err}).Error("redis check identity lock failed, fail-closed")
		return true
	}
	return n >= maxIdentityFails
}

func (s *AuthService) recordIdentityFail(ctx context.Context, userID string) {
	key := identityFailKey(userID)
	count, err := s.rdb.Incr(ctx, key).Result()
	if err != nil {
		return
	}
	if count == 1 {
		_ = s.rdb.Expire(ctx, key, identityFailTTL).Err()
	}
}

func (s *AuthService) clearIdentityFail(ctx context.Context, userID string) {
	_ = s.rdb.Del(ctx, identityFailKey(userID)).Err()
}

// VerifyIdentityRequest 身份验证请求
type VerifyIdentityRequest struct {
	// Method 验证方式：phone / email
	Method string `json:"method"`
	// Code 手机 / 邮箱验证码
	Code string `json:"code"`
}

// VerifyIdentity 校验身份，通过后签发 10 分钟有效的凭证（返回有效期秒数）。
func (s *AuthService) VerifyIdentity(ctx context.Context, userID string, req VerifyIdentityRequest) (int, error) {
	if s.isIdentityLocked(ctx, userID) {
		return 0, ErrIdentityLocked
	}
	owner, name, err := splitUserID(userID)
	if err != nil {
		return 0, ErrInvalidInput
	}
	if req.Method != IdentityMethodPhone && req.Method != IdentityMethodEmail {
		return 0, ErrIdentityMethodUnavailable
	}
	if req.Code == "" {
		return 0, ErrInvalidInput
	}

	user, err := s.casdoor.GetUser(ctx, owner, name)
	if err != nil {
		logrus.WithFields(logrus.Fields{"user_id": userID, "error": err}).Warn("casdoor get user failed")
		return 0, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	dest := resolveIdentityDest(user, req.Method)
	if req.Method == IdentityMethodPhone && !isUsablePhone(dest) {
		return 0, ErrIdentityMethodUnavailable
	}
	if dest == "" {
		return 0, ErrIdentityMethodUnavailable
	}

	cookies, err := s.loadCasdoorCookies(ctx, dest)
	if err != nil {
		s.recordIdentityFail(ctx, userID)
		return 0, ErrCodeExpired
	}
	verifiedCookies, err := s.casdoor.VerifyCode(ctx, req.Method, dest, name, req.Code, cookies)
	if err != nil {
		s.recordIdentityFail(ctx, userID)
		errMsg := err.Error()
		if strings.Contains(errMsg, "already been used") || strings.Contains(errMsg, "expired") || strings.Contains(errMsg, "已失效") {
			return 0, ErrCodeExpired
		}
		return 0, ErrInvalidCode
	}

	// 签发凭证：联系方式改动与改密码都靠它放行
	cred := &identityCredential{
		Method:   req.Method,
		Dest:     dest,
		Code:     req.Code,
		Cookies:  verifiedCookies,
		ExpireAt: time.Now().Add(identityVerifyTTL).Unix(),
	}
	data, err := json.Marshal(cred)
	if err != nil {
		return 0, ErrInvalidInput
	}
	if err := s.rdb.Set(ctx, identityKey(userID), data, identityVerifyTTL).Err(); err != nil {
		logrus.WithFields(logrus.Fields{"user_id": userID, "error": err}).Error("redis save identity credential failed")
		return 0, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	s.clearIdentityFail(ctx, userID)
	return identityVerifyTTLSeconds, nil
}
