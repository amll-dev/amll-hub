package repository

import (
	"context"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
)

// SearchIPRepo 搜索IP投稿数据访问层
type SearchIPRepo struct {
	db *gorm.DB
}

// NewSearchIPRepo 创建 SearchIPRepo
func NewSearchIPRepo(db *gorm.DB) *SearchIPRepo {
	return &SearchIPRepo{db: db}
}

// Create 创建投稿
func (r *SearchIPRepo) Create(ctx context.Context, sub *model.SearchIPSubmission) error {
	return r.db.WithContext(ctx).Create(sub).Error
}

// ListApproved 查询所有已生效的投稿
func (r *SearchIPRepo) ListApproved(ctx context.Context) ([]model.SearchIPSubmission, error) {
	var subs []model.SearchIPSubmission
	err := r.db.WithContext(ctx).Where("status = ?", "approved").Find(&subs).Error
	return subs, err
}

// ListBySubmitter 按提交人分页查询投稿列表，同时返回总数
func (r *SearchIPRepo) ListBySubmitter(ctx context.Context, submitter string, page, size int) ([]model.SearchIPSubmission, int64, error) {
	page, size = normalizePage(page, size)
	base := r.db.WithContext(ctx).Model(&model.SearchIPSubmission{}).Where("submitter = ?", submitter)
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var subs []model.SearchIPSubmission
	err := base.Order("created_at DESC").
		Offset((page - 1) * size).
		Limit(size).
		Find(&subs).Error
	return subs, total, err
}

// ListAll 分页查询全部投稿（审核中心用），status 为空或 all 时不过滤
func (r *SearchIPRepo) ListAll(ctx context.Context, status string, page, size int) ([]model.SearchIPSubmission, int64, error) {
	page, size = normalizePage(page, size)
	base := r.db.WithContext(ctx).Model(&model.SearchIPSubmission{})
	if status != "" && status != "all" {
		base = base.Where("status = ?", status)
	}
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var subs []model.SearchIPSubmission
	err := base.Order("created_at DESC").
		Offset((page - 1) * size).
		Limit(size).
		Find(&subs).Error
	return subs, total, err
}

// UpdateStatusWhere 条件更新状态（仅当当前状态在 fromStatuses 中时生效），返回是否更新成功
func (r *SearchIPRepo) UpdateStatusWhere(ctx context.Context, id int64, status string, fromStatuses []string) (bool, error) {
	res := r.db.WithContext(ctx).
		Model(&model.SearchIPSubmission{}).
		Where("id = ? AND status IN ?", id, fromStatuses).
		Update("status", status)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// GetByID 按 ID 查询投稿详情
func (r *SearchIPRepo) GetByID(ctx context.Context, id int64) (*model.SearchIPSubmission, error) {
	var sub model.SearchIPSubmission
	err := r.db.WithContext(ctx).First(&sub, id).Error
	return &sub, err
}
