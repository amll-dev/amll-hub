package repository

import (
	"context"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
)

// PluginVersionRepo 插件版本数据访问层
type PluginVersionRepo struct {
	db *gorm.DB
}

func NewPluginVersionRepo(db *gorm.DB) *PluginVersionRepo { return &PluginVersionRepo{db: db} }

// PluginVersionListQuery 我的投稿 / 管理端版本列表查询
type PluginVersionListQuery struct {
	Page      int
	PageSize  int
	Status    string
	Submitter string
}

// PluginReviewQueueQuery 审核队列查询
type PluginReviewQueueQuery struct {
	Page     int
	PageSize int
	Q        string
	Status   string
}

func (r *PluginVersionRepo) Create(ctx context.Context, tx *gorm.DB, v *model.PluginVersion) error {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	return tx.WithContext(ctx).Create(v).Error
}

func (r *PluginVersionRepo) GetByID(ctx context.Context, id int64) (*model.PluginVersion, error) {
	var v model.PluginVersion
	if err := r.db.WithContext(ctx).First(&v, id).Error; err != nil {
		return nil, err
	}
	return &v, nil
}

func (r *PluginVersionRepo) GetByPluginAndVersion(ctx context.Context, pluginID int64, version string) (*model.PluginVersion, error) {
	var v model.PluginVersion
	if err := r.db.WithContext(ctx).
		Where("plugin_id = ? AND version = ?", pluginID, version).
		First(&v).Error; err != nil {
		return nil, err
	}
	return &v, nil
}

func (r *PluginVersionRepo) GetBySHA(ctx context.Context, sha string) (*model.PluginVersion, error) {
	var v model.PluginVersion
	if err := r.db.WithContext(ctx).Where("sha256 = ?", sha).First(&v).Error; err != nil {
		return nil, err
	}
	return &v, nil
}

func (r *PluginVersionRepo) CountBySHA(ctx context.Context, sha string) (int64, error) {
	var n int64
	if err := r.db.WithContext(ctx).Model(&model.PluginVersion{}).
		Where("sha256 = ?", sha).Count(&n).Error; err != nil {
		return 0, err
	}
	return n, nil
}

func (r *PluginVersionRepo) ListByPlugin(ctx context.Context, pluginID int64) ([]model.PluginVersion, error) {
	var items []model.PluginVersion
	if err := r.db.WithContext(ctx).
		Where("plugin_id = ?", pluginID).
		Order("submitted_at DESC, id DESC").
		Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

// PluginVersionSummaryRow 版本摘要查询行（不含 manifest / README）
type PluginVersionSummaryRow struct {
	ID            int64                 `gorm:"column:id"`
	PluginID      int64                 `gorm:"column:plugin_id"`
	Version       string                `gorm:"column:version"`
	Channel       string                `gorm:"column:channel"`
	APIVersion    int                   `gorm:"column:api_version"`
	Platforms     model.JSONStringArray `gorm:"column:platforms"`
	SHA256        string                `gorm:"column:sha256"`
	SizeBytes     int64                 `gorm:"column:size_bytes"`
	ReviewStatus  string                `gorm:"column:review_status"`
	ListingStatus string                `gorm:"column:listing_status"`
	ReviewComment string                `gorm:"column:review_comment"`
	DownloadCount int64                 `gorm:"column:download_count"`
	SubmitterInfo model.UserInfo        `gorm:"column:submitter_info"`
	Reviewer      string                `gorm:"column:reviewer"`
	ReviewerInfo  model.UserInfo        `gorm:"column:reviewer_info"`
	SubmittedAt   time.Time             `gorm:"column:submitted_at"`
	ReviewedAt    *time.Time            `gorm:"column:reviewed_at"`
	ListedAt      *time.Time            `gorm:"column:listed_at"`
}

// ListSummariesByPluginIDs 批量查询发布者管理页所需的版本摘要
func (r *PluginVersionRepo) ListSummariesByPluginIDs(ctx context.Context, pluginIDs []int64) ([]PluginVersionSummaryRow, error) {
	if len(pluginIDs) == 0 {
		return nil, nil
	}
	var rows []PluginVersionSummaryRow
	err := r.db.WithContext(ctx).Model(&model.PluginVersion{}).
		Select(`id, plugin_id, version, channel, api_version, platforms, sha256, size_bytes,
			review_status, listing_status, review_comment, download_count, submitter_info,
			reviewer, reviewer_info, submitted_at, reviewed_at, listed_at`).
		Where("plugin_id IN ?", pluginIDs).
		Order("plugin_id ASC, submitted_at DESC, id DESC").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, nil
}

func (r *PluginVersionRepo) ListListedByPluginIDs(ctx context.Context, pluginIDs []int64) ([]model.PluginVersion, error) {
	if len(pluginIDs) == 0 {
		return nil, nil
	}
	var items []model.PluginVersion
	if err := r.db.WithContext(ctx).
		Where("plugin_id IN ?", pluginIDs).
		Where("review_status = ? AND listing_status = ?", model.PluginReviewApproved, model.PluginListingListed).
		Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PluginVersionRepo) mineBase(ctx context.Context, q PluginVersionListQuery) *gorm.DB {
	db := r.db.WithContext(ctx).Model(&model.PluginVersion{}).Where("submitted_by = ?", q.Submitter)
	if q.Status != "" && q.Status != "all" {
		db = db.Where("review_status = ?", q.Status)
	}
	return db
}

func (r *PluginVersionRepo) ListMine(ctx context.Context, q PluginVersionListQuery) ([]model.PluginVersion, int64, error) {
	page, size := normalizePage(q.Page, q.PageSize)
	base := r.mineBase(ctx, q)
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []model.PluginVersion
	if err := base.Order("submitted_at DESC, id DESC").Offset((page - 1) * size).Limit(size).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *PluginVersionRepo) ListReviewQueue(ctx context.Context, q PluginReviewQueueQuery) ([]model.PluginVersion, int64, error) {
	page, size := normalizePage(q.Page, q.PageSize)
	base := r.db.WithContext(ctx).Model(&model.PluginVersion{}).
		Joins("JOIN plugins p ON p.id = plugin_versions.plugin_id")
	switch q.Status {
	case "", model.PluginReviewPending:
		base = base.Where("plugin_versions.review_status = ?", model.PluginReviewPending)
	case "all":
		// 全部状态
	default:
		base = base.Where("plugin_versions.review_status = ?", q.Status)
	}
	if q.Q != "" {
		like := "%" + q.Q + "%"
		base = base.Where("plugin_versions.version ILIKE ? OR p.plugin_key ILIKE ? OR p.name ILIKE ?", like, like, like)
	}
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []model.PluginVersion
	order := "plugin_versions.submitted_at DESC, plugin_versions.id DESC"
	if q.Status == "" || q.Status == model.PluginReviewPending {
		order = "plugin_versions.submitted_at ASC, plugin_versions.id ASC"
	}
	if err := base.Select("plugin_versions.*").Order(order).
		Offset((page - 1) * size).Limit(size).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// Decide 条件更新审核结论
func (r *PluginVersionRepo) Decide(
	ctx context.Context,
	tx *gorm.DB,
	id int64,
	fromStatuses []string,
	updates map[string]any,
) (bool, error) {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	db := tx.WithContext(ctx).Model(&model.PluginVersion{}).
		Where("id = ? AND review_status IN ?", id, fromStatuses)
	res := db.Updates(updates)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected == 1, nil
}

// UpdateListing 上架 / 下架 / yank
func (r *PluginVersionRepo) UpdateListing(ctx context.Context, tx *gorm.DB, id int64, action string, at time.Time) (bool, error) {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	db := tx.WithContext(ctx).Model(&model.PluginVersion{}).Where("id = ?", id)
	var updates map[string]any
	switch action {
	case "list":
		db = db.Where("review_status = ?", model.PluginReviewApproved)
		updates = map[string]any{
			"listing_status": model.PluginListingListed,
			"listed_at":      at,
			"yanked_at":      nil,
		}
	case "unlist":
		db = db.Where("listing_status = ?", model.PluginListingListed)
		updates = map[string]any{"listing_status": model.PluginListingUnlisted}
	case "yank":
		db = db.Where("listing_status IN ?", []string{model.PluginListingListed, model.PluginListingUnlisted})
		updates = map[string]any{
			"listing_status": model.PluginListingYanked,
			"yanked_at":      at,
		}
	default:
		return false, ErrInvalidPluginListingAction
	}
	res := db.Updates(updates)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected == 1, nil
}

// UpdateMetadata 仅更新允许投稿者修改的展示字段
func (r *PluginVersionRepo) UpdateMetadata(ctx context.Context, id int64, fields map[string]any) error {
	return r.db.WithContext(ctx).Model(&model.PluginVersion{}).
		Where("id = ?", id).Updates(fields).Error
}

func (r *PluginVersionRepo) Delete(ctx context.Context, tx *gorm.DB, id int64) error {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	return tx.WithContext(ctx).Delete(&model.PluginVersion{}, id).Error
}

func (r *PluginVersionRepo) DeleteByPluginID(ctx context.Context, tx *gorm.DB, pluginID int64) error {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	return tx.WithContext(ctx).Where("plugin_id = ?", pluginID).Delete(&model.PluginVersion{}).Error
}

func (r *PluginVersionRepo) IncrementDownload(ctx context.Context, sha string) error {
	return r.db.WithContext(ctx).Model(&model.PluginVersion{}).
		Where("sha256 = ?", sha).
		UpdateColumn("download_count", gorm.Expr("download_count + 1")).Error
}
