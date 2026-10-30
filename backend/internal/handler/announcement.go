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

// AnnouncementHandler 系统公告 handler
type AnnouncementHandler struct {
	svc *service.AnnouncementService
}

// NewAnnouncementHandler 创建 handler
func NewAnnouncementHandler(svc *service.AnnouncementService) *AnnouncementHandler {
	return &AnnouncementHandler{svc: svc}
}

// Audience GET /api/v1/manage/announcements/audience
// 预计收件人数及邮件通道是否可用
func (h *AnnouncementHandler) Audience(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	count, err := h.svc.AudienceCount(ctx)
	if err != nil {
		logrus.WithError(err).Error("count announcement audience failed")
		pkg.InternalError(c, "统计收件人数失败")
		return
	}
	pkg.OK(c, gin.H{"count": count, "mailAvailable": h.svc.MailAvailable()})
}

// List GET /api/v1/manage/announcements?page=&limit=
func (h *AnnouncementHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	items, total, err := h.svc.List(ctx, page, limit)
	if err != nil {
		logrus.WithError(err).Error("list announcements failed")
		pkg.InternalError(c, "查询公告历史失败")
		return
	}
	pkg.OK(c, gin.H{"items": items, "total": total})
}

// Publish POST /api/v1/manage/announcements
// 发布公告
func (h *AnnouncementHandler) Publish(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}

	var req struct {
		Title       string `json:"title" binding:"required"`
		Content     string `json:"content" binding:"required"`
		ActionPath  string `json:"actionPath"`
		ActionLabel string `json:"actionLabel"`
		SendMail    bool   `json:"sendMail"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "title 与 content 必填")
		return
	}

	// 群发站内信与建记录都在这里，给足超时
	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	a, err := h.svc.Publish(ctx, service.PublishAnnouncementInput{
		Title:       req.Title,
		Content:     req.Content,
		ActionPath:  req.ActionPath,
		ActionLabel: req.ActionLabel,
		SendMail:    req.SendMail,
		Sender:      user.Name,
	})
	if err != nil {
		// 字段校验类错误由 service 以 InvalidAnnouncementError 返回，消息可直接展示
		var invalid *service.InvalidAnnouncementError
		if errors.As(err, &invalid) {
			pkg.BadRequest(c, invalid.Msg)
			return
		}
		logrus.WithError(err).Error("publish announcement failed")
		pkg.InternalError(c, "公告发布失败")
		return
	}
	pkg.OK(c, a)
}

// Status GET /api/v1/manage/announcements/:id
func (h *AnnouncementHandler) Status(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		pkg.BadRequest(c, "公告 id 非法")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	a, err := h.svc.Get(ctx, id)
	if err != nil {
		if errors.Is(err, service.ErrAnnouncementNotFound) {
			pkg.NotFound(c, "公告不存在")
			return
		}
		logrus.WithError(err).Error("get announcement failed")
		pkg.InternalError(c, "查询公告失败")
		return
	}
	pkg.OK(c, a)
}
