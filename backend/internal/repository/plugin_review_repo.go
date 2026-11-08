package repository

import (
	"context"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
)

// PluginReviewRepo 插件审核历史数据访问层
type PluginReviewRepo struct {
	db *gorm.DB
}

func NewPluginReviewRepo(db *gorm.DB) *PluginReviewRepo { return &PluginReviewRepo{db: db} }

func (r *PluginReviewRepo) Insert(ctx context.Context, tx *gorm.DB, h *model.PluginReviewHistory) error {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	return tx.WithContext(ctx).Create(h).Error
}

func (r *PluginReviewRepo) ListByVersion(ctx context.Context, versionID int64) ([]model.PluginReviewHistory, error) {
	var items []model.PluginReviewHistory
	if err := r.db.WithContext(ctx).
		Where("version_id = ?", versionID).
		Order("reviewed_at DESC, id DESC").
		Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}
