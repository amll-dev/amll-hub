package model

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"time"
)

// SubmissionStatus 投稿状态枚举
const (
	StatusDraft        = "draft"
	StatusPending      = "pending"
	StatusReviewing    = "reviewing"
	StatusNeedRevision = "need_revision"
	StatusMissingAudio = "missing_audio"
	StatusApproved     = "approved"
	StatusRejected     = "rejected"
	StatusClosed       = "closed"
)

// SubmissionLanguage 投稿语言枚举
const (
	LangOthers = "others"
	LangJa     = "ja"
	LangZh     = "zh"
	LangEn     = "en"
	LangKo     = "ko"
)

// JSONObject 自定义类型
type JSONObject map[string]interface{}

func (o *JSONObject) Scan(value interface{}) error {
	if value == nil {
		*o = nil
		return nil
	}
	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return errors.New("failed to scan JSONObject")
	}
	return json.Unmarshal(bytes, o)
}

func (o JSONObject) Value() (driver.Value, error) {
	if o == nil {
		return "{}", nil
	}
	return json.Marshal(o)
}

func (o JSONObject) GormDataType() string {
	return "jsonb"
}

// UserInfo 用户信息（投稿者/审核员/关闭者）
type UserInfo struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
}

func (u *UserInfo) Scan(value interface{}) error {
	if value == nil {
		*u = UserInfo{}
		return nil
	}
	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return errors.New("failed to scan UserInfo")
	}
	if len(bytes) == 0 {
		*u = UserInfo{}
		return nil
	}
	return json.Unmarshal(bytes, u)
}

func (u UserInfo) Value() (driver.Value, error) {
	return json.Marshal(u)
}

func (u UserInfo) GormDataType() string {
	return "jsonb"
}

// Submission 投稿主表
type Submission struct {
	ID                  int64           `gorm:"primaryKey;autoIncrement" json:"id"`
	Title               string          `gorm:"type:varchar(200);not null;default:''" json:"title"`
	Artist              string          `gorm:"type:varchar(200);not null;default:''" json:"artist"`
	Album               string          `gorm:"type:varchar(200);not null;default:''" json:"album"`
	NcmID               string          `gorm:"column:ncm_id;type:varchar(50);not null;default:''" json:"ncmId"`
	QqID                string          `gorm:"column:qq_id;type:varchar(50);not null;default:''" json:"qqId"`
	AmID                string          `gorm:"column:am_id;type:varchar(50);not null;default:''" json:"amId"`
	SpotifyID           string          `gorm:"column:spotify_id;type:varchar(50);not null;default:''" json:"spotifyId"`
	FileName            string          `gorm:"type:varchar(255);not null;default:''" json:"fileName"`
	Notes               string          `gorm:"type:varchar(2000);not null;default:''" json:"notes"`
	Tags                JSONStringArray `gorm:"type:jsonb;not null;default:'[]'" json:"tags"`
	Metadata            JSONObject      `gorm:"type:jsonb;not null;default:'{}'" json:"metadata"`
	Language            string          `gorm:"type:varchar(10);not null;default:'others'" json:"language"`
	Status              string          `gorm:"type:varchar(20);not null;default:'pending'" json:"status"`
	Submitter           string          `gorm:"type:varchar(100);not null" json:"submitter"`
	SubmitterInfo       UserInfo        `gorm:"type:jsonb;not null;default:'{}'" json:"submitterInfo"`
	Provider            string          `gorm:"type:varchar(20);not null;default:'casdoor'" json:"provider"`
	CreatedAt           time.Time       `gorm:"not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
	UpdatedAt           time.Time       `gorm:"not null;default:CURRENT_TIMESTAMP" json:"updatedAt"`
	FileUpdatedAt       *time.Time      `gorm:"column:file_updated_at;type:timestamptz" json:"fileUpdatedAt,omitempty"`
	RevisionRequestedAt *time.Time      `gorm:"column:revision_requested_at;type:timestamptz" json:"revisionRequestedAt,omitempty"`
	ClosedAt            *time.Time      `gorm:"column:closed_at;type:timestamptz" json:"closedAt,omitempty"`
	ClosedBy            string          `gorm:"column:closed_by;type:varchar(100)" json:"closedBy,omitempty"`
	ClosedByInfo        *UserInfo       `gorm:"column:closed_by_info;type:jsonb" json:"closedByInfo,omitempty"`
	Reviewer            string          `gorm:"type:varchar(100)" json:"reviewer,omitempty"`
	ReviewedAt          *time.Time      `gorm:"column:reviewed_at;type:timestamptz" json:"reviewedAt,omitempty"`
	ReviewComment       string          `gorm:"column:review_comment;type:text" json:"reviewComment,omitempty"`
}

func (Submission) TableName() string { return "submissions" }

// SubmissionAudio 音频附件
type SubmissionAudio struct {
	ID           int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	SubmissionID int64     `gorm:"column:submission_id;not null;uniqueIndex" json:"submissionId"`
	FileName     string    `gorm:"type:varchar(255);not null" json:"fileName"`
	CoverURL     string    `gorm:"column:cover_url;type:varchar(500)" json:"coverUrl,omitempty"`
	Title        string    `gorm:"type:varchar(200);not null;default:''" json:"title"`
	Artist       string    `gorm:"type:varchar(200);not null;default:''" json:"artist"`
	Album        string    `gorm:"type:varchar(200);not null;default:''" json:"album"`
	Platform     string    `gorm:"type:varchar(50);not null;default:''" json:"platform"`
	PlatformID   string    `gorm:"column:platform_id;type:varchar(100);not null;default:''" json:"platformId"`
	UploadedBy   string    `gorm:"column:uploaded_by;type:varchar(100);not null" json:"uploadedBy"`
	UploadedAt   time.Time `gorm:"column:uploaded_at;not null;default:CURRENT_TIMESTAMP" json:"uploadedAt"`
}

func (SubmissionAudio) TableName() string { return "submission_audios" }

// ReviewHistory 审核历史
type ReviewHistory struct {
	ID           int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	SubmissionID int64     `gorm:"column:submission_id;not null" json:"submissionId"`
	Reviewer     string    `gorm:"type:varchar(100);not null" json:"reviewer"`
	ReviewerInfo UserInfo  `gorm:"type:jsonb;not null" json:"reviewerInfo"`
	Status       string    `gorm:"type:varchar(20);not null" json:"status"`
	Comment      string    `gorm:"type:text;not null;default:''" json:"comment"`
	ReviewedAt   time.Time `gorm:"column:reviewed_at;not null;default:CURRENT_TIMESTAMP" json:"reviewedAt"`
}

func (ReviewHistory) TableName() string { return "submission_review_history" }

// Comment 普通评论
type Comment struct {
	ID           int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	SubmissionID int64     `gorm:"column:submission_id;not null" json:"submissionId"`
	Author       UserInfo  `gorm:"type:jsonb;not null" json:"author"`
	Content      string    `gorm:"type:text;not null" json:"content"`
	CreatedAt    time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
}

func (Comment) TableName() string { return "submission_comments" }

// Reviewer 审核员
type Reviewer struct {
	Username  string    `gorm:"primaryKey;type:varchar(100)" json:"username"`
	UpdatedAt time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"updatedAt"`
}

func (Reviewer) TableName() string { return "reviewers" }
