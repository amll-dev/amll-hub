package repository

import (
	"context"
	"errors"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// DocumentRepo 文档数据访问
type DocumentRepo struct {
	db *gorm.DB
}

// NewDocumentRepo 创建 DocumentRepo
func NewDocumentRepo(db *gorm.DB) *DocumentRepo {
	return &DocumentRepo{db: db}
}

// DocumentListQuery 文档列表查询条件
type DocumentListQuery struct {
	Page     int
	PageSize int
	Group    string
	// Status 为空表示不过滤（管理端）；公开列表固定传 published
	Status string
	Q      string
}

// DocumentListRow 列表投影行：不带正文，只带正文长度
type DocumentListRow struct {
	ID          int64      `gorm:"column:id" json:"id"`
	Slug        string     `gorm:"column:slug" json:"slug"`
	Title       string     `gorm:"column:title" json:"title"`
	GroupName   string     `gorm:"column:group_name" json:"group"`
	Status      string     `gorm:"column:status" json:"status"`
	SortOrder   int        `gorm:"column:sort_order" json:"sortOrder"`
	SizeBytes   int64      `gorm:"column:size_bytes" json:"sizeBytes"`
	UpdatedBy   string     `gorm:"column:updated_by" json:"updatedBy"`
	UpdatedAt   time.Time  `gorm:"column:updated_at" json:"updatedAt"`
	PublishedAt *time.Time `gorm:"column:published_at" json:"publishedAt,omitempty"`
}

// DocumentRevisionRow 版本列表投影行：不带正文
type DocumentRevisionRow struct {
	ID         int64          `gorm:"column:id" json:"id"`
	DocumentID int64          `gorm:"column:document_id" json:"documentId"`
	Title      string         `gorm:"column:title" json:"title"`
	Note       string         `gorm:"column:note" json:"note"`
	Author     string         `gorm:"column:author" json:"author"`
	AuthorInfo model.UserInfo `gorm:"column:author_info" json:"authorInfo"`
	SizeBytes  int64          `gorm:"column:size_bytes" json:"sizeBytes"`
	CreatedAt  time.Time      `gorm:"column:created_at" json:"createdAt"`
}

// Transaction 在事务内执行 fn
func (r *DocumentRepo) Transaction(ctx context.Context, fn func(tx *gorm.DB) error) error {
	return r.db.WithContext(ctx).Transaction(fn)
}

// Create 写入文档，tx 为 nil 时使用默认连接
func (r *DocumentRepo) Create(ctx context.Context, tx *gorm.DB, d *model.Document) error {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	return tx.Create(d).Error
}

// GetByID 按主键查询，未找到返回 (nil, nil)
func (r *DocumentRepo) GetByID(ctx context.Context, tx *gorm.DB, id int64) (*model.Document, error) {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	var d model.Document
	err := tx.Where("id = ?", id).First(&d).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// GetByIDForUpdate 事务内加行锁查询
func (r *DocumentRepo) GetByIDForUpdate(ctx context.Context, tx *gorm.DB, id int64) (*model.Document, error) {
	var d model.Document
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&d).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// GetBySlug 按 slug 查询，未找到返回 (nil, nil)
func (r *DocumentRepo) GetBySlug(ctx context.Context, slug string) (*model.Document, error) {
	var d model.Document
	err := r.db.WithContext(ctx).Where("slug = ?", slug).First(&d).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// UpdateFields 按字段更新文档
func (r *DocumentRepo) UpdateFields(ctx context.Context, tx *gorm.DB, id int64, updates map[string]any) error {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	return tx.Model(&model.Document{}).Where("id = ?", id).Updates(updates).Error
}

// Delete 硬删除文档
func (r *DocumentRepo) Delete(ctx context.Context, id int64) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Document{}).Error
}

// SlugExists 判断 slug 是否被其他文档占用
func (r *DocumentRepo) SlugExists(ctx context.Context, slug string, excludeID int64) (bool, error) {
	base := r.db.WithContext(ctx).Model(&model.Document{}).Where("slug = ?", slug)
	if excludeID > 0 {
		base = base.Where("id <> ?", excludeID)
	}
	var count int64
	if err := base.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// List 分页查询文档列表（不带正文）
func (r *DocumentRepo) List(ctx context.Context, q DocumentListQuery) ([]DocumentListRow, int64, error) {
	page, size := normalizePage(q.Page, q.PageSize)

	base := r.db.WithContext(ctx).Model(&model.Document{})
	if q.Group != "" {
		base = base.Where("group_name = ?", q.Group)
	}
	if q.Status != "" {
		base = base.Where("status = ?", q.Status)
	}
	if q.Q != "" {
		like := "%" + q.Q + "%"
		base = base.Where("title ILIKE ? OR slug ILIKE ?", like, like)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []DocumentListRow{}, 0, nil
	}

	var rows []DocumentListRow
	if err := base.
		Select("id, slug, title, group_name, status, sort_order, " +
			"length(content) AS size_bytes, updated_by, updated_at, published_at").
		Order("sort_order ASC, id ASC").
		Offset((page - 1) * size).Limit(size).
		Scan(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// CreateRevision 写入版本快照
func (r *DocumentRepo) CreateRevision(ctx context.Context, tx *gorm.DB, rev *model.DocumentRevision) error {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	return tx.Create(rev).Error
}

// ListRevisions 分页查询版本列表（不带正文）
func (r *DocumentRepo) ListRevisions(ctx context.Context, docID int64, page, size int) ([]DocumentRevisionRow, int64, error) {
	page, size = normalizePage(page, size)

	base := r.db.WithContext(ctx).Model(&model.DocumentRevision{}).Where("document_id = ?", docID)
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []DocumentRevisionRow{}, 0, nil
	}

	var rows []DocumentRevisionRow
	if err := base.
		Select("id, document_id, title, note, author, author_info, " +
			"length(content) AS size_bytes, created_at").
		Order("id DESC").
		Offset((page - 1) * size).Limit(size).
		Scan(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// GetRevision 查询单条版本快照（含正文），未找到返回 (nil, nil)
func (r *DocumentRepo) GetRevision(ctx context.Context, docID, revID int64) (*model.DocumentRevision, error) {
	var rev model.DocumentRevision
	err := r.db.WithContext(ctx).
		Where("id = ? AND document_id = ?", revID, docID).
		First(&rev).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rev, nil
}

// CountRevisions 统计某文档的版本数
func (r *DocumentRepo) CountRevisions(ctx context.Context, docID int64) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.DocumentRevision{}).
		Where("document_id = ?", docID).Count(&count).Error
	return count, err
}

// ListAllPublished 返回全部已发布文档（导入脚本 / 站点地图用）
func (r *DocumentRepo) ListAllPublished(ctx context.Context) ([]DocumentListRow, error) {
	var rows []DocumentListRow
	err := r.db.WithContext(ctx).Model(&model.Document{}).
		Select("id, slug, title, group_name, status, sort_order, "+
			"length(content) AS size_bytes, updated_by, updated_at, published_at").
		Where("status = ?", model.DocStatusPublished).
		Order("sort_order ASC, id ASC").
		Scan(&rows).Error
	return rows, err
}
