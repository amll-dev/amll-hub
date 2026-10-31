package repository

import (
	"context"
	"errors"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
)

// 公告历史分页边界
const (
	announcementDefaultLimit = 20
	announcementMaxLimit     = 100
)

// AnnouncementRepo 公告数据访问
type AnnouncementRepo struct {
	db *gorm.DB
}

// NewAnnouncementRepo 创建 AnnouncementRepo
func NewAnnouncementRepo(db *gorm.DB) *AnnouncementRepo {
	return &AnnouncementRepo{db: db}
}

// Create 写入一条公告记录（回填 ID 与 CreatedAt）
func (r *AnnouncementRepo) Create(ctx context.Context, a *model.Announcement) error {
	if a == nil {
		return errors.New("announcement is nil")
	}
	return r.db.WithContext(ctx).Create(a).Error
}

// GetByID 查询单条公告，未找到返回 (nil, nil)
func (r *AnnouncementRepo) GetByID(ctx context.Context, id int64) (*model.Announcement, error) {
	var a model.Announcement
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&a).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// List 分页查询公告历史（按创建时间倒序）
func (r *AnnouncementRepo) List(ctx context.Context, page, limit int) ([]model.Announcement, int64, error) {
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = announcementDefaultLimit
	}
	if limit > announcementMaxLimit {
		limit = announcementMaxLimit
	}

	base := r.db.WithContext(ctx).Model(&model.Announcement{})
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.Announcement{}, 0, nil
	}

	var items []model.Announcement
	if err := base.Order("created_at DESC, id DESC").
		Offset((page - 1) * limit).Limit(limit).
		Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// UpdateMailProgress 更新邮件发送进度；finish 为 true 时同时记录完成时间
func (r *AnnouncementRepo) UpdateMailProgress(
	ctx context.Context, id int64, sent, failed, skipped int, status string, finish bool,
) error {
	updates := map[string]any{
		"mail_sent":    sent,
		"mail_failed":  failed,
		"mail_skipped": skipped,
		"mail_status":  status,
	}
	if finish {
		updates["mail_finished_at"] = time.Now()
	}
	return r.db.WithContext(ctx).Model(&model.Announcement{}).
		Where("id = ?", id).Updates(updates).Error
}
