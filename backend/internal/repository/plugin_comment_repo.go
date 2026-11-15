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

// ListByPlugin 分页返回评论，按时间倒序（新评论在前）。
// 倒序保证发完评论后重新拉第一页一定能看到自己的评论；前端时间线展示时
// 会再按时间升序合并活动事件，所以这里不影响阅读顺序。
func (r *PluginCommentRepo) ListByPlugin(ctx context.Context, pluginKey string, page, size int) ([]model.PluginComment, int64, error) {
	page, size = normalizePage(page, size)
	base := r.db.WithContext(ctx).Model(&model.PluginComment{}).Where("plugin_key = ?", pluginKey)
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []model.PluginComment
	// created_at 可能重复，带上 id 保证翻页顺序稳定
	if err := base.Order("created_at DESC, id DESC").
		Offset((page - 1) * size).Limit(size).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// Insert 插入评论
func (r *PluginCommentRepo) Insert(ctx context.Context, c *model.PluginComment) error {
	return r.db.WithContext(ctx).Create(c).Error
}

// DeleteByPluginKey 删除某个插件的全部评论，需与插件删除放在同一事务
func (r *PluginCommentRepo) DeleteByPluginKey(ctx context.Context, tx *gorm.DB, pluginKey string) error {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	return tx.WithContext(ctx).
		Where("plugin_key = ?", pluginKey).
		Delete(&model.PluginComment{}).Error
}
