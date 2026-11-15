package handler

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/middleware"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/amll-dev/amll-hub/backend/internal/ws"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	logrus "github.com/sirupsen/logrus"
)

// WSHandler WebSocket handler
type WSHandler struct {
	hub            *ws.Hub
	viewers        *service.ViewerService
	rc             *middleware.ReviewerCache
	jwtSecret      string
	allowedOrigins map[string]struct{}
	upgrader       websocket.Upgrader
}

// NewWSHandler 创建 WS handler
func NewWSHandler(hub *ws.Hub, viewers *service.ViewerService, rc *middleware.ReviewerCache, jwtSecret string) *WSHandler {
	h := &WSHandler{
		hub:            hub,
		viewers:        viewers,
		rc:             rc,
		jwtSecret:      jwtSecret,
		allowedOrigins: loadWSAllowedOrigins(),
	}
	h.upgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin:     h.checkOrigin,
	}
	return h
}

// 加载允许的 Origin
func loadWSAllowedOrigins() map[string]struct{} {
	set := make(map[string]struct{})
	if env := os.Getenv("CORS_ALLOWED_ORIGINS"); env != "" {
		for _, o := range strings.Split(env, ",") {
			if o = strings.TrimSpace(o); o != "" {
				set[o] = struct{}{}
			}
		}
	}
	return set
}

// 校验握手
//
// 浏览器发起 WS 握手时必定携带 Origin，空值只可能来自非浏览器客户端
// （脚本、桌面端、服务端直连）。这类客户端本来就能随意伪造 Origin，
// 所以「拒绝空 Origin」不增加安全性，真正的准入控制是握手里的 JWT。
// 但两种部署形态要区别对待：
//   - 未配置 CORS_ALLOWED_ORIGINS：同源部署，浏览器直连本服务，放行；
//   - 已配置 CORS_ALLOWED_ORIGINS：前后端分离部署，正常流量必带 Origin，
//     此时空 Origin 属于预期之外的来源，拒绝（需要时请显式带上 Origin）。
func (h *WSHandler) checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return len(h.allowedOrigins) == 0
	}
	if len(h.allowedOrigins) > 0 {
		_, ok := h.allowedOrigins[origin]
		return ok
	}
	// 未配置白名单：仅允许同源
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return u.Host == r.Host
}

// wsTokenProtocolPrefix 子协议携带令牌的约定写法：["bearer.<jwt>"]
const wsTokenProtocolPrefix = "bearer."

// extractWSToken 从握手请求提取 JWT，同时返回令牌所在的子协议（供回显）。
//
// 不能取「第一个非空子协议」：客户端按 ["bearer", token] 发送时会取到 "bearer"，
// 有效令牌反而 401。约定优先取 bearer.<jwt>，其次接受裸 JWT（前端当前发 [token]），
// 最后回退到 query。
func extractWSToken(r *http.Request) (token, protocol string) {
	subs := websocket.Subprotocols(r)
	for _, p := range subs {
		if v, ok := strings.CutPrefix(p, wsTokenProtocolPrefix); ok && v != "" {
			return v, p
		}
	}
	for _, p := range subs {
		if looksLikeJWT(p) {
			return p, p
		}
	}
	return r.URL.Query().Get("token"), ""
}

// looksLikeJWT 判断三段式 base64url（header.payload.signature）。
// 只用于区分「协议名」和「令牌」，真正的验签在 ParseJWT。
func looksLikeJWT(s string) bool {
	if len(s) < 16 {
		return false
	}
	parts := strings.Split(s, ".")
	if len(parts) != 3 {
		return false
	}
	for _, p := range parts {
		if p == "" {
			return false
		}
	}
	return true
}

// wsUpgradeHeader 回显握手子协议：浏览器要求服务端从请求的子协议里挑一个回显，
// 否则直接判定握手失败。优先回显承载令牌的那个。
func wsUpgradeHeader(r *http.Request, protocol string) http.Header {
	h := http.Header{}
	if protocol != "" {
		h.Set("Sec-WebSocket-Protocol", protocol)
		return h
	}
	if subs := websocket.Subprotocols(r); len(subs) > 0 {
		h.Set("Sec-WebSocket-Protocol", subs[0])
	}
	return h
}

// Viewers GET
func (h *WSHandler) Viewers(c *gin.Context) {
	// 鉴权
	token, tokenProto := extractWSToken(c.Request)
	if token == "" {
		pkg.Unauthorized(c)
		return
	}
	claims, err := pkg.ParseJWT(token, h.jwtSecret)
	if err != nil {
		pkg.Fail(c, http.StatusUnauthorized, http.StatusUnauthorized, "token 无效或已过期")
		return
	}
	username := claims.Name
	if username == "" {
		pkg.Fail(c, http.StatusUnauthorized, http.StatusUnauthorized, "token 中无用户信息")
		return
	}

	// 解析参数
	var submissionID, requestID int64
	var pluginKey string
	isListPage := c.Query("listPage") == "true"
	if !isListPage {
		if idStr := c.Query("requestId"); idStr != "" {
			id, err := strconv.ParseInt(idStr, 10, 64)
			if err != nil || id <= 0 {
				pkg.BadRequest(c, "requestId 非法")
				return
			}
			requestID = id
		} else if key := strings.TrimSpace(c.Query("pluginKey")); key != "" {
			pluginKey = key
		} else {
			idStr := c.Query("submissionId")
			if idStr == "" {
				pkg.BadRequest(c, "submissionId、requestId、pluginKey 或 listPage 必填其一")
				return
			}
			id, err := strconv.ParseInt(idStr, 10, 64)
			if err != nil || id <= 0 {
				pkg.BadRequest(c, "submissionId 非法")
				return
			}
			submissionID = id
		}
	}

	// 房间键
	room := ""
	if submissionID > 0 {
		room = ws.SubmissionRoom(submissionID)
	} else if requestID > 0 {
		room = ws.RequestRoom(requestID)
	} else if pluginKey != "" {
		room = ws.PluginRoom(pluginKey)
	}

	// 升级为ws
	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, wsUpgradeHeader(c.Request, tokenProto))
	if err != nil {
		return
	}

	// 关闭回调
	onClose := func() {}
	if room != "" && h.viewers != nil {
		onClose = func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = h.viewers.NotifyRoom(ctx, room)
		}
	}

	// 谁能收到 reviewer / reviewerInfo 等内部字段：
	//   1. 审核员（列表页、任意投稿详情页）
	//   2. 该投稿的投稿者本人（只看自己的）
	// 其余登录用户照常连接、照常收状态变更，只是拿不到这两个字段。
	canViewInternal := false
	if h.rc != nil {
		rcCtx, rcCancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		ok, err := h.rc.IsReviewer(rcCtx, username)
		rcCancel()
		if err != nil {
			// 查不到名单就按非审核员处理：宁少发内部字段，不多发
			logrus.WithFields(logrus.Fields{"username": username, "error": err}).
				Warn("ws query reviewer list failed, treat as normal user")
		} else {
			canViewInternal = ok
		}
	}
	if !canViewInternal && submissionID > 0 && h.viewers != nil {
		ownerCtx, ownerCancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		canViewInternal = h.viewers.IsSubmissionOwner(ownerCtx, submissionID, username)
		ownerCancel()
	}

	// 创建客户端并注册到 hub
	client := ws.NewClient(conn, h.hub, room, submissionID, username, claims.DisplayName, claims.Avatar, canViewInternal, onClose)
	h.hub.Register(client)

	// 启动读写 goroutine
	go client.ReadPump()
	go client.WritePump()

	// 观众列表广播由 Hub 在 registerClient 内部触发（确保客户端已入 map）
}

// Notifications GET /ws/notifications?token=
// 站内消息推送连接（按用户名分组，多标签页各自建连）
func (h *WSHandler) Notifications(c *gin.Context) {
	// 鉴权
	token, tokenProto := extractWSToken(c.Request)
	if token == "" {
		pkg.Unauthorized(c)
		return
	}
	claims, err := pkg.ParseJWT(token, h.jwtSecret)
	if err != nil {
		pkg.Fail(c, http.StatusUnauthorized, http.StatusUnauthorized, "token 无效或已过期")
		return
	}
	username := claims.Name
	if username == "" {
		pkg.Fail(c, http.StatusUnauthorized, http.StatusUnauthorized, "token 中无用户信息")
		return
	}

	// 升级为 ws
	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, wsUpgradeHeader(c.Request, tokenProto))
	if err != nil {
		return
	}

	// 创建站内消息客户端并注册到 hub
	client := ws.NewNotificationClient(conn, h.hub, username)
	h.hub.Register(client)

	// 启动读写 goroutine
	go client.ReadPump()
	go client.WritePump()
}
