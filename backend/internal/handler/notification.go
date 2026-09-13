package handler

import (
	"context"
	"errors"
	"strconv"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// NotificationHandler 站内消息 handler
type NotificationHandler struct {
	svc *service.NotificationService
}

// NewNotificationHandler 创建 handler
func NewNotificationHandler(svc *service.NotificationService) *NotificationHandler {
	return &NotificationHandler{svc: svc}
}

// List GET /api/v1/notifications?page=&limit=&type=
func (h *NotificationHandler) List(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	typ := c.Query("type")

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	res, err := h.svc.List(ctx, user.Name, page, limit, typ)
	if err != nil {
		logrus.WithError(err).Error("list notifications failed")
		pkg.InternalError(c, "查询消息列表失败")
		return
	}
	pkg.OK(c, gin.H{"items": res.Items, "total": res.Total, "unread": res.Unread})
}

// UnreadCount GET /api/v1/notifications/unread-count
func (h *NotificationHandler) UnreadCount(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	unread, err := h.svc.CountUnread(ctx, user.Name)
	if err != nil {
		logrus.WithError(err).Error("count unread notifications failed")
		pkg.InternalError(c, "查询未读数失败")
		return
	}
	pkg.OK(c, gin.H{"unread": unread})
}

// MarkRead POST /api/v1/notifications/:id/read
func (h *NotificationHandler) MarkRead(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		pkg.BadRequest(c, "消息 id 非法")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	if err := h.svc.MarkRead(ctx, user.Name, id); err != nil {
		if errors.Is(err, service.ErrNotificationNotFound) {
			pkg.NotFound(c, "消息不存在")
			return
		}
		logrus.WithError(err).Error("mark notification read failed")
		pkg.InternalError(c, "标记已读失败")
		return
	}
	pkg.OK(c, gin.H{"id": id, "read": true})
}

// MarkAllRead POST /api/v1/notifications/read-all
func (h *NotificationHandler) MarkAllRead(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	updated, err := h.svc.MarkAllRead(ctx, user.Name)
	if err != nil {
		logrus.WithError(err).Error("mark all notifications read failed")
		pkg.InternalError(c, "全部已读失败")
		return
	}
	pkg.OK(c, gin.H{"updated": updated})
}

// Delete DELETE /api/v1/notifications/:id
func (h *NotificationHandler) Delete(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		pkg.BadRequest(c, "消息 id 非法")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	if err := h.svc.Delete(ctx, user.Name, id); err != nil {
		if errors.Is(err, service.ErrNotificationNotFound) {
			pkg.NotFound(c, "消息不存在")
			return
		}
		logrus.WithError(err).Error("delete notification failed")
		pkg.InternalError(c, "删除消息失败")
		return
	}
	pkg.OK(c, gin.H{"id": id})
}
