package ws

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
)

// 消息类型
const (
	TypeViewers       = "viewers"            // 观众列表更新
	TypeSubmissionChg = "submission_changed" // 投稿状态变更（列表页订阅）
	TypePing          = "ping"
)

// 消息频道（Redis Pub/Sub）
const (
	ChannelViewers = "submission:viewers"
	ChannelChanged = "submission:changed"
)

// Message WebSocket 推送消息
type Message struct {
	Type         string `json:"type"`
	SubmissionID int64  `json:"submissionId,omitempty"`
	Data         any    `json:"data,omitempty"`
}

// Client WebSocket 客户端
type Client struct {
	conn         *websocket.Conn
	submissionID int64 // 0 表示列表页连接
	username     string
	displayName  string
	avatar       string
	send         chan []byte
	hub          *Hub
	onClose      func() // 连接断开后回调（用于通知观众列表更新）
}

// Viewer 观众信息
type Viewer struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
}

// ViewersPayload 观众列表推送负载
type ViewersPayload struct {
	SubmissionID int64    `json:"submissionId"`
	Viewers      []Viewer `json:"viewers"`
}

// Hub WebSocket hub，单实例内广播 + Redis Pub/Sub 跨实例广播
type Hub struct {
	rdb *redis.Client

	mu           sync.RWMutex
	clientsBySub map[int64]map[*Client]struct{} // submissionId -> clients
	listClients  map[*Client]struct{}

	register   chan *Client
	unregister chan *Client

	// 客户端注册/注销后的回调，通过 SetViewerNotifier 注入
	viewerNotifier func(submissionID int64)
}

// NewHub 创建 Hub
func NewHub(rdb *redis.Client) *Hub {
	return &Hub{
		rdb:          rdb,
		clientsBySub: make(map[int64]map[*Client]struct{}),
		listClients:  make(map[*Client]struct{}),
		register:     make(chan *Client, 64),
		unregister:   make(chan *Client, 64),
	}
}

// SetViewerNotifier 注入观众列表通知回调（由 main 注入 ViewerService.NotifyViewers）
func (h *Hub) SetViewerNotifier(fn func(submissionID int64)) {
	h.viewerNotifier = fn
}

// Register 注册客户端到 Hub（非阻塞，由 handler 调用）
func (h *Hub) Register(c *Client) {
	select {
	case h.register <- c:
	default:
		// register 通道满，直接关闭客户端
		logrus.WithFields(logrus.Fields{
			"submission_id": c.submissionID,
			"username":      c.username,
		}).Warn("ws hub register channel full, closing client")
		safeClose(c.send)
	}
}

// Unregister 注销客户端
func (h *Hub) Unregister(c *Client) {
	select {
	case h.unregister <- c:
	default:
	}
}

// Run 启动 Hub 主循环：处理本地注册/注销 + 订阅 Redis Pub/Sub
func (h *Hub) Run(ctx context.Context) {
	// 1. 订阅 Redis 频道
	sub := h.rdb.Subscribe(ctx, ChannelViewers, ChannelChanged)
	defer func() { _ = sub.Close() }()

	msgCh := sub.Channel()

	for {
		select {
		case <-ctx.Done():
			return
		case c := <-h.register:
			h.registerClient(c)
		case c := <-h.unregister:
			h.unregisterClient(c)
		case msg, ok := <-msgCh:
			if !ok {
				return
			}
			h.broadcastLocal(msg.Channel, []byte(msg.Payload))
		}
	}
}

func (h *Hub) registerClient(c *Client) {
	h.mu.Lock()
	if c.submissionID > 0 {
		set, ok := h.clientsBySub[c.submissionID]
		if !ok {
			set = make(map[*Client]struct{})
			h.clientsBySub[c.submissionID] = set
		}
		set[c] = struct{}{}
	} else {
		h.listClients[c] = struct{}{}
	}
	h.mu.Unlock()
	// 注册成功后触发观众列表广播（此时客户端已在 map 中，不会漏算）
	if c.submissionID > 0 && h.viewerNotifier != nil {
		h.viewerNotifier(c.submissionID)
	}
}

func (h *Hub) unregisterClient(c *Client) {
	logrus.WithFields(logrus.Fields{
		"submission_id": c.submissionID,
		"username":      c.username,
	}).Debug("ws client unregistered")
	h.mu.Lock()
	if c.submissionID > 0 {
		if set, ok := h.clientsBySub[c.submissionID]; ok {
			delete(set, c)
			if len(set) == 0 {
				delete(h.clientsBySub, c.submissionID)
			}
		}
	} else {
		delete(h.listClients, c)
	}
	safeClose(c.send)
	subID := c.submissionID
	h.mu.Unlock()
	// 注销后触发观众列表广播
	if subID > 0 && h.viewerNotifier != nil {
		h.viewerNotifier(subID)
	}
}

// broadcastLocal 在本实例内广播消息
func (h *Hub) broadcastLocal(channel string, payload []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	var msg Message
	_ = json.Unmarshal(payload, &msg)

	switch channel {
	case ChannelViewers:
		// 推送给该投稿详情页所有客户端
		if set, ok := h.clientsBySub[msg.SubmissionID]; ok {
			for c := range set {
				safeSend(c.send, payload)
			}
		}
	case ChannelChanged:
		// 推给所有列表页客户端
		for c := range h.listClients {
			safeSend(c.send, payload)
		}
		// 同时推给该投稿详情页客户端
		if msg.SubmissionID > 0 {
			if set, ok := h.clientsBySub[msg.SubmissionID]; ok {
				for c := range set {
					safeSend(c.send, payload)
				}
			}
		}
	}
}

// safeSend 非阻塞发送，recover 防止向已关闭 channel 发送时 panic 导致 Hub 崩溃
func safeSend(ch chan []byte, payload []byte) {
	defer func() { _ = recover() }()
	select {
	case ch <- payload:
	default:
		// 客户端慢，丢弃
	}
}

// safeClose 安全关闭 channel，recover 防止重复 close 导致 panic
func safeClose(ch chan []byte) {
	defer func() { _ = recover() }()
	close(ch)
}

// PublishViewers 发布观众列表变更到 Redis（其他实例收到后广播本地）
func (h *Hub) PublishViewers(ctx context.Context, submissionID int64, viewers []Viewer) error {
	p := ViewersPayload{SubmissionID: submissionID, Viewers: viewers}
	data, err := json.Marshal(Message{
		Type:         TypeViewers,
		SubmissionID: submissionID,
		Data:         p,
	})
	if err != nil {
		return err
	}
	return h.rdb.Publish(ctx, ChannelViewers, data).Err()
}

// PublishChanged 发布投稿状态变更到 Redis
func (h *Hub) PublishChanged(ctx context.Context, submissionID int64, data any) error {
	dataBytes, err := json.Marshal(Message{
		Type:         TypeSubmissionChg,
		SubmissionID: submissionID,
		Data:         data,
	})
	if err != nil {
		return err
	}
	return h.rdb.Publish(ctx, ChannelChanged, dataBytes).Err()
}

// CollectViewers 收集指定投稿当前实例的在线观众
func (h *Hub) CollectViewers(submissionID int64) []Viewer {
	h.mu.RLock()
	defer h.mu.RUnlock()
	set, ok := h.clientsBySub[submissionID]
	if !ok {
		return []Viewer{}
	}
	viewers := make([]Viewer, 0, len(set))
	for c := range set {
		viewers = append(viewers, Viewer{
			Username:    c.username,
			DisplayName: c.displayName,
			Avatar:      c.avatar,
		})
	}
	return viewers
}

// NewClient 创建客户端
func NewClient(conn *websocket.Conn, hub *Hub, submissionID int64, username, displayName, avatar string, onClose func()) *Client {
	return &Client{
		conn:         conn,
		submissionID: submissionID,
		username:     username,
		displayName:  displayName,
		avatar:       avatar,
		send:         make(chan []byte, 32),
		hub:          hub,
		onClose:      onClose,
	}
}

// ReadPump 读循环（必须由调用方启动 goroutine）
func (c *Client) ReadPump() {
	defer func() {
		c.hub.Unregister(c)
		_ = c.conn.Close()
		if c.onClose != nil {
			c.onClose()
		}
	}()
	// 设置读超时与 pong 处理
	_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			logrus.WithFields(logrus.Fields{
				"submission_id": c.submissionID,
				"username":      c.username,
				"error":         err,
			}).Debug("ws read loop closed")
			return
		}
	}
}

// WritePump 写循环（必须由调用方启动 goroutine）
func (c *Client) WritePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				logrus.WithFields(logrus.Fields{
					"submission_id": c.submissionID,
					"username":      c.username,
					"error":         err,
				}).Debug("ws write message failed, closing write loop")
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				logrus.WithFields(logrus.Fields{
					"submission_id": c.submissionID,
					"username":      c.username,
					"error":         err,
				}).Debug("ws ping failed, closing write loop")
				return
			}
		}
	}
}
