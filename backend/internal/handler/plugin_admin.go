package handler

import (
	"context"
	"strconv"
	"strings"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// PluginAdminHandler 插件管理 handler
type PluginAdminHandler struct {
	svc *service.PluginStoreService
}

func NewPluginAdminHandler(svc *service.PluginStoreService) *PluginAdminHandler {
	return &PluginAdminHandler{svc: svc}
}

type pluginListingInput struct {
	Action string `json:"action"`
	Reason string `json:"reason"`
}

type pluginStatusInput struct {
	Status string `json:"status"`
	Reason string `json:"reason"`
}

type pluginDeleteInput struct {
	Reason string `json:"reason"`
}

// Listing POST /api/v1/store/admin/versions/:id/listing
func (h *PluginAdminHandler) Listing(c *gin.Context) {
	operator := pluginUser(c)
	if operator == nil {
		pkg.Unauthorized(c)
		return
	}
	id, err := parsePositiveID(c.Param("id"))
	if err != nil {
		pkg.BadRequest(c, "无效的 id")
		return
	}
	var in pluginListingInput
	if err := c.ShouldBindJSON(&in); err != nil {
		pkg.BadRequest(c, "参数错误")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	if err := h.svc.AdminListing(ctx, operator, id, in.Action, in.Reason); err != nil {
		writePluginErr(c, err)
		return
	}
	pkg.OK(c, gin.H{"ok": true})
}

// Status POST /api/v1/store/admin/plugins/:id/status
func (h *PluginAdminHandler) Status(c *gin.Context) {
	operator := pluginUser(c)
	if operator == nil {
		pkg.Unauthorized(c)
		return
	}
	id, err := parsePositiveID(c.Param("id"))
	if err != nil {
		pkg.BadRequest(c, "无效的 id")
		return
	}
	var in pluginStatusInput
	if err := c.ShouldBindJSON(&in); err != nil {
		pkg.BadRequest(c, "参数错误")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	if err := h.svc.AdminStatus(ctx, operator, id, in.Status, in.Reason); err != nil {
		writePluginErr(c, err)
		return
	}
	pkg.OK(c, gin.H{"ok": true})
}

// Audit GET /api/v1/store/admin/audit
func (h *PluginAdminHandler) Audit(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	targetID, _ := strconv.ParseInt(c.Query("target_id"), 10, 64)
	q := repository.PluginAuditQuery{
		Page:       page,
		PageSize:   pageSize,
		TargetType: strings.TrimSpace(c.Query("target_type")),
		TargetID:   targetID,
		Operator:   strings.TrimSpace(c.Query("operator")),
		Action:     strings.TrimSpace(c.Query("action")),
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	items, total, err := h.svc.ListAudit(ctx, q)
	if err != nil {
		logrus.WithError(err).Error("list plugin audit failed")
		pkg.InternalError(c, "查询审计记录失败")
		return
	}
	pkg.OK(c, gin.H{"items": items, "total": total, "page": page, "pageSize": pageSize})
}

// Stats GET /api/v1/store/admin/stats
func (h *PluginAdminHandler) Stats(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	stats, err := h.svc.Stats(ctx)
	if err != nil {
		logrus.WithError(err).Error("get plugin admin stats failed")
		pkg.InternalError(c, "查询统计失败")
		return
	}
	pkg.OK(c, stats)
}

// List GET /api/v1/store/admin/plugins
func (h *PluginAdminHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	q := repository.PluginListQuery{
		Page:     page,
		PageSize: pageSize,
		Q:        strings.TrimSpace(c.Query("q")),
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	items, total, err := h.svc.AdminListPlugins(ctx, q)
	if err != nil {
		logrus.WithError(err).Error("list admin plugins failed")
		pkg.InternalError(c, "查询插件列表失败")
		return
	}
	if items == nil {
		items = []model.Plugin{}
	}
	pkg.OK(c, gin.H{"items": items, "total": total, "page": page, "pageSize": pageSize})
}

// Get GET /api/v1/store/admin/plugins/:id
func (h *PluginAdminHandler) Get(c *gin.Context) {
	id, err := parsePositiveID(c.Param("id"))
	if err != nil {
		pkg.BadRequest(c, "无效的 id")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	plugin, versions, err := h.svc.AdminGetPlugin(ctx, id)
	if err != nil {
		writePluginErr(c, err)
		return
	}
	if versions == nil {
		versions = []model.PluginVersion{}
	}
	pkg.OK(c, gin.H{"plugin": plugin, "versions": versions})
}

// DeleteVersion DELETE /api/v1/store/admin/versions/:id
func (h *PluginAdminHandler) DeleteVersion(c *gin.Context) {
	operator := pluginUser(c)
	if operator == nil {
		pkg.Unauthorized(c)
		return
	}
	id, err := parsePositiveID(c.Param("id"))
	if err != nil {
		pkg.BadRequest(c, "无效的 id")
		return
	}
	var in pluginDeleteInput
	_ = c.ShouldBindJSON(&in)
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	if err := h.svc.AdminDeleteVersion(ctx, operator, id, in.Reason); err != nil {
		writePluginErr(c, err)
		return
	}
	pkg.OK(c, gin.H{"ok": true})
}

// DeletePlugin DELETE /api/v1/store/admin/plugins/:id
func (h *PluginAdminHandler) DeletePlugin(c *gin.Context) {
	operator := pluginUser(c)
	if operator == nil {
		pkg.Unauthorized(c)
		return
	}
	id, err := parsePositiveID(c.Param("id"))
	if err != nil {
		pkg.BadRequest(c, "无效的 id")
		return
	}
	var in pluginDeleteInput
	_ = c.ShouldBindJSON(&in)
	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()
	if err := h.svc.AdminDeletePlugin(ctx, operator, id, in.Reason); err != nil {
		writePluginErr(c, err)
		return
	}
	pkg.OK(c, gin.H{"ok": true})
}
