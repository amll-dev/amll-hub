package service

import (
	"context"
	"errors"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"
)

// AdminListing 上架 / 下架 / yank
func (s *PluginStoreService) AdminListing(ctx context.Context, operator *PluginUser, versionID int64, action, reason string) error {
	switch action {
	case "list", "unlist", "yank":
	default:
		return ErrPluginInvalidStatus
	}
	ok, err := s.versions.UpdateListing(ctx, nil, versionID, action, time.Now())
	if err != nil {
		return err
	}
	if !ok {
		return ErrPluginInvalidStatus
	}
	s.writeAudit(ctx, operator, "version."+action, "version", versionID, reason)
	s.catalog.Invalidate(ctx)
	return nil
}

// AdminStatus 插件状态 active/hidden/blocked
func (s *PluginStoreService) AdminStatus(ctx context.Context, operator *PluginUser, pluginID int64, status, reason string) error {
	switch status {
	case model.PluginStatusActive, model.PluginStatusHidden, model.PluginStatusBlocked:
	default:
		return ErrPluginInvalidStatus
	}
	if _, err := s.plugins.GetByID(ctx, pluginID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPluginNotFound
		}
		return err
	}
	if err := s.plugins.UpdateStatus(ctx, nil, pluginID, status); err != nil {
		return err
	}
	s.writeAudit(ctx, operator, "plugin."+status, "plugin", pluginID, reason)
	s.catalog.Invalidate(ctx)
	return nil
}

// AdminDeleteVersion 硬删除版本并清理 artifact
func (s *PluginStoreService) AdminDeleteVersion(ctx context.Context, operator *PluginUser, versionID int64, reason string) error {
	v, err := s.versions.GetByID(ctx, versionID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPluginVersionNotFound
		}
		return err
	}
	if err := s.versions.Delete(ctx, nil, versionID); err != nil {
		return err
	}
	remaining, err := s.versions.CountBySHA(ctx, v.SHA256)
	if err != nil {
		return err
	}
	if remaining == 0 {
		if err := s.files.DeleteArtifact(ctx, v.SHA256); err != nil {
			logrus.WithError(err).Warn("delete plugin artifact failed")
		}
	}
	s.writeAudit(ctx, operator, "version.delete", "version", versionID, reason)
	s.catalog.Invalidate(ctx)
	return nil
}

// AdminDeletePlugin 硬删除插件及其全部版本
func (s *PluginStoreService) AdminDeletePlugin(ctx context.Context, operator *PluginUser, pluginID int64, reason string) error {
	plugin, err := s.plugins.GetByID(ctx, pluginID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPluginNotFound
		}
		return err
	}
	versions, err := s.versions.ListByPlugin(ctx, pluginID)
	if err != nil {
		return err
	}
	shas := make([]string, 0, len(versions))
	for _, v := range versions {
		shas = append(shas, v.SHA256)
	}
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.versions.DeleteByPluginID(ctx, tx, pluginID); err != nil {
			return err
		}
		return s.plugins.Delete(ctx, tx, pluginID)
	}); err != nil {
		return err
	}
	for _, sha := range shas {
		if remaining, err := s.versions.CountBySHA(ctx, sha); err == nil && remaining == 0 {
			if err := s.files.DeleteArtifact(ctx, sha); err != nil {
				logrus.WithError(err).Warn("delete plugin artifact failed")
			}
		}
	}
	if plugin.IconKey != "" {
		_ = s.files.DeleteIcon(ctx, plugin.IconKey)
	}
	s.writeAudit(ctx, operator, "plugin.delete", "plugin", pluginID, reason)
	s.catalog.Invalidate(ctx)
	return nil
}

// AdminListPlugins 管理端插件列表
func (s *PluginStoreService) AdminListPlugins(ctx context.Context, q repository.PluginListQuery) ([]model.Plugin, int64, error) {
	res, err := s.plugins.ListAdmin(ctx, q)
	if err != nil {
		return nil, 0, err
	}
	return res.Items, res.Total, nil
}

// AdminGetPlugin 管理端插件详情
func (s *PluginStoreService) AdminGetPlugin(ctx context.Context, pluginID int64) (*model.Plugin, []model.PluginVersion, error) {
	plugin, err := s.plugins.GetByID(ctx, pluginID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrPluginNotFound
		}
		return nil, nil, err
	}
	versions, err := s.versions.ListByPlugin(ctx, pluginID)
	if err != nil {
		return nil, nil, err
	}
	return plugin, versions, nil
}

func (s *PluginStoreService) writeAudit(ctx context.Context, operator *PluginUser, action, targetType string, targetID int64, reason string) {
	if err := s.audits.Insert(ctx, nil, &model.PluginAuditLog{
		Operator:     operator.Name,
		OperatorInfo: operator.Info(),
		Action:       action,
		TargetType:   targetType,
		TargetID:     targetID,
		Reason:       truncateRunes(reason, 2000),
	}); err != nil {
		logrus.WithError(err).Warn("write plugin audit log failed")
	}
}

// ListAudit 管理端审计
func (s *PluginStoreService) ListAudit(ctx context.Context, q repository.PluginAuditQuery) ([]model.PluginAuditLog, int64, error) {
	return s.audits.List(ctx, q)
}
