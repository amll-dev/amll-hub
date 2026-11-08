package repository

import (
	"context"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
)

// PluginRepo 插件主表数据访问层
type PluginRepo struct {
	db *gorm.DB
}

func NewPluginRepo(db *gorm.DB) *PluginRepo { return &PluginRepo{db: db} }

// PluginListQuery 插件列表查询
type PluginListQuery struct {
	Page     int
	PageSize int
	Q        string
	Channel  string
	Sort     string
}

// PluginListResult 插件列表结果
type PluginListResult struct {
	Items []model.Plugin
	Total int64
}

// PluginStoreStats 商店统计
type PluginStoreStats struct {
	Plugins   int64 `json:"plugins"`
	Versions  int64 `json:"versions"`
	Downloads int64 `json:"downloads"`
	Pending   int64 `json:"pending"`
	Yanked    int64 `json:"yanked"`
	Unlisted  int64 `json:"unlisted"`
	Listed    int64 `json:"listed"`
	Blocked   int64 `json:"blocked"`
	Hidden    int64 `json:"hidden"`
}

// PluginCatalogRow 目录查询行（plugin + version）
type PluginCatalogRow struct {
	PluginID      int64                 `gorm:"column:plugin_id"`
	PluginKey     string                `gorm:"column:plugin_key"`
	Name          string                `gorm:"column:name"`
	Summary       string                `gorm:"column:summary"`
	Author        string                `gorm:"column:author"`
	Homepage      string                `gorm:"column:homepage"`
	PluginStatus  string                `gorm:"column:plugin_status"`
	Version       string                `gorm:"column:version"`
	Channel       string                `gorm:"column:channel"`
	APIVersion    int                   `gorm:"column:api_version"`
	MinAppVersion string                `gorm:"column:min_app_version"`
	Platforms     model.JSONStringArray `gorm:"column:platforms"`
	SHA256        string                `gorm:"column:sha256"`
	SizeBytes     int64                 `gorm:"column:size_bytes"`
	DownloadCount int64                 `gorm:"column:download_count"`
	ListedAt      *time.Time            `gorm:"column:listed_at"`
	SubmittedAt   time.Time             `gorm:"column:submitted_at"`
}

func (r *PluginRepo) Create(ctx context.Context, tx *gorm.DB, p *model.Plugin) error {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	return tx.WithContext(ctx).Create(p).Error
}

func (r *PluginRepo) GetByID(ctx context.Context, id int64) (*model.Plugin, error) {
	var p model.Plugin
	if err := r.db.WithContext(ctx).First(&p, id).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *PluginRepo) GetByKey(ctx context.Context, key string) (*model.Plugin, error) {
	var p model.Plugin
	if err := r.db.WithContext(ctx).Where("plugin_key = ?", key).First(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *PluginRepo) GetByIDs(ctx context.Context, ids []int64) ([]model.Plugin, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var items []model.Plugin
	if err := r.db.WithContext(ctx).Where("id IN ?", ids).Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PluginRepo) UpdateFields(ctx context.Context, tx *gorm.DB, id int64, fields map[string]any) error {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	return tx.WithContext(ctx).Model(&model.Plugin{}).Where("id = ?", id).Updates(fields).Error
}

func (r *PluginRepo) UpdateStatus(ctx context.Context, tx *gorm.DB, id int64, status string) error {
	return r.UpdateFields(ctx, tx, id, map[string]any{"status": status})
}

func (r *PluginRepo) UpdateIcon(ctx context.Context, tx *gorm.DB, id int64, key string) error {
	return r.UpdateFields(ctx, tx, id, map[string]any{"icon_key": key})
}

func (r *PluginRepo) Delete(ctx context.Context, tx *gorm.DB, id int64) error {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	return tx.WithContext(ctx).Delete(&model.Plugin{}, id).Error
}

func (r *PluginRepo) publicBase(ctx context.Context, q PluginListQuery) *gorm.DB {
	db := r.db.WithContext(ctx).Model(&model.Plugin{}).
		Where("plugins.status = ?", model.PluginStatusActive).
		Where(`EXISTS (
			SELECT 1 FROM plugin_versions v
			WHERE v.plugin_id = plugins.id
			  AND v.review_status = ? AND v.listing_status = ?
		)`, model.PluginReviewApproved, model.PluginListingListed)
	if q.Channel != "" {
		db = db.Where(`EXISTS (
			SELECT 1 FROM plugin_versions v
			WHERE v.plugin_id = plugins.id
			  AND v.review_status = ? AND v.listing_status = ? AND v.channel = ?
		)`, model.PluginReviewApproved, model.PluginListingListed, q.Channel)
	}
	if q.Q != "" {
		like := "%" + q.Q + "%"
		db = db.Where("plugins.name ILIKE ? OR plugins.summary ILIKE ? OR plugins.author ILIKE ?", like, like, like)
	}
	return db
}

// ListPublic 公开商店列表：只包含至少一个 approved+listed 版本的 active 插件
func (r *PluginRepo) ListPublic(ctx context.Context, q PluginListQuery) (*PluginListResult, error) {
	page, size := normalizePage(q.Page, q.PageSize)
	base := r.publicBase(ctx, q)

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, err
	}
	if total == 0 {
		return &PluginListResult{Items: nil, Total: 0}, nil
	}

	order := "plugins.updated_at DESC, plugins.id DESC"
	switch q.Sort {
	case "name":
		order = "plugins.name ASC, plugins.id ASC"
	case "downloads":
		// 累计所有历史版本的下载次数，升级新版本后不清零
		order = `COALESCE((
			SELECT SUM(v2.download_count) FROM plugin_versions v2
			WHERE v2.plugin_id = plugins.id
		), 0) DESC, plugins.id DESC`
	}

	var items []model.Plugin
	if err := base.Omit("DescriptionMD").Order(order).Offset((page - 1) * size).Limit(size).Find(&items).Error; err != nil {
		return nil, err
	}
	return &PluginListResult{Items: items, Total: total}, nil
}

// ListAdmin 管理端插件列表：包含所有状态
func (r *PluginRepo) ListAdmin(ctx context.Context, q PluginListQuery) (*PluginListResult, error) {
	page, size := normalizePage(q.Page, q.PageSize)
	base := r.db.WithContext(ctx).Model(&model.Plugin{})
	if q.Q != "" {
		like := "%" + q.Q + "%"
		base = base.Where("plugin_key ILIKE ? OR name ILIKE ? OR author ILIKE ?", like, like, like)
	}
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, err
	}
	var items []model.Plugin
	if err := base.Omit("DescriptionMD").Order("updated_at DESC, id DESC").Offset((page - 1) * size).Limit(size).Find(&items).Error; err != nil {
		return nil, err
	}
	return &PluginListResult{Items: items, Total: total}, nil
}

// ListByOwner 发布者自己的插件列表
func (r *PluginRepo) ListByOwner(ctx context.Context, owner string, q PluginListQuery) (*PluginListResult, error) {
	page, size := normalizePage(q.Page, q.PageSize)
	base := r.db.WithContext(ctx).Model(&model.Plugin{}).Where("owner_username = ?", owner)
	if q.Q != "" {
		like := "%" + q.Q + "%"
		base = base.Where("plugin_key ILIKE ? OR name ILIKE ? OR summary ILIKE ?", like, like, like)
	}
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, err
	}
	var items []model.Plugin
	if err := base.Order("updated_at DESC, id DESC").Offset((page - 1) * size).Limit(size).Find(&items).Error; err != nil {
		return nil, err
	}
	return &PluginListResult{Items: items, Total: total}, nil
}

// Stats 商店统计
func (r *PluginRepo) Stats(ctx context.Context) (*PluginStoreStats, error) {
	out := &PluginStoreStats{}
	if err := r.db.WithContext(ctx).Model(&model.Plugin{}).Count(&out.Plugins).Error; err != nil {
		return nil, err
	}
	if err := r.db.WithContext(ctx).Model(&model.Plugin{}).
		Where("status = ?", model.PluginStatusBlocked).Count(&out.Blocked).Error; err != nil {
		return nil, err
	}
	if err := r.db.WithContext(ctx).Model(&model.Plugin{}).
		Where("status = ?", model.PluginStatusHidden).Count(&out.Hidden).Error; err != nil {
		return nil, err
	}
	if err := r.db.WithContext(ctx).Model(&model.PluginVersion{}).Count(&out.Versions).Error; err != nil {
		return nil, err
	}
	if err := r.db.WithContext(ctx).Model(&model.PluginVersion{}).
		Where("review_status = ?", model.PluginReviewPending).Count(&out.Pending).Error; err != nil {
		return nil, err
	}
	if err := r.db.WithContext(ctx).Model(&model.PluginVersion{}).
		Where("listing_status = ?", model.PluginListingListed).Count(&out.Listed).Error; err != nil {
		return nil, err
	}
	if err := r.db.WithContext(ctx).Model(&model.PluginVersion{}).
		Where("listing_status = ?", model.PluginListingUnlisted).Count(&out.Unlisted).Error; err != nil {
		return nil, err
	}
	if err := r.db.WithContext(ctx).Model(&model.PluginVersion{}).
		Where("listing_status = ?", model.PluginListingYanked).Count(&out.Yanked).Error; err != nil {
		return nil, err
	}
	if err := r.db.WithContext(ctx).Model(&model.PluginVersion{}).
		Select("COALESCE(SUM(download_count), 0)").Scan(&out.Downloads).Error; err != nil {
		return nil, err
	}
	return out, nil
}

// ListCatalogRows 查询所有进入 catalog 候选集的 plugin + version
func (r *PluginRepo) ListCatalogRows(ctx context.Context) ([]PluginCatalogRow, error) {
	var rows []PluginCatalogRow
	err := r.db.WithContext(ctx).
		Table("plugins").
		Select(`plugins.id AS plugin_id,
			plugins.plugin_key AS plugin_key,
			plugins.name AS name,
			plugins.summary AS summary,
			plugins.author AS author,
			plugins.homepage AS homepage,
			plugins.status AS plugin_status,
			v.version AS version,
			v.channel AS channel,
			v.api_version AS api_version,
			v.min_app_version AS min_app_version,
			v.platforms AS platforms,
			v.sha256 AS sha256,
			v.size_bytes AS size_bytes,
			v.download_count AS download_count,
			v.listed_at AS listed_at,
			v.submitted_at AS submitted_at`).
		Joins("JOIN plugin_versions v ON v.plugin_id = plugins.id").
		Where("plugins.status = ?", model.PluginStatusActive).
		Where("v.review_status = ? AND v.listing_status = ?", model.PluginReviewApproved, model.PluginListingListed).
		Order("plugins.plugin_key ASC, v.id ASC").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, nil
}
