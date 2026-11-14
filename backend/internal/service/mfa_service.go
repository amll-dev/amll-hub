package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/sirupsen/logrus"
)

// mfaSetupChallengeTTL MFA 绑定会话有效期
const mfaSetupChallengeTTL = 10 * time.Minute

// MfaStatusItem 单个 MFA 因子的启用状态
type MfaStatusItem struct {
	MfaType     string `json:"mfaType"`
	Enabled     bool   `json:"enabled"`
	IsPreferred bool   `json:"isPreferred"`
}

// MfaStatus 用户 MFA 总览
type MfaStatus struct {
	Methods   []MfaStatusItem `json:"methods"`
	Preferred string          `json:"preferred,omitempty"`
}

// MfaSetupStart 开始绑定 MFA 后返回给前端的信息
type MfaSetupStart struct {
	ChallengeID string `json:"challengeId"`
	MfaType     string `json:"mfaType"`
	Secret      string `json:"secret,omitempty"`
	OtpauthURL  string `json:"otpauthUrl,omitempty"`
	Dest        string `json:"dest,omitempty"`
}

// MfaSetupResult 绑定完成后的结果
type MfaSetupResult struct {
	RecoveryCode string `json:"recoveryCode,omitempty"`
}

// mfaSetupChallenge 服务端保存的绑定会话
type mfaSetupChallenge struct {
	UserID       string         `json:"userId"`
	MfaType      string         `json:"mfaType"`
	Secret       string         `json:"secret,omitempty"`
	Dest         string         `json:"dest,omitempty"`
	CountryCode  string         `json:"countryCode,omitempty"`
	RecoveryCode string         `json:"recoveryCode,omitempty"`
	Fails        int            `json:"fails"`
	Cookies      []*http.Cookie `json:"cookies,omitempty"`
}

func mfaSetupKey(id string) string {
	return "auth:mfa:setup:" + id
}

// maskDest 脱敏展示邮箱/手机号
func maskDest(mfaType, dest string) string {
	if mfaType == "sms" && len(dest) > 4 {
		return "****" + dest[len(dest)-4:]
	}
	if idx := strings.Index(dest, "@"); idx > 1 {
		return dest[:1] + "***" + dest[idx:]
	}
	return dest
}

// GetMfaStatus 查询用户 MFA 状态
func (s *AuthService) GetMfaStatus(ctx context.Context, userID string) (*MfaStatus, error) {
	user, err := s.getUserByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("查询用户失败: %w", err)
	}

	preferred := user.PreferredMfaType
	enabled := map[string]bool{
		"app":   false,
		"email": false,
		"sms":   false,
	}
	for _, m := range user.MultiFactorAuths {
		if _, ok := enabled[m.MfaType]; ok {
			enabled[m.MfaType] = m.Enabled
		}
	}
	// 兼容未返回 multiFactorAuths 的旧版 Casdoor
	if len(user.MultiFactorAuths) == 0 {
		enabled["app"] = user.TotpSecret != ""
		enabled["email"] = user.MfaEmailEnabled
		enabled["sms"] = user.MfaPhoneEnabled
	}

	methods := []MfaStatusItem{
		{MfaType: "app", Enabled: enabled["app"], IsPreferred: preferred == "app"},
		{MfaType: "email", Enabled: enabled["email"], IsPreferred: preferred == "email"},
		{MfaType: "sms", Enabled: enabled["sms"], IsPreferred: preferred == "sms"},
	}
	return &MfaStatus{Methods: methods, Preferred: preferred}, nil
}

// StartMfaSetup 初始化 MFA 绑定
func (s *AuthService) StartMfaSetup(ctx context.Context, userID, mfaType string) (*MfaSetupStart, error) {
	if mfaType != "app" && mfaType != "email" && mfaType != "sms" {
		return nil, ErrMfaMethodUnavailable
	}

	owner, name, err := splitUserID(userID)
	if err != nil {
		return nil, err
	}

	user, err := s.getUserByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("查询用户失败: %w", err)
	}

	var dest, countryCode string
	switch mfaType {
	case "email":
		if user.Email == "" {
			return nil, ErrMfaMethodUnavailable
		}
		dest = user.Email
	case "sms":
		if user.Phone == "" {
			return nil, ErrMfaMethodUnavailable
		}
		dest = user.Phone
		countryCode = user.CountryCode
	}

	props, cookies, err := s.casdoor.MfaSetupInitiate(ctx, owner, name, mfaType)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrMfaOperationFailed, err)
	}

	recoveryCode := ""
	if len(props.RecoveryCodes) > 0 {
		recoveryCode = props.RecoveryCodes[0]
	}

	id, err := newChallengeID()
	if err != nil {
		return nil, fmt.Errorf("生成 MFA 绑定会话失败: %w", err)
	}

	ch := &mfaSetupChallenge{
		UserID:       s.org + "/" + name,
		MfaType:      mfaType,
		Secret:       props.Secret,
		Dest:         dest,
		CountryCode:  countryCode,
		RecoveryCode: recoveryCode,
		Cookies:      cookies,
	}
	if user.Owner != "" && user.Name != "" {
		ch.UserID = user.Owner + "/" + user.Name
	}
	data, err := json.Marshal(ch)
	if err != nil {
		return nil, fmt.Errorf("序列化 MFA 绑定会话失败: %w", err)
	}
	if err := s.rdb.Set(ctx, mfaSetupKey(id), data, mfaSetupChallengeTTL).Err(); err != nil {
		return nil, fmt.Errorf("保存 MFA 绑定会话失败: %w", err)
	}

	start := &MfaSetupStart{
		ChallengeID: id,
		MfaType:     mfaType,
		OtpauthURL:  props.URL,
	}
	if mfaType == "app" {
		start.Secret = props.Secret
	} else {
		start.Dest = maskDest(mfaType, dest)
	}
	return start, nil
}

func (s *AuthService) loadMfaSetupChallenge(ctx context.Context, id string) (*mfaSetupChallenge, error) {
	if id == "" {
		return nil, ErrMfaChallengeExpired
	}
	data, err := s.rdb.Get(ctx, mfaSetupKey(id)).Bytes()
	if err != nil {
		return nil, ErrMfaChallengeExpired
	}
	var ch mfaSetupChallenge
	if err := json.Unmarshal(data, &ch); err != nil {
		return nil, ErrMfaChallengeExpired
	}
	return &ch, nil
}

func (s *AuthService) saveMfaSetupChallenge(ctx context.Context, id string, ch *mfaSetupChallenge) {
	data, err := json.Marshal(ch)
	if err != nil {
		logrus.WithError(err).Error("序列化 MFA 绑定会话失败")
		return
	}
	if err := s.rdb.Set(ctx, mfaSetupKey(id), data, mfaSetupChallengeTTL).Err(); err != nil {
		logrus.WithError(err).Error("保存 MFA 绑定会话失败")
	}
}

// SendMfaSetupCode 给当前绑定会话发送邮箱/短信验证码
func (s *AuthService) SendMfaSetupCode(ctx context.Context, userID, challengeID, captchaType, captchaToken string) error {
	ch, err := s.loadMfaSetupChallenge(ctx, challengeID)
	if err != nil {
		return err
	}
	if ch.UserID != userID {
		return ErrMfaChallengeExpired
	}
	if ch.MfaType != "email" && ch.MfaType != "sms" {
		return ErrMfaMethodUnavailable
	}
	if ch.Dest == "" {
		return ErrMfaMethodUnavailable
	}

	_, name, err := splitUserID(ch.UserID)
	if err != nil {
		return err
	}
	checkType := "email"
	if ch.MfaType == "sms" {
		checkType = "phone"
	}

	if captchaType == "" {
		captchaType = "none"
		if data, cErr := s.casdoor.GetCaptcha(ctx); cErr == nil {
			var cfg struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(data, &cfg) == nil && cfg.Type != "" {
				captchaType = cfg.Type
			}
		}
	}

	cooldownKey := "auth:mfa:setup:send:" + challengeID
	ok, err := s.rdb.SetNX(ctx, cooldownKey, 1, sendCodeCooldown).Result()
	if err != nil {
		return fmt.Errorf("检查发送冷却失败: %w", err)
	}
	if !ok {
		return ErrSendCodeCooldown
	}

	if _, err := s.casdoor.SendMfaSetupCode(ctx, name, checkType, ch.Dest, ch.CountryCode, captchaType, captchaToken); err != nil {
		_ = s.rdb.Del(ctx, cooldownKey).Err()
		return mapMfaSendErr(err)
	}
	return nil
}

// CompleteMfaSetup 校验验证码并启用 MFA 因子
func (s *AuthService) CompleteMfaSetup(ctx context.Context, userID, challengeID, passcode string) (*MfaSetupResult, error) {
	ch, err := s.loadMfaSetupChallenge(ctx, challengeID)
	if err != nil {
		return nil, err
	}
	if ch.UserID != userID {
		return nil, ErrMfaChallengeExpired
	}
	if ch.Fails >= maxMfaFails {
		_ = s.rdb.Del(ctx, mfaSetupKey(challengeID)).Err()
		return nil, ErrMfaTooManyAttempts
	}
	if strings.TrimSpace(passcode) == "" {
		return nil, ErrInvalidCode
	}

	owner, name, err := splitUserID(ch.UserID)
	if err != nil {
		return nil, err
	}

	cookies, err := s.casdoor.MfaSetupVerify(ctx, ch.Cookies, owner, name, ch.MfaType, passcode, ch.Secret, ch.Dest, ch.CountryCode)
	if err != nil {
		ch.Fails++
		if ch.Fails >= maxMfaFails {
			_ = s.rdb.Del(ctx, mfaSetupKey(challengeID)).Err()
			return nil, ErrMfaTooManyAttempts
		}
		s.saveMfaSetupChallenge(ctx, challengeID, ch)
		return nil, ErrInvalidCode
	}

	if _, err := s.casdoor.MfaSetupEnable(ctx, cookies, owner, name, ch.MfaType, ch.Secret, ch.Dest, ch.CountryCode, ch.RecoveryCode); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrMfaOperationFailed, err)
	}

	_ = s.rdb.Del(ctx, mfaSetupKey(challengeID)).Err()
	return &MfaSetupResult{RecoveryCode: ch.RecoveryCode}, nil
}

// DisableMfa 关闭用户全部 MFA 因子
func (s *AuthService) DisableMfa(ctx context.Context, userID string) error {
	owner, name, err := splitUserID(userID)
	if err != nil {
		return err
	}
	if err := s.casdoor.DeleteMfa(ctx, owner, name); err != nil {
		return fmt.Errorf("%w: %v", ErrMfaOperationFailed, err)
	}
	return nil
}

// SetPreferredMfa 设置首选 MFA 因子
func (s *AuthService) SetPreferredMfa(ctx context.Context, userID, mfaType string) error {
	if mfaType != "app" && mfaType != "email" && mfaType != "sms" {
		return ErrMfaMethodUnavailable
	}
	owner, name, err := splitUserID(userID)
	if err != nil {
		return err
	}
	if err := s.casdoor.SetPreferredMfa(ctx, owner, name, mfaType); err != nil {
		return fmt.Errorf("%w: %v", ErrMfaOperationFailed, err)
	}
	return nil
}
