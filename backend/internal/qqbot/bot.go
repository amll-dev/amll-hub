package qqbot

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/config"
	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gorilla/websocket"
	logrus "github.com/sirupsen/logrus"
)

const (
	tokenEndpoint  = "https://bots.qq.com/app/getAppAccessToken"
	productionBase = "https://api.sgroup.qq.com"
	sandboxBase    = "https://sandbox.api.sgroup.qq.com"
	defaultIntents = 1 << 25 // GROUP_AND_C2C_EVENT

	qqHTTPTimeout  = 10 * time.Second
	messageTimeout = 120 * time.Second
	imageTimeout   = 20 * time.Second
)

// Bot 内嵌在 API 进程里的 QQ 官方机器人。
// 只维护一条群聊 WebSocket 长连接，因此要求后端保持单副本。
type Bot struct {
	cfg      config.QQBotConfig
	search   *service.SearchService
	daily    *service.DailyRecommendationService
	latest   *service.LatestSongService
	notFound *service.NotFoundService

	http      *http.Client
	mediaHTTP *http.Client
	tokens    *tokenManager

	writeMu        sync.Mutex
	markdownBroken atomic.Bool
	materialBroken atomic.Bool

	searchCache  *ttlCache[*service.SearchResult]
	dailyCache   *ttlCache[*model.DailyRecommendation]
	latestCache  *ttlCache[[]service.LatestSongItem]
	rankingCache *ttlCache[rankingSnapshot]
}

func New(
	cfg config.QQBotConfig,
	search *service.SearchService,
	daily *service.DailyRecommendationService,
	latest *service.LatestSongService,
	notFound *service.NotFoundService,
) *Bot {
	if cfg.Intents == 0 {
		cfg.Intents = defaultIntents
	}
	return &Bot{
		cfg:          cfg,
		search:       search,
		daily:        daily,
		latest:       latest,
		notFound:     notFound,
		http:         &http.Client{Timeout: qqHTTPTimeout},
		mediaHTTP:    &http.Client{Timeout: imageTimeout},
		tokens:       &tokenManager{appID: cfg.AppID, secret: cfg.ClientSecret, http: &http.Client{Timeout: qqHTTPTimeout}},
		searchCache:  newTTLCache[*service.SearchResult](),
		dailyCache:   newTTLCache[*model.DailyRecommendation](),
		latestCache:  newTTLCache[[]service.LatestSongItem](),
		rankingCache: newTTLCache[rankingSnapshot](),
	}
}

// Run 维持网关连接，断线后指数退避重连，直到 ctx 取消。
func (b *Bot) Run(ctx context.Context) {
	logrus.Info("[qqbot] 启动 QQ 机器人网关连接")
	backoff := time.Second
	for {
		if ctx.Err() != nil {
			return
		}

		startedAt := time.Now()
		err := b.session(ctx)
		if ctx.Err() != nil {
			return
		}
		if time.Since(startedAt) > time.Minute {
			backoff = time.Second
		}

		logrus.WithError(err).Warnf("[qqbot] 网关连接断开，%s 后重连", backoff)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > 30*time.Second {
			backoff = 30 * time.Second
		}
	}
}

func (b *Bot) session(ctx context.Context) error {
	token, err := b.tokens.get(ctx)
	if err != nil {
		return fmt.Errorf("获取 access token 失败: %w", err)
	}
	gatewayURL, err := b.gatewayURL(ctx, token)
	if err != nil {
		return err
	}

	conn, _, err := websocket.DefaultDialer.DialContext(ctx, gatewayURL, nil)
	if err != nil {
		return fmt.Errorf("连接网关失败: %w", err)
	}
	defer conn.Close()
	conn.SetReadLimit(1 << 20)

	// 首帧必须是 Hello(op=10)
	_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		return fmt.Errorf("等待 Hello 失败: %w", err)
	}
	var hello struct {
		Op int `json:"op"`
		D  struct {
			HeartbeatInterval int `json:"heartbeat_interval"`
		} `json:"d"`
	}
	if err := json.Unmarshal(data, &hello); err != nil {
		return fmt.Errorf("解析 Hello 失败: %w", err)
	}
	if hello.Op != 10 {
		return fmt.Errorf("期望 Hello(op=10)，收到 op=%d", hello.Op)
	}
	_ = conn.SetReadDeadline(time.Time{})

	interval := time.Duration(hello.D.HeartbeatInterval) * time.Millisecond
	if interval <= 0 {
		interval = 30 * time.Second
	}

	identify := map[string]any{
		"op": 2,
		"d": map[string]any{
			"token":      "QQBot " + token,
			"intents":    b.cfg.Intents,
			"shard":      []int{0, 1},
			"properties": map[string]string{},
		},
	}
	if err := b.writeJSON(conn, identify); err != nil {
		return fmt.Errorf("发送 Identify 失败: %w", err)
	}

	sessCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	var lastSeq atomic.Int64
	var acked atomic.Bool
	acked.Store(true)

	go b.heartbeat(sessCtx, conn, interval, &lastSeq, &acked)
	go func() {
		<-sessCtx.Done()
		_ = conn.Close()
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return err
		}

		var payload gatewayPayload
		if err := json.Unmarshal(data, &payload); err != nil {
			continue
		}
		if payload.S > 0 {
			lastSeq.Store(payload.S)
		}

		switch payload.Op {
		case 0:
			if payload.T == "READY" {
				logrus.Info("[qqbot] 已连接到 QQ 网关")
				continue
			}
			b.dispatch(sessCtx, payload.T, payload.D)
		case 11:
			acked.Store(true)
		case 7:
			return errors.New("QQ 网关要求重连")
		case 9:
			return errors.New("QQ 会话失效")
		}
	}
}

func (b *Bot) heartbeat(
	ctx context.Context,
	conn *websocket.Conn,
	interval time.Duration,
	lastSeq *atomic.Int64,
	acked *atomic.Bool,
) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !acked.Swap(false) {
				logrus.Warn("[qqbot] 心跳未被确认，主动断开重连")
				_ = conn.Close()
				return
			}
			var d any
			if seq := lastSeq.Load(); seq > 0 {
				d = seq
			}
			if err := b.writeJSON(conn, map[string]any{"op": 1, "d": d}); err != nil {
				_ = conn.Close()
				return
			}
		}
	}
}

func (b *Bot) dispatch(ctx context.Context, eventType string, data json.RawMessage) {
	// 只处理群内 @ 消息，其余事件（成员变更、单聊等）忽略
	if eventType != "GROUP_AT_MESSAGE_CREATE" {
		return
	}

	var event groupMessageEvent
	if err := json.Unmarshal(data, &event); err != nil {
		logrus.WithError(err).Warn("[qqbot] 解析群消息失败")
		return
	}
	if event.ID == "" || event.GroupOpenID == "" {
		return
	}

	pkg.GoSafe("qqbot-message", func() {
		msgCtx, cancel := context.WithTimeout(ctx, messageTimeout)
		defer cancel()
		b.handleGroupMessage(msgCtx, event)
	})
}

func (b *Bot) handleGroupMessage(ctx context.Context, event groupMessageEvent) {
	rep := b.buildReply(ctx, event.Content)
	if rep.Text == "" && rep.FallbackText == "" && len(rep.Images) == 0 {
		return
	}

	// 优先把正文和封面合并成一条 Markdown 消息
	if b.cfg.Markdown && !b.markdownBroken.Load() {
		content, imageIDs, ok := b.markdownReplyWithCovers(ctx, rep)
		if ok {
			err := b.sendGroupMarkdown(ctx, event.GroupOpenID, event.ID, 1, content)
			b.scheduleMarkdownImageDeletion(imageIDs)
			if err == nil {
				return
			}
			logrus.WithError(err).Warn("[qqbot] Markdown 消息发送失败，改发纯文本")
			if isClientError(err) {
				// 平台不支持或无 Markdown 权限：本次进程内不再尝试
				b.markdownBroken.Store(true)
			}
		} else {
			b.scheduleMarkdownImageDeletion(imageIDs)
		}
	}

	// 图片上传失败时不再回退富媒体消息；列表类消息优先退回完整文字版
	text := rep.FallbackText
	if text == "" {
		text = rep.Text
	}
	if text == "" {
		return
	}
	if err := b.sendGroupPlain(ctx, event.GroupOpenID, event.ID, 1, plainFromMarkdown(text)); err != nil {
		logrus.WithError(err).WithFields(logrus.Fields{
			"group": mask(event.GroupOpenID),
			"event": mask(event.ID),
		}).Warn("[qqbot] 发送消息失败")
	}
}

func (b *Bot) sendGroupPlain(ctx context.Context, groupOpenID, msgID string, seq int, content string) error {
	payload := map[string]any{
		"content":  content,
		"msg_type": 0,
		"msg_id":   msgID,
		"msg_seq":  seq,
	}
	_, err := b.postJSON(ctx, "/v2/groups/"+url.PathEscape(groupOpenID)+"/messages", payload)
	return err
}

func (b *Bot) sendGroupMarkdown(ctx context.Context, groupOpenID, msgID string, seq int, content string) error {
	payload := map[string]any{
		"msg_type": 2,
		"markdown": map[string]string{"content": content},
		"msg_id":   msgID,
		"msg_seq":  seq,
	}
	_, err := b.postJSON(ctx, "/v2/groups/"+url.PathEscape(groupOpenID)+"/messages", payload)
	return err
}

func (b *Bot) gatewayURL(ctx context.Context, token string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, b.apiBase()+"/gateway", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "QQBot "+token)

	resp, err := b.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("获取网关地址失败 HTTP %s: %s", resp.Status, clip(string(data), 200))
	}

	var out struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return "", err
	}
	if out.URL == "" {
		return "", fmt.Errorf("网关地址为空: %s", clip(string(data), 200))
	}
	return out.URL, nil
}

func (b *Bot) postJSON(ctx context.Context, path string, payload any) ([]byte, error) {
	return b.doJSON(ctx, http.MethodPost, path, payload)
}

func (b *Bot) deleteJSON(ctx context.Context, path string) error {
	_, err := b.doJSON(ctx, http.MethodDelete, path, nil)
	return err
}

func (b *Bot) doJSON(ctx context.Context, method, path string, payload any) ([]byte, error) {
	token, err := b.tokens.get(ctx)
	if err != nil {
		return nil, err
	}

	var reader io.Reader
	if payload != nil {
		body, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, b.apiBase()+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "QQBot "+token)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := b.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return nil, &qqHTTPError{Status: resp.StatusCode, Body: clip(string(data), 300)}
	}
	return data, nil
}

type qqHTTPError struct {
	Status int
	Body   string
}

func (e *qqHTTPError) Error() string {
	return fmt.Sprintf("HTTP %d: %s", e.Status, e.Body)
}

func isClientError(err error) bool {
	var httpErr *qqHTTPError
	return errors.As(err, &httpErr) && httpErr.Status >= 400 && httpErr.Status < 500
}

func (b *Bot) writeJSON(conn *websocket.Conn, payload any) error {
	b.writeMu.Lock()
	defer b.writeMu.Unlock()
	_ = conn.SetWriteDeadline(time.Now().Add(qqHTTPTimeout))
	return conn.WriteJSON(payload)
}

func (b *Bot) apiBase() string {
	if b.cfg.Sandbox {
		return sandboxBase
	}
	return productionBase
}

type gatewayPayload struct {
	Op int             `json:"op"`
	S  int64           `json:"s"`
	T  string          `json:"t"`
	D  json.RawMessage `json:"d"`
}

type groupMessageEvent struct {
	ID          string `json:"id"`
	Content     string `json:"content"`
	GroupOpenID string `json:"group_openid"`
	Author      struct {
		ID           string `json:"id"`
		MemberOpenID string `json:"member_openid"`
	} `json:"author"`
}

type tokenManager struct {
	appID  string
	secret string
	http   *http.Client

	mu        sync.Mutex
	token     string
	expiresAt time.Time
}

func (t *tokenManager) get(ctx context.Context) (string, error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	now := time.Now()
	if t.token != "" && now.Before(t.expiresAt.Add(-time.Minute)) {
		return t.token, nil
	}

	body, err := json.Marshal(map[string]string{
		"appId":        t.appID,
		"clientSecret": t.secret,
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenEndpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("获取 token 失败 HTTP %s: %s", resp.Status, clip(string(data), 200))
	}

	var out struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   any    `json:"expires_in"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return "", err
	}
	if out.AccessToken == "" {
		return "", fmt.Errorf("access token 为空: %s", clip(string(data), 200))
	}

	expiresIn := 7200
	switch v := out.ExpiresIn.(type) {
	case float64:
		expiresIn = int(v)
	case string:
		if n, err := strconv.Atoi(v); err == nil {
			expiresIn = n
		}
	}
	if expiresIn < 60 {
		expiresIn = 60
	}

	t.token = out.AccessToken
	t.expiresAt = now.Add(time.Duration(expiresIn) * time.Second)
	return t.token, nil
}

func mask(value string) string {
	if len(value) <= 6 {
		return value
	}
	return value[:6] + "***"
}
