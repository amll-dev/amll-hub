package handler

import (
	"context"
	"strconv"
	"strings"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// PluginReviewHandler 插件审核 handler
type PluginReviewHandler struct {
	svc *service.PluginReviewService
}

func NewPluginReviewHandler(svc *service.PluginReviewService) *PluginReviewHandler {
	return &PluginReviewHandler{svc: svc}
}

// Queue GET /api/v1/store/review/queue
func (h *PluginReviewHandler) Queue(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	q := repository.PluginReviewQueueQuery{
		Page:     page,
		PageSize: pageSize,
		Q:        strings.TrimSpace(c.Query("q")),
		Status:   strings.TrimSpace(c.Query("status")),
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	items, total, err := h.svc.Queue(ctx, q)
	if err != nil {
		logrus.WithError(err).Error("query plugin review queue failed")
		pkg.InternalError(c, "查询审核队列失败")
		return
	}
	if items == nil {
		items = []service.PluginReviewQueueItem{}
	}
	pkg.OK(c, gin.H{"items": items, "total": total, "page": page, "pageSize": pageSize})
}

// Get GET /api/v1/store/review/:id
func (h *PluginReviewHandler) Get(c *gin.Context) {
	id, err := parsePositiveID(c.Param("id"))
	if err != nil {
		pkg.BadRequest(c, "无效的 id")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	detail, err := h.svc.Get(ctx, id)
	if err != nil {
		writePluginErr(c, err)
		return
	}
	pkg.OK(c, detail)
}

type pluginDecisionInput struct {
	Action  string `json:"action"`
	Comment string `json:"comment"`
}

// Decision POST /api/v1/store/review/:id/decision
func (h *PluginReviewHandler) Decision(c *gin.Context) {
	user := pluginUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	id, err := parsePositiveID(c.Param("id"))
	if err != nil {
		pkg.BadRequest(c, "无效的 id")
		return
	}
	var in pluginDecisionInput
	if err := c.ShouldBindJSON(&in); err != nil {
		pkg.BadRequest(c, "参数错误")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()
	if err := h.svc.Decide(ctx, user, id, in.Action, in.Comment); err != nil {
		writePluginErr(c, err)
		return
	}
	pkg.OK(c, gin.H{"ok": true})
}
