package repository

import (
	"context"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
)

// PluginCommentRepo 插件评论
type PluginCommentRepo struct {
	db *gorm.DB
}

func NewPluginCommentRepo(db *gorm.DB) *PluginCommentRepo {
	return &PluginCommentRepo{db: db}
}

// ListByPlugin 按时间正序返回评论
func (r *PluginCommentRepo) ListByPlugin(ctx context.Context, pluginKey string) ([]model.PluginComment, error) {
	var items []model.PluginComment
	err := r.db.WithContext(ctx).
		Where("plugin_key = ?", pluginKey).
		Order("created_at ASC").
		Find(&items).Error
	return items, err
}

// Insert 插入评论
func (r *PluginCommentRepo) Insert(ctx context.Context, c *model.PluginComment) error {
	return r.db.WithContext(ctx).Create(c).Error
}
