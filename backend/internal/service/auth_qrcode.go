package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	logrus "github.com/sirupsen/logrus"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
)

const (
	// qrTicketTTL 二维码票据有效期
	qrTicketTTL = 5 * time.Minute
	// qrTicketPrefix Redis键前缀
	qrTicketPrefix = "qrlogin:ticket:"
	// qrScheme App deep link scheme，扫码后唤起 App
	qrScheme = "amllhub"
)

// 二维码票据状态
const (
	QRStatusPending   = "pending"   // 等待扫码
	QRStatusScanned   = "scanned"   // 已扫码，等待用户确认
	QRStatusConfirmed = "confirmed" // 已确认，网页端可取 token
	QRStatusExpired   = "expired"   // 已过期 / 已取消
)

// QRTicketState Redis 中存储的票据状态
type QRTicketState struct {
	Status string       `json:"status"`
	UserID string       `json:"userId,omitempty"` // 扫码并确认的用户
	Token  string       `json:"token,omitempty"`  // confirmed 时下发给网页端的 JWT
	User   *UserProfile `json:"user,omitempty"`
}

// QRTicketCreateResult 创建票据的返回
type QRTicketCreateResult struct {
	Ticket    string `json:"ticket"`
	QRContent string `json:"qrContent"` // 塞进二维码的 deep link
	ExpiresIn int    `json:"expiresIn"` // 剩余有效秒数
}

// QRTicketStatusResult 轮询状态的返回
type QRTicketStatusResult struct {
	Status string       `json:"status"`
	Token  string       `json:"token,omitempty"`
	User   *UserProfile `json:"user,omitempty"`
}

// CreateQRTicket 生成一个扫码登录票据。
// 二维码内容是 deep link（amllhub://qrlogin?ticket=xxx），App 扫码后直接唤起并确认。
func (s *AuthService) CreateQRTicket(ctx context.Context) (*QRTicketCreateResult, error) {
	ticket, err := randomTicket()
	if err != nil {
		return nil, err
	}

	state := &QRTicketState{Status: QRStatusPending}
	payload, err := json.Marshal(state)
	if err != nil {
		return nil, err
	}

	if err := s.rdb.Set(ctx, qrTicketPrefix+ticket, payload, qrTicketTTL).Err(); err != nil {
		logrus.WithError(err).Error("qr login: store ticket failed")
		return nil, fmt.Errorf("%w: 保存扫码票据失败", ErrUpstreamUnavailable)
	}

	return &QRTicketCreateResult{
		Ticket:    ticket,
		QRContent: fmt.Sprintf("%s://qrlogin?ticket=%s", qrScheme, ticket),
		ExpiresIn: int(qrTicketTTL.Seconds()),
	}, nil
}

// GetQRTicketStatus 供网页端轮询票据状态。
// confirmed 时返回可用的 token 与用户资料。
func (s *AuthService) GetQRTicketStatus(ctx context.Context, ticket string) (*QRTicketStatusResult, error) {
	ticket = strings.TrimSpace(ticket)
	if ticket == "" {
		return nil, ErrInvalidInput
	}

	state, err := s.loadQRTicket(ctx, ticket)
	if err != nil {
		return nil, err
	}
	if state == nil {
		return &QRTicketStatusResult{Status: QRStatusExpired}, nil
	}

	// confirmed 的票据取出一次即删除，避免 token 被反复读取
	if state.Status == QRStatusConfirmed {
		s.rdb.Del(ctx, qrTicketPrefix+ticket)
		return &QRTicketStatusResult{
			Status: QRStatusConfirmed,
			Token:  state.Token,
			User:   state.User,
		}, nil
	}

	return &QRTicketStatusResult{Status: state.Status}, nil
}

// MarkQRTicketScanned App 扫到二维码、尚未确认时打标记，
// 让网页端能立刻提示「已扫码，等待手机确认」。
func (s *AuthService) MarkQRTicketScanned(ctx context.Context, ticket, userID string) error {
	ticket = strings.TrimSpace(ticket)
	if ticket == "" || userID == "" {
		return ErrInvalidInput
	}

	state, err := s.loadQRTicket(ctx, ticket)
	if err != nil {
		return err
	}
	if state == nil {
		return ErrQRTicketExpired
	}
	if state.Status == QRStatusConfirmed {
		return ErrQRTicketExpired
	}
	if state.Status == QRStatusScanned && state.UserID != "" && state.UserID != userID {
		return ErrQRTicketAlreadyScanned
	}

	next := &QRTicketState{Status: QRStatusScanned, UserID: userID}
	payload, err := json.Marshal(next)
	if err != nil {
		return err
	}
	if err := s.rdb.Set(ctx, qrTicketPrefix+ticket, payload, qrTicketTTL).Err(); err != nil {
		logrus.WithError(err).Error("qr login: save scanned state failed")
		return fmt.Errorf("%w: 保存扫码状态失败", ErrUpstreamUnavailable)
	}
	return nil
}

// ConfirmQRTicket App 端确认登录：把当前登录用户的凭证绑定到票据上。
// 确认后网页端下一次轮询即可拿到 token。
func (s *AuthService) ConfirmQRTicket(ctx context.Context, ticket, userID string) error {
	ticket = strings.TrimSpace(ticket)
	if ticket == "" || userID == "" {
		return ErrInvalidInput
	}

	state, err := s.loadQRTicket(ctx, ticket)
	if err != nil {
		return err
	}
	if state == nil {
		return ErrQRTicketExpired
	}
	if state.Status == QRStatusConfirmed {
		// 已确认过，直接覆盖为新用户，保持幂等
		logrus.WithFields(logrus.Fields{"ticket": ticket, "user_id": userID}).
			Info("qr login: ticket already confirmed, overwriting")
	}
	if state.Status == QRStatusScanned && state.UserID != "" && state.UserID != userID {
		return ErrQRTicketAlreadyScanned
	}

	owner, name, err := splitUserID(userID)
	if err != nil {
		return ErrInvalidInput
	}
	user, err := s.casdoor.GetUser(ctx, owner, name)
	if err != nil {
		logrus.WithFields(logrus.Fields{"user_id": userID, "error": err}).Warn("qr login: casdoor get user failed")
		return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	claims := &pkg.Claims{
		Sub:         userID,
		Name:        user.Name,
		DisplayName: user.DisplayName,
		Email:       user.Email,
		Avatar:      user.Avatar,
	}
	token, err := pkg.SignJWT(claims, s.jwtSecret, s.jwtTTL)
	if err != nil {
		return fmt.Errorf("签发 token 失败: %w", err)
	}

	profile := toUserProfile(user)
	next := &QRTicketState{
		Status: QRStatusConfirmed,
		UserID: userID,
		Token:  token,
		User:   &profile,
	}
	payload, err := json.Marshal(next)
	if err != nil {
		return err
	}
	if err := s.rdb.Set(ctx, qrTicketPrefix+ticket, payload, qrTicketTTL).Err(); err != nil {
		logrus.WithError(err).Error("qr login: save confirmed state failed")
		return fmt.Errorf("%w: 保存扫码登录状态失败", ErrUpstreamUnavailable)
	}

	logrus.WithFields(logrus.Fields{"ticket": ticket, "user_id": userID}).Info("qr login confirmed")
	return nil
}

// CancelQRTicket 用户在 App 端主动取消本次扫码登录
func (s *AuthService) CancelQRTicket(ctx context.Context, ticket string) error {
	ticket = strings.TrimSpace(ticket)
	if ticket == "" {
		return ErrInvalidInput
	}
	state, err := s.loadQRTicket(ctx, ticket)
	if err != nil {
		return err
	}
	if state == nil {
		return nil
	}
	// 只有已被本用户扫过但还没确认的票据才允许取消
	if state.Status == QRStatusConfirmed || state.Status == QRStatusScanned {
		return ErrInvalidInput
	}
	payload, _ := json.Marshal(&QRTicketState{Status: QRStatusExpired})
	return s.rdb.Set(ctx, qrTicketPrefix+ticket, payload, qrTicketTTL).Err()
}

// loadQRTicket 读取票据状态，Redis 中查不到返回 (nil, nil)
func (s *AuthService) loadQRTicket(ctx context.Context, ticket string) (*QRTicketState, error) {
	raw, err := s.rdb.Get(ctx, qrTicketPrefix+ticket).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		logrus.WithError(err).Error("qr login: load ticket failed")
		return nil, fmt.Errorf("%w: 读取扫码票据失败", ErrUpstreamUnavailable)
	}
	state := &QRTicketState{}
	if err := json.Unmarshal(raw, state); err != nil {
		logrus.WithError(err).Warn("qr login: decode ticket state failed")
		return nil, nil
	}
	return state, nil
}

// randomTicket 生成 URL 安全的随机票据
func randomTicket() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("生成扫码票据失败: %w", err)
	}
	return strings.TrimRight(base64.URLEncoding.EncodeToString(buf), "="), nil
}
