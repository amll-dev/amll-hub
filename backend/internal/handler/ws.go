package handler

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/middleware"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/amll-dev/amll-hub/backend/internal/ws"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// 允许所有来源
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// WSHandler WebSocket handler
type WSHandler struct {
	hub     *ws.Hub
	viewers *service.ViewerService
	rc      *middleware.ReviewerCache
}

// NewWSHandler 创建 WS handler
func NewWSHandler(hub *ws.Hub, viewers *service.ViewerService, rc *middleware.ReviewerCache) *WSHandler {
	return &WSHandler{hub: hub, viewers: viewers, rc: rc}
}

// Viewers GET
func (h *WSHandler) Viewers(c *gin.Context) {
	// 鉴权
	token := c.Query("token")
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
	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
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
