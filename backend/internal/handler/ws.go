package handler

import (
	"context"
	"net/http"
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
	allowedOrigins map[string]struct{}
	upgrader       websocket.Upgrader
}

// NewWSHandler 创建 WS handler
func NewWSHandler(hub *ws.Hub, viewers *service.ViewerService, rc *middleware.ReviewerCache) *WSHandler {
	h := &WSHandler{
		hub:            hub,
		viewers:        viewers,
		rc:             rc,
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
	if len(h.allowedOrigins) == 0 {
		return true
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	_, ok := h.allowedOrigins[origin]
	return ok
}

// 从握手请求提取JWT
func extractWSToken(r *http.Request) string {
	for _, p := range websocket.Subprotocols(r) {
		if strings.HasPrefix(p, "bearer,") {
			return strings.TrimPrefix(p, "bearer,")
		}
	}
	return r.URL.Query().Get("token")
}

// Viewers GET
func (h *WSHandler) Viewers(c *gin.Context) {
	// 鉴权
	token := extractWSToken(c.Request)
	jwtSecret := c.GetString("jwt_secret")
	if token == "" || jwtSecret == "" {
		pkg.Fail(c, 401, 401, "未登录")
		return
	}
	claims, err := pkg.ParseJWT(token, jwtSecret)
	if err != nil {
		pkg.Fail(c, 401, 401, "token 无效或已过期")
		return
	}
	username := claims.Name
	if username == "" {
		pkg.Fail(c, 401, 401, "token 中无用户信息")
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
	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
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
	client := ws.NewClient(conn, h.hub, submissionID, username, onClose)
	h.hub.Register(client)

	// 启动读写 goroutine
	go client.ReadPump()
	go client.WritePump()

	// 通知当前观众列表更新
	if submissionID > 0 && h.viewers != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = h.viewers.NotifyViewers(ctx, submissionID)
	}
}
