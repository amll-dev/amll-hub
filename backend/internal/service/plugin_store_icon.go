package service

import (
	"context"
	"errors"
	"io"
	"net/url"
	"strings"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/minio/minio-go/v7"
	"gorm.io/gorm"
)

// SetIconByKey 按 plugin_key 写入包内图标
func (s *PluginStoreService) SetIconByKey(ctx context.Context, username, pluginKey string, data []byte) (string, error) {
	plugin, err := s.plugins.GetByKey(ctx, pluginKey)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", ErrPluginNotFound
		}
		return "", err
	}
	return s.setIcon(ctx, username, plugin, data)
}

func (s *PluginStoreService) setIcon(ctx context.Context, username string, plugin *model.Plugin, data []byte) (string, error) {
	if plugin.OwnerUsername != username {
		return "", ErrPluginForbidden
	}
	if int64(len(data)) > s.cfg.PluginStore.MaxIconBytes {
		return "", ErrPluginIconTooLarge
	}
	ext, mime, ok := DetectPluginIcon(data)
	if !ok {
		return "", ErrPluginIconFormat
	}
	key, err := s.files.PutIcon(ctx, plugin.PluginKey, data, ext, mime)
	if err != nil {
		return "", err
	}
	oldKey := plugin.IconKey
	if err := s.plugins.UpdateIcon(ctx, nil, plugin.ID, key); err != nil {
		return "", err
	}
	if oldKey != "" && oldKey != key {
		_ = s.files.DeleteIcon(ctx, oldKey)
	}
	return key, nil
}

// GetIconByKey 按 plugin_key 读取公开图标
func (s *PluginStoreService) GetIconByKey(ctx context.Context, pluginKey string) (io.ReadCloser, minio.ObjectInfo, error) {
	plugin, err := s.plugins.GetByKey(ctx, pluginKey)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, minio.ObjectInfo{}, ErrPluginNotFound
		}
		return nil, minio.ObjectInfo{}, err
	}
	if plugin.IconKey == "" {
		return nil, minio.ObjectInfo{}, ErrPluginIconMissing
	}
	return s.files.GetIcon(ctx, plugin.IconKey)
}

// PluginIconURL 公开图标地址
func PluginIconURL(pluginKey string) string {
	return "/api/v1/store/plugins/" + url.PathEscape(pluginKey) + "/icon"
}

// PluginIconURLVersioned 带图标版本参数的公开地址，避免替换图标后被浏览器缓存
func PluginIconURLVersioned(pluginKey, iconKey string) string {
	base := PluginIconURL(pluginKey)
	if iconKey == "" {
		return base
	}
	token := iconKey
	if i := strings.LastIndex(iconKey, "/"); i >= 0 {
		token = iconKey[i+1:]
	}
	if token == "" {
		return base
	}
	return base + "?v=" + url.QueryEscape(token)
}
