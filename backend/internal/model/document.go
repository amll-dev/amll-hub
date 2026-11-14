package model

import "time"

// 文档分组
const (
	DocGroupLyrics = "lyrics"
	DocGroupAPI    = "api"
)

// 文档状态
const (
	DocStatusDraft     = "draft"
	DocStatusPublished = "published"
)

// Document 文档主表
type Document struct {
	ID            int64      `gorm:"primaryKey;autoIncrement" json:"id"`
	Slug          string     `gorm:"type:varchar(100);not null;uniqueIndex" json:"slug"`
	Title         string     `gorm:"type:varchar(200);not null" json:"title"`
	GroupName     string     `gorm:"column:group_name;type:varchar(20);not null;default:'lyrics'" json:"group"`
	Status        string     `gorm:"type:varchar(20);not null;default:'draft'" json:"status"`
	SortOrder     int        `gorm:"column:sort_order;not null;default:0" json:"sortOrder"`
	Content       string     `gorm:"type:text;not null;default:''" json:"content"`
	CreatedBy     string     `gorm:"column:created_by;type:varchar(100);not null;default:''" json:"createdBy"`
	UpdatedBy     string     `gorm:"column:updated_by;type:varchar(100);not null;default:''" json:"updatedBy"`
	CreatedByInfo UserInfo   `gorm:"column:created_by_info;type:jsonb;not null;default:'{}'" json:"createdByInfo"`
	UpdatedByInfo UserInfo   `gorm:"column:updated_by_info;type:jsonb;not null;default:'{}'" json:"updatedByInfo"`
	PublishedAt   *time.Time `gorm:"column:published_at;type:timestamptz" json:"publishedAt,omitempty"`
	CreatedAt     time.Time  `gorm:"column:created_at;not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
	UpdatedAt     time.Time  `gorm:"column:updated_at;not null;default:CURRENT_TIMESTAMP" json:"updatedAt"`
}

func (Document) TableName() string { return "documents" }

// DocumentRevision 文档版本快照（不可变）
type DocumentRevision struct {
	ID         int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	DocumentID int64     `gorm:"column:document_id;not null;index" json:"documentId"`
	Title      string    `gorm:"type:varchar(200);not null" json:"title"`
	Content    string    `gorm:"type:text;not null" json:"content"`
	Note       string    `gorm:"type:varchar(300);not null;default:''" json:"note"`
	Author     string    `gorm:"type:varchar(100);not null;default:''" json:"author"`
	AuthorInfo UserInfo  `gorm:"column:author_info;type:jsonb;not null;default:'{}'" json:"authorInfo"`
	CreatedAt  time.Time `gorm:"column:created_at;not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
}

func (DocumentRevision) TableName() string { return "document_revisions" }
