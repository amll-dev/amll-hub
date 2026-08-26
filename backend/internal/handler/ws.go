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
func (h *WSHandler) checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		// 非浏览器客户端
		return true
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

// 从握手请求提取JWT
func extractWSToken(r *http.Request) string {
	for _, p := range websocket.Subprotocols(r) {
		if p != "" {
			return p
		}
	}
	return r.URL.Query().Get("token")
}

// Viewers GET
func (h *WSHandler) Viewers(c *gin.Context) {
	// 鉴权
	token := extractWSToken(c.Request)
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
	var submissionID int64
	isListPage := c.Query("listPage") == "true"
	if !isListPage {
		idStr := c.Query("submissionId")
		if idStr == "" {
			pkg.BadRequest(c, "submissionId 或 listPage 必填其一")
			return
		}
		id, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil || id <= 0 {
			pkg.BadRequest(c, "submissionId 非法")
			return
		}
		submissionID = id
	}

	// 升级为ws
	respHeader := http.Header{}
	if subs := websocket.Subprotocols(c.Request); len(subs) > 0 {
		respHeader.Set("Sec-WebSocket-Protocol", subs[0])
	}
	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, respHeader)
	if err != nil {
		return
	}

	// 关闭回调
	onClose := func() {}
	if submissionID > 0 && h.viewers != nil {
		onClose = func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = h.viewers.NotifyViewers(ctx, submissionID)
		}
	}

	// 创建客户端并注册到 hub
	client := ws.NewClient(conn, h.hub, submissionID, username, claims.DisplayName, claims.Avatar, onClose)
	h.hub.Register(client)

	// 启动读写 goroutine
	go client.ReadPump()
	go client.WritePump()

	// 观众列表广播由 Hub 在 registerClient 内部触发（确保客户端已入 map）
}
