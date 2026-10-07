package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/amll-dev/amll-hub/backend/internal/middleware"
	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// MigrationHandler 投稿数据迁移 handler
type MigrationHandler struct {
	svc *service.MigrationService
}

// NewMigrationHandler 创建 MigrationHandler
func NewMigrationHandler(svc *service.MigrationService) *MigrationHandler {
	return &MigrationHandler{svc: svc}
}

// Status GET /api/v1/migration/github/status
func (h *MigrationHandler) Status(c *gin.Context) {
	username := middleware.GetUserName(c)
	if username == "" {
		pkg.Unauthorized(c)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	st, err := h.svc.Status(ctx, username)
	if err != nil {
		writeMigrationErr(c, err)
		return
	}
	pkg.OK(c, st)
}

// Start POST /api/v1/migration/github/start
func (h *MigrationHandler) Start(c *gin.Context) {
	username := middleware.GetUserName(c)
	if username == "" {
		pkg.Unauthorized(c)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	task, err := h.svc.Start(ctx, username, submitterInfoFromContext(c, username))
	if err != nil {
		writeMigrationErr(c, err)
		return
	}
	pkg.OK(c, task)
}

// GetTask GET /api/v1/migration/github/tasks/:id
func (h *MigrationHandler) GetTask(c *gin.Context) {
	username := middleware.GetUserName(c)
	if username == "" {
		pkg.Unauthorized(c)
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		pkg.BadRequest(c, "任务 ID 非法")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	task, err := h.svc.GetTask(ctx, username, id)
	if err != nil {
		writeMigrationErr(c, err)
		return
	}
	pkg.OK(c, task)
}

// Retry POST /api/v1/migration/github/tasks/:id/retry
func (h *MigrationHandler) Retry(c *gin.Context) {
	username := middleware.GetUserName(c)
	if username == "" {
		pkg.Unauthorized(c)
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		pkg.BadRequest(c, "任务 ID 非法")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	task, err := h.svc.Retry(ctx, username, id, submitterInfoFromContext(c, username))
	if err != nil {
		writeMigrationErr(c, err)
		return
	}
	pkg.OK(c, task)
}

// ListMigrated GET /api/v1/migration/github/migrated
// 返回该用户已迁移的 PR 列表（含 PR 标题）与总数
func (h *MigrationHandler) ListMigrated(c *gin.Context) {
	username := middleware.GetUserName(c)
	if username == "" {
		pkg.Unauthorized(c)
		return
	}

	limit := 100
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	res, err := h.svc.ListMigrated(ctx, username, limit)
	if err != nil {
		writeMigrationErr(c, err)
		return
	}
	pkg.OK(c, res)
}

// submitterInfoFromContext 从 JWT 注入的 context 构造投稿者信息
func submitterInfoFromContext(c *gin.Context, username string) model.UserInfo {
	return model.UserInfo{
		Username:    username,
		DisplayName: middleware.GetUserDisplayName(c),
		Avatar:      middleware.GetUserAvatar(c),
	}
}

// writeMigrationErr 统一处理迁移模块错误
func writeMigrationErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrNotBound):
		pkg.Fail(c, http.StatusForbidden, http.StatusForbidden, "请先绑定 GitHub 账号")
	case errors.Is(err, service.ErrMigrationInProgress):
		pkg.Fail(c, http.StatusConflict, http.StatusConflict, "已有进行中的迁移任务，请等待完成")
	case errors.Is(err, service.ErrMigrationTaskNotFound):
		pkg.NotFound(c, "迁移任务不存在")
	case errors.Is(err, service.ErrUpstreamUnavailable):
		writeUpstreamErr(c, err, "迁移服务暂不可用，请稍后再试")
	default:
		logrus.WithError(err).Warn("migration service unknown error")
		pkg.InternalError(c, "内部错误")
	}
}
