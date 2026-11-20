package ws

import (
	"context"
	"encoding/json"
	"strconv"
	"sync"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
)

// 消息类型
const (
	TypeViewers        = "viewers"             // 观众列表更新
	TypeSubmissionChg  = "submission_changed"  // 投稿状态变更（列表页订阅）
	TypePluginChg      = "plugin_changed"      // 插件状态变更（插件详情页订阅）
	TypeRecruitmentChg = "recruitment_changed" // 审核招募变更（登录页订阅）
	TypeNotification   = "notification"        // 站内消息推送（按用户路由）
	TypePing           = "ping"
)

// 消息频道（Redis Pub/Sub）
const (
	ChannelViewers      = "submission:viewers"
	ChannelChanged      = "submission:changed"
	ChannelNotification = "user:notification"
)

// 连接模式
const (
	ModeViewers       = "viewers"       // 观众/列表页连接（现有行为）
	ModeNotifications = "notifications" // 站内消息连接（不接收 submission_changed）
	ModeRecruitment   = "recruitment"   // 审核招募订阅（只收 recruitment_changed）
)

// Message WebSocket 推送消息
type Message struct {
	Type         string `json:"type"`
	Room         string `json:"room,omitempty"` // 房间键：sub:<id> / req:<id>
	SubmissionID int64  `json:"submissionId,omitempty"`
	Username     string `json:"username,omitempty"` // 通知频道：消息归属用户，broadcastLocal 按此路由
	Data         any    `json:"data,omitempty"`
	// StaffData 只下发给「审核员 / 该投稿的投稿者本人」：broadcastLocal 会把它合并进 Data 再发，
	// 其余人收到的仍是脱敏后的 Data（reviewer / reviewerInfo 不出现在里面）。
	StaffData any `json:"staffData,omitempty"`
}

// Client WebSocket 客户端
type Client struct {
	conn         *websocket.Conn
	mode         string // ModeViewers / ModeNotifications
	room         string // 房间键（sub:<id> / req:<id>），空表示列表页连接
	submissionID int64  // 投稿 ID（仅投稿房间有值）
	username     string
	displayName  string
	avatar       string
	// canViewInternal 决定是否下发 StaffData 里的内部字段（reviewer / reviewerInfo）。
	// 为真的两种情况：审核员，或该投稿的投稿者本人。
	canViewInternal bool
	send            chan []byte
	hub             *Hub
	onClose         func() // 连接断开后回调（用于通知观众列表更新）
}

// Viewer 观众信息
type Viewer struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
}

// ViewersPayload 观众列表推送负载
type ViewersPayload struct {
	Room         string   `json:"room,omitempty"`
	SubmissionID int64    `json:"submissionId"`
	Viewers      []Viewer `json:"viewers"`
}

// Hub WebSocket hub，单实例内广播 + Redis Pub/Sub 跨实例广播
type Hub struct {
	rdb *redis.Client

	mu            sync.RWMutex
	clientsByRoom map[string]map[*Client]struct{} // room -> clients
	listClients   map[*Client]struct{}
	clientsByUser map[string]map[*Client]struct{} // username -> clients（多标签页 = 多 Client）

	register   chan *Client
	unregister chan *Client

	// 客户端注册/注销后的回调，通过 SetViewerNotifier 注入
	viewerNotifier func(room string)

	// 观众列表通知去抖：room -> 待触发的 timer
	debounceMu     sync.Mutex
	debounceTimers map[string]*time.Timer
}

// viewerNotifyDebounce 同一房间观众变动通知的去抖窗口：
// 短时间内大量进出只触发一次 Redis Publish，避免惊群。
const viewerNotifyDebounce = 200 * time.Millisecond

// NewHub 创建 Hub
func NewHub(rdb *redis.Client) *Hub {
	return &Hub{
		rdb:            rdb,
		clientsByRoom:  make(map[string]map[*Client]struct{}),
		listClients:    make(map[*Client]struct{}),
		clientsByUser:  make(map[string]map[*Client]struct{}),
		debounceTimers: make(map[string]*time.Timer),
		register:       make(chan *Client, 1024),
		unregister:     make(chan *Client, 1024),
	}
}

// SetViewerNotifier 注入观众列表通知回调（由 main 注入 ViewerService.NotifyViewers）
func (h *Hub) SetViewerNotifier(fn func(room string)) {
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
		// 与 Register 对称：通道满时不能静默丢弃，否则该客户端会永远留在
		// clientsByRoom / clientsByUser 里（观众列表与内存双泄漏）
		logrus.WithFields(logrus.Fields{
			"submission_id": c.submissionID,
			"username":      c.username,
		}).Warn("ws hub unregister channel full, client may linger")
	}
}

// Run 启动 Hub 主循环：处理本地注册/注销 + 订阅 Redis Pub/Sub
func (h *Hub) Run(ctx context.Context) {
	// 1. 订阅 Redis 频道
	sub := h.rdb.Subscribe(ctx, ChannelViewers, ChannelChanged, ChannelNotification)
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
	switch c.mode {
	case ModeNotifications:
		set, ok := h.clientsByUser[c.username]
		if !ok {
			set = make(map[*Client]struct{})
			h.clientsByUser[c.username] = set
		}
		set[c] = struct{}{}
	default:
		if c.room != "" {
			set, ok := h.clientsByRoom[c.room]
			if !ok {
				set = make(map[*Client]struct{})
				h.clientsByRoom[c.room] = set
			}
			set[c] = struct{}{}
		} else {
			h.listClients[c] = struct{}{}
		}
	}
	h.mu.Unlock()
	// 注册成功后触发观众列表广播（此时客户端已在 map 中，不会漏算）
	// 异步 + 去抖，避免 Redis RTT 卡住 Hub 主循环
	if c.mode == ModeViewers && c.room != "" {
		h.scheduleViewerNotify(c.room)
	}
}

func (h *Hub) unregisterClient(c *Client) {
	logrus.WithFields(logrus.Fields{
		"submission_id": c.submissionID,
		"username":      c.username,
	}).Debug("ws client unregistered")
	h.mu.Lock()
	switch c.mode {
	case ModeNotifications:
		if set, ok := h.clientsByUser[c.username]; ok {
			delete(set, c)
			if len(set) == 0 {
				delete(h.clientsByUser, c.username)
			}
		}
	default:
		if c.room != "" {
			if set, ok := h.clientsByRoom[c.room]; ok {
				delete(set, c)
				if len(set) == 0 {
					delete(h.clientsByRoom, c.room)
				}
			}
		} else {
			delete(h.listClients, c)
		}
	}
	safeClose(c.send)
	room := c.room
	h.mu.Unlock()
	// 注销后触发观众列表广播（异步 + 去抖，与注册路径一致）
	if c.mode == ModeViewers && room != "" {
		h.scheduleViewerNotify(room)
	}
}

// scheduleViewerNotify 异步、去抖地触发观众列表广播。
//
// viewerNotifier → ViewerService.NotifyRoom → Hub.PublishViewers 会做一次 Redis
// Publish（网络往返）。若在 Hub.Run 的 select 循环里同步调用，主循环的注册/注销/
// 全部广播都会被这一个 RTT 卡住。这里把通知挪到 time.AfterFunc 自带的 goroutine，
// 并按 room 做 200ms 尾部去抖：窗口内多次进出只发一次，触发时重新 CollectViewers，
// 拿到的是最新状态。
func (h *Hub) scheduleViewerNotify(room string) {
	if room == "" || h.viewerNotifier == nil {
		return
	}
	h.debounceMu.Lock()
	defer h.debounceMu.Unlock()
	if t, ok := h.debounceTimers[room]; ok {
		// 窗口内已有待触发通知：重置计时，最终只发一次
		t.Reset(viewerNotifyDebounce)
		return
	}
	h.debounceTimers[room] = time.AfterFunc(viewerNotifyDebounce, func() {
		h.debounceMu.Lock()
		delete(h.debounceTimers, room)
		h.debounceMu.Unlock()
		// AfterFunc 已提供独立 goroutine，这里只需 panic 兜底（复用项目统一的 stack 日志）
		pkg.RunSafe("ws-viewer-notify", func() { h.viewerNotifier(room) })
	})
}

// broadcastLocal 在本实例内广播消息
func (h *Hub) broadcastLocal(channel string, payload []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	var msg Message
	_ = json.Unmarshal(payload, &msg)

	switch channel {
	case ChannelViewers:
		// 推送给该房间所有客户端
		room := msg.Room
		if room == "" && msg.SubmissionID > 0 {
			room = SubmissionRoom(msg.SubmissionID)
		}
		if set, ok := h.clientsByRoom[room]; ok {
			for c := range set {
				safeSend(c.send, payload)
			}
		}
	case ChannelChanged:
		// 审核员与投稿者本人拿完整负载（含 reviewer / reviewerInfo），其余人拿脱敏负载。
		// 列表页连接的准入条件只有「有效 JWT」，不区分角色就等于把审核动态推给全站。
		staffPayload := payload
		if msg.StaffData != nil {
			if merged, err := mergeStaffData(&msg); err == nil {
				staffPayload = merged
			} else {
				logrus.WithError(err).Warn("ws merge staff payload failed, fallback to public payload")
			}
		}
		sendChanged := func(c *Client) {
			if c.canViewInternal {
				safeSend(c.send, staffPayload)
				return
			}
			safeSend(c.send, payload)
		}
		// 推给所有列表页客户端
		for c := range h.listClients {
			sendChanged(c)
		}
		// 同时推给该投稿详情页客户端（房间准入不校验归属，同样按角色分发）
		if msg.SubmissionID > 0 {
			if set, ok := h.clientsByRoom[SubmissionRoom(msg.SubmissionID)]; ok {
				for c := range set {
					sendChanged(c)
				}
			}
		}
	case ChannelNotification:
		// 只推给该用户的站内消息连接（多标签页全收）
		if msg.Username != "" {
			if set, ok := h.clientsByUser[msg.Username]; ok {
				for c := range set {
					safeSend(c.send, payload)
				}
			}
		}
	}
}

// mergeStaffData 把 StaffData 合并进 Data，生成审核员可见的完整负载
func mergeStaffData(msg *Message) ([]byte, error) {
	data, ok := msg.Data.(map[string]any)
	if !ok {
		// 非 map 负载无法合并，原样下发（只有审核员会收到，不含额外泄露）
		return json.Marshal(msg)
	}
	merged := make(map[string]any, len(data)+4)
	for k, v := range data {
		merged[k] = v
	}
	if extra, ok := msg.StaffData.(map[string]any); ok {
		for k, v := range extra {
			merged[k] = v
		}
	}
	out := *msg
	out.Data = merged
	out.StaffData = nil
	return json.Marshal(out)
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
func (h *Hub) PublishViewers(ctx context.Context, room string, submissionID int64, viewers []Viewer) error {
	p := ViewersPayload{Room: room, SubmissionID: submissionID, Viewers: viewers}
	data, err := json.Marshal(Message{
		Type:         TypeViewers,
		Room:         room,
		SubmissionID: submissionID,
		Data:         p,
	})
	if err != nil {
		return err
	}
	return h.rdb.Publish(ctx, ChannelViewers, data).Err()
}

// PublishChanged 发布投稿状态变更到 Redis
//
// data 是所有登录用户可见的脱敏负载，staffData 只下发给审核员连接；
// 分发在 broadcastLocal 里按客户端角色完成。
func (h *Hub) PublishChanged(ctx context.Context, submissionID int64, data, staffData any) error {
	dataBytes, err := json.Marshal(Message{
		Type:         TypeSubmissionChg,
		SubmissionID: submissionID,
		Data:         data,
		StaffData:    staffData,
	})
	if err != nil {
		return err
	}
	return h.rdb.Publish(ctx, ChannelChanged, dataBytes).Err()
}

// PublishNotification 发布站内消息到 Redis（按用户路由，data 为通知 DTO）
func (h *Hub) PublishNotification(ctx context.Context, username string, data any) error {
	if username == "" {
		return nil
	}
	dataBytes, err := json.Marshal(Message{
		Type:     TypeNotification,
		Username: username,
		Data:     data,
	})
	if err != nil {
		return err
	}
	return h.rdb.Publish(ctx, ChannelNotification, dataBytes).Err()
}

// CollectViewers 收集指定投稿当前实例的在线观众
func (h *Hub) CollectViewers(room string) []Viewer {
	h.mu.RLock()
	defer h.mu.RUnlock()
	set, ok := h.clientsByRoom[room]
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

// PublishPluginChanged 发布插件状态变更到插件房间
func (h *Hub) PublishPluginChanged(ctx context.Context, pluginKey string, data any) error {
	if pluginKey == "" {
		return nil
	}
	room := PluginRoom(pluginKey)
	dataBytes, err := json.Marshal(Message{
		Type: TypePluginChg,
		Room: room,
		Data: data,
	})
	if err != nil {
		return err
	}
	return h.rdb.Publish(ctx, ChannelViewers, dataBytes).Err()
}

// PublishRecruitmentChanged 发布审核招募变更到招募房间（只做失效通知，不带业务数据）
func (h *Hub) PublishRecruitmentChanged(ctx context.Context, data any) error {
	dataBytes, err := json.Marshal(Message{
		Type: TypeRecruitmentChg,
		Room: RecruitmentRoom(),
		Data: data,
	})
	if err != nil {
		return err
	}
	return h.rdb.Publish(ctx, ChannelViewers, dataBytes).Err()
}

// SubmissionRoom 投稿房间键
func SubmissionRoom(id int64) string { return "sub:" + strconv.FormatInt(id, 10) }

// RequestRoom 歌词请愿房间键
func RequestRoom(id int64) string { return "req:" + strconv.FormatInt(id, 10) }

// PluginRoom 插件房间键
func PluginRoom(key string) string { return "plugin:" + key }

// RecruitmentRoom 审核招募房间键（所有登录用户共享）
func RecruitmentRoom() string { return "recruitment" }

// NewClient 创建客户端（观众/列表页连接；room 为空表示列表页）
func NewClient(conn *websocket.Conn, hub *Hub, room string, submissionID int64, username, displayName, avatar string, canViewInternal bool, onClose func()) *Client {
	return newClient(conn, hub, ModeViewers, room, submissionID, username, displayName, avatar, canViewInternal, onClose)
}

// NewNotificationClient 创建站内消息客户端（按 username 分组路由）
func NewNotificationClient(conn *websocket.Conn, hub *Hub, username string) *Client {
	return newClient(conn, hub, ModeNotifications, "", 0, username, "", "", false, nil)
}

// NewRecruitmentClient 创建审核招募订阅客户端（所有登录用户加入同一房间）
func NewRecruitmentClient(conn *websocket.Conn, hub *Hub, username string) *Client {
	return newClient(conn, hub, ModeRecruitment, RecruitmentRoom(), 0, username, "", "", false, nil)
}

func newClient(conn *websocket.Conn, hub *Hub, mode, room string, submissionID int64, username, displayName, avatar string, canViewInternal bool, onClose func()) *Client {
	return &Client{
		conn:            conn,
		mode:            mode,
		room:            room,
		submissionID:    submissionID,
		username:        username,
		displayName:     displayName,
		avatar:          avatar,
		canViewInternal: canViewInternal,
		send:            make(chan []byte, 32),
		hub:             hub,
		onClose:         onClose,
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
