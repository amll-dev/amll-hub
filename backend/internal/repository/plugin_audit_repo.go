package repository

import (
	"context"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
)

// PluginAuditRepo 插件管理审计数据访问层
type PluginAuditRepo struct {
	db *gorm.DB
}

func NewPluginAuditRepo(db *gorm.DB) *PluginAuditRepo { return &PluginAuditRepo{db: db} }

// PluginAuditQuery 审计列表查询
type PluginAuditQuery struct {
	Page       int
	PageSize   int
	TargetType string
	TargetID   int64
	Operator   string
	Action     string
}

func (r *PluginAuditRepo) Insert(ctx context.Context, tx *gorm.DB, log *model.PluginAuditLog) error {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	return tx.WithContext(ctx).Create(log).Error
}

func (r *PluginAuditRepo) List(ctx context.Context, q PluginAuditQuery) ([]model.PluginAuditLog, int64, error) {
	page, size := normalizePage(q.Page, q.PageSize)
	db := r.db.WithContext(ctx).Model(&model.PluginAuditLog{})
	if q.TargetType != "" {
		db = db.Where("target_type = ?", q.TargetType)
	}
	if q.TargetID > 0 {
		db = db.Where("target_id = ?", q.TargetID)
	}
	if q.Operator != "" {
		db = db.Where("operator = ?", q.Operator)
	}
	if q.Action != "" {
		db = db.Where("action = ?", q.Action)
	}
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []model.PluginAuditLog
	if err := db.Order("created_at DESC, id DESC").Offset((page - 1) * size).Limit(size).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}
