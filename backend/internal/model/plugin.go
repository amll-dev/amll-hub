package model

import "time"

// 插件审核状态
const (
	PluginReviewPending  = "pending"
	PluginReviewApproved = "approved"
	PluginReviewRejected = "rejected"
)

// 插件上架状态
const (
	PluginListingUnlisted = "unlisted"
	PluginListingListed   = "listed"
	PluginListingYanked   = "yanked"
)

// 插件状态
const (
	PluginStatusActive  = "active"
	PluginStatusHidden  = "hidden"
	PluginStatusBlocked = "blocked"
)

// 插件分发通道
const (
	PluginChannelTrustedJS = "trusted-js"
	PluginChannelTheme     = "theme"
)

// Plugin 插件主表
type Plugin struct {
	ID            int64           `gorm:"primaryKey;autoIncrement" json:"id"`
	PluginKey     string          `gorm:"column:plugin_key;type:varchar(100);not null;uniqueIndex" json:"pluginKey"`
	Name          string          `gorm:"type:varchar(128);not null;default:''" json:"name"`
	Summary       string          `gorm:"type:varchar(512);not null;default:''" json:"summary"`
	DescriptionMD string          `gorm:"column:description_md;type:text;not null;default:''" json:"descriptionMd"`
	Author        string          `gorm:"type:varchar(256);not null;default:''" json:"author"`
	Homepage      string          `gorm:"type:varchar(500);not null;default:''" json:"homepage"`
	RepoURL       string          `gorm:"column:repo_url;type:varchar(500);not null;default:''" json:"repoUrl"`
	License       string          `gorm:"type:varchar(128);not null;default:''" json:"license"`
	Tags          JSONStringArray `gorm:"type:jsonb;not null;default:'[]'" json:"tags"`
	IconKey       string          `gorm:"column:icon_key;type:varchar(500);not null;default:''" json:"-"`
	OwnerUsername string          `gorm:"column:owner_username;type:varchar(100);not null;default:''" json:"ownerUsername"`
	Status        string          `gorm:"type:varchar(20);not null;default:'active'" json:"status"`
	CreatedAt     time.Time       `gorm:"column:created_at;not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
	UpdatedAt     time.Time       `gorm:"column:updated_at;not null;default:CURRENT_TIMESTAMP" json:"updatedAt"`
}

func (Plugin) TableName() string { return "plugins" }

// PluginComment 插件评论
type PluginComment struct {
	ID        int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	PluginKey string    `gorm:"column:plugin_key;type:varchar(100);not null;index" json:"pluginKey"`
	Author    UserInfo  `gorm:"type:jsonb;not null;default:'{}'" json:"author"`
	Content   string    `gorm:"type:text;not null;default:''" json:"content"`
	CreatedAt time.Time `gorm:"column:created_at;not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
}

func (PluginComment) TableName() string { return "plugin_comments" }

// PluginVersion 插件版本表
type PluginVersion struct {
	ID            int64           `gorm:"primaryKey;autoIncrement" json:"id"`
	PluginID      int64           `gorm:"column:plugin_id;not null;index" json:"pluginId"`
	Version       string          `gorm:"type:varchar(64);not null" json:"version"`
	Channel       string          `gorm:"type:varchar(20);not null" json:"channel"`
	APIVersion    int             `gorm:"column:api_version;not null;default:0" json:"apiVersion"`
	MinAppVersion string          `gorm:"column:min_app_version;type:varchar(64);not null;default:''" json:"minAppVersion"`
	Platforms     JSONStringArray `gorm:"type:jsonb;not null;default:'[]'" json:"platforms"`
	Entry         string          `gorm:"type:varchar(512);not null" json:"entry"`
	ArtifactKey   string          `gorm:"column:artifact_key;type:varchar(500);not null" json:"-"`
	SHA256        string          `gorm:"column:sha256;type:char(64);not null" json:"sha256"`
	SizeBytes     int64           `gorm:"column:size_bytes;not null" json:"sizeBytes"`
	Manifest      JSONObject      `gorm:"type:jsonb;not null;default:'{}'" json:"manifest"`
	ReadmeMD      string          `gorm:"column:readme_md;type:text;not null;default:''" json:"readmeMd"`
	ChangelogMD   string          `gorm:"column:changelog_md;type:text;not null;default:''" json:"changelogMd"`
	ReviewStatus  string          `gorm:"column:review_status;type:varchar(20);not null;default:'pending'" json:"reviewStatus"`
	ListingStatus string          `gorm:"column:listing_status;type:varchar(20);not null;default:'unlisted'" json:"listingStatus"`
	SubmittedBy   string          `gorm:"column:submitted_by;type:varchar(100);not null" json:"submittedBy"`
	SubmitterInfo UserInfo        `gorm:"column:submitter_info;type:jsonb;not null;default:'{}'" json:"submitterInfo"`
	Reviewer      string          `gorm:"type:varchar(100);not null;default:''" json:"reviewer"`
	ReviewerInfo  UserInfo        `gorm:"column:reviewer_info;type:jsonb;not null;default:'{}'" json:"reviewerInfo"`
	ReviewComment string          `gorm:"column:review_comment;type:text;not null;default:''" json:"reviewComment"`
	DownloadCount int64           `gorm:"column:download_count;not null;default:0" json:"downloadCount"`
	SubmittedAt   time.Time       `gorm:"column:submitted_at;not null;default:CURRENT_TIMESTAMP" json:"submittedAt"`
	ReviewedAt    *time.Time      `gorm:"column:reviewed_at;type:timestamptz" json:"reviewedAt,omitempty"`
	ListedAt      *time.Time      `gorm:"column:listed_at;type:timestamptz" json:"listedAt,omitempty"`
	YankedAt      *time.Time      `gorm:"column:yanked_at;type:timestamptz" json:"yankedAt,omitempty"`
	CreatedAt     time.Time       `gorm:"column:created_at;not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
	UpdatedAt     time.Time       `gorm:"column:updated_at;not null;default:CURRENT_TIMESTAMP" json:"updatedAt"`
}

func (PluginVersion) TableName() string { return "plugin_versions" }

// PluginReviewHistory 插件审核历史
type PluginReviewHistory struct {
	ID           int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	VersionID    int64     `gorm:"column:version_id;not null;index" json:"versionId"`
	Reviewer     string    `gorm:"type:varchar(100);not null" json:"reviewer"`
	ReviewerInfo UserInfo  `gorm:"column:reviewer_info;type:jsonb;not null;default:'{}'" json:"reviewerInfo"`
	Action       string    `gorm:"type:varchar(20);not null" json:"action"`
	Comment      string    `gorm:"type:text;not null;default:''" json:"comment"`
	ReviewedAt   time.Time `gorm:"column:reviewed_at;not null;default:CURRENT_TIMESTAMP" json:"reviewedAt"`
}

func (PluginReviewHistory) TableName() string { return "plugin_review_history" }

// PluginRating 插件评分
type PluginRating struct {
	ID        int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	PluginKey string    `gorm:"column:plugin_key;type:varchar(100);not null;uniqueIndex:uq_plugin_rating_user" json:"pluginKey"`
	Username  string    `gorm:"type:varchar(100);not null;uniqueIndex:uq_plugin_rating_user" json:"username"`
	Score     int       `gorm:"not null" json:"score"`
	CreatedAt time.Time `gorm:"column:created_at;not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null;default:CURRENT_TIMESTAMP" json:"updatedAt"`
}

func (PluginRating) TableName() string { return "plugin_ratings" }

// PluginAuditLog 插件管理操作审计
type PluginAuditLog struct {
	ID           int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	Operator     string    `gorm:"type:varchar(100);not null" json:"operator"`
	OperatorInfo UserInfo  `gorm:"column:operator_info;type:jsonb;not null;default:'{}'" json:"operatorInfo"`
	Action       string    `gorm:"type:varchar(50);not null" json:"action"`
	TargetType   string    `gorm:"column:target_type;type:varchar(20);not null" json:"targetType"`
	TargetID     int64     `gorm:"column:target_id;not null" json:"targetId"`
	Reason       string    `gorm:"type:text;not null;default:''" json:"reason"`
	CreatedAt    time.Time `gorm:"column:created_at;not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
}

func (PluginAuditLog) TableName() string { return "plugin_audit_logs" }
