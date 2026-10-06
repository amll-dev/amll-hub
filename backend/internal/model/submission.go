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
	// StatusRevised 审核员已提交修订版 TTML，等待投稿者确认。
	// 投稿者确认采用后直接转 approved
	StatusRevised = "revised"
)

// SubmissionLanguage 投稿语言枚举
const (
	LangOthers = "others"
	LangJa     = "ja"
	LangZh     = "zh"
	LangEn     = "en"
	LangKo     = "ko"
)

// 投稿语言相关上限
const (
	// MaxLanguages 单条投稿最多可勾选的语言数
	MaxLanguages = 10
	// MaxLanguageLen 自定义语言名的最大长度
	MaxLanguageLen = 10
)

// JSONObject 自定义类型
type JSONObject map[string]any

func (o *JSONObject) Scan(value any) error {
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

func (u *UserInfo) Scan(value any) error {
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
	ID        int64           `gorm:"primaryKey;autoIncrement" json:"id"`
	Title     string          `gorm:"type:varchar(200);not null;default:''" json:"title"`
	Artist    string          `gorm:"type:varchar(200);not null;default:''" json:"artist"`
	Album     string          `gorm:"type:varchar(200);not null;default:''" json:"album"`
	NcmID     string          `gorm:"column:ncm_id;type:varchar(50);not null;default:''" json:"ncmId"`
	QqID      string          `gorm:"column:qq_id;type:varchar(50);not null;default:''" json:"qqId"`
	AmID      string          `gorm:"column:am_id;type:varchar(50);not null;default:''" json:"amId"`
	SpotifyID string          `gorm:"column:spotify_id;type:varchar(50);not null;default:''" json:"spotifyId"`
	FileName  string          `gorm:"type:varchar(255);not null;default:''" json:"fileName"`
	Notes     string          `gorm:"type:varchar(2000);not null;default:''" json:"notes"`
	Tags      JSONStringArray `gorm:"type:jsonb;not null;default:'[]'" json:"tags"`
	Metadata  JSONObject      `gorm:"type:jsonb;not null;default:'{}'" json:"metadata"`
	Language  string          `gorm:"type:varchar(10);not null;default:'others'" json:"language"`
	// Languages 多选语言（含用户自定义项），Language 存其中第一项作为主语言
	Languages JSONStringArray `gorm:"type:jsonb;not null;default:'[]'" json:"languages"`
	// IsUnrearranged 为 true 表示上传的是未经重排的原始歌词文件
	IsUnrearranged bool `gorm:"column:is_unrearranged;not null;default:false" json:"isUnrearranged"`
	// UnrearrangedReason 投稿者填写的「为什么用未重排版」说明，详情页展示
	UnrearrangedReason  string     `gorm:"column:unrearranged_reason;type:varchar(500);not null;default:''" json:"unrearrangedReason"`
	Status              string     `gorm:"type:varchar(20);not null;default:'pending'" json:"status"`
	Submitter           string     `gorm:"type:varchar(100);not null" json:"submitter"`
	SubmitterInfo       UserInfo   `gorm:"type:jsonb;not null;default:'{}'" json:"submitterInfo"`
	Provider            string     `gorm:"type:varchar(20);not null;default:'casdoor'" json:"provider"`
	CreatedAt           time.Time  `gorm:"not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
	UpdatedAt           time.Time  `gorm:"not null;default:CURRENT_TIMESTAMP" json:"updatedAt"`
	FileUpdatedAt       *time.Time `gorm:"column:file_updated_at;type:timestamptz" json:"fileUpdatedAt,omitempty"`
	RevisionRequestedAt *time.Time `gorm:"column:revision_requested_at;type:timestamptz" json:"revisionRequestedAt,omitempty"`
	ClosedAt            *time.Time `gorm:"column:closed_at;type:timestamptz" json:"closedAt,omitempty"`
	ClosedBy            string     `gorm:"column:closed_by;type:varchar(100)" json:"closedBy,omitempty"`
	ClosedByInfo        *UserInfo  `gorm:"column:closed_by_info;type:jsonb" json:"closedByInfo,omitempty"`
	Reviewer            string     `gorm:"type:varchar(100)" json:"reviewer,omitempty"`
	ReviewedAt          *time.Time `gorm:"column:reviewed_at;type:timestamptz" json:"reviewedAt,omitempty"`
	ReviewComment       string     `gorm:"column:review_comment;type:text" json:"reviewComment,omitempty"`

	// 审核员修订版：编辑器保存时勾选（上传修改后的 TTML）才会写入
	RevisionFileKey      string     `gorm:"column:revision_file_key;type:varchar(500);not null;default:''" json:"revisionFileKey,omitempty"`
	RevisionMetadata     JSONObject `gorm:"column:revision_metadata;type:jsonb;not null;default:'{}'" json:"revisionMetadata,omitempty"`
	RevisionTTML         *string    `gorm:"column:revision_ttml;type:text" json:"revisionTtml,omitempty"`
	RevisionAt           *time.Time `gorm:"column:revision_at;type:timestamptz" json:"revisionAt,omitempty"`
	RevisionReviewer     string     `gorm:"column:revision_reviewer;type:varchar(100)" json:"revisionReviewer,omitempty"`
	RevisionReviewerInfo *UserInfo  `gorm:"column:revision_reviewer_info;type:jsonb" json:"revisionReviewerInfo,omitempty"`
}

func (Submission) TableName() string { return "submissions" }

// SnapshotRevision 返回当前修订版字段的副本
func (s *Submission) SnapshotRevision() *Submission {
	cp := &Submission{
		RevisionFileKey:      s.RevisionFileKey,
		RevisionMetadata:     s.RevisionMetadata,
		RevisionAt:           s.RevisionAt,
		RevisionReviewer:     s.RevisionReviewer,
		RevisionReviewerInfo: s.RevisionReviewerInfo,
	}
	if s.RevisionTTML != nil {
		ttml := *s.RevisionTTML
		cp.RevisionTTML = &ttml
	}
	return cp
}

// RestoreRevision 把快照里的修订版字段写回自身，用于回滚
func (s *Submission) RestoreRevision(saved *Submission) {
	if saved == nil {
		return
	}
	s.RevisionFileKey = saved.RevisionFileKey
	s.RevisionMetadata = saved.RevisionMetadata
	s.RevisionTTML = saved.RevisionTTML
	s.RevisionAt = saved.RevisionAt
	s.RevisionReviewer = saved.RevisionReviewer
	s.RevisionReviewerInfo = saved.RevisionReviewerInfo
}

// ClearRevision 清空修订版字段
func (s *Submission) ClearRevision() {
	s.RevisionFileKey = ""
	s.RevisionMetadata = JSONObject{}
	s.RevisionTTML = nil
	s.RevisionAt = nil
	s.RevisionReviewer = ""
	s.RevisionReviewerInfo = nil
}

// SubmissionAudio 音频附件
type SubmissionAudio struct {
	ID           int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	SubmissionID int64     `gorm:"column:submission_id;not null;index" json:"submissionId"`
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

// SubmissionFileHistory 文件更新历史（独立于审核历史）
type SubmissionFileHistory struct {
	ID           int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	SubmissionID int64     `gorm:"column:submission_id;not null" json:"submissionId"`
	Uploader     string    `gorm:"type:varchar(100);not null" json:"uploader"`
	UploaderInfo UserInfo  `gorm:"type:jsonb;not null" json:"uploaderInfo"`
	FileName     string    `gorm:"type:varchar(255);not null" json:"fileName"`
	UploadedAt   time.Time `gorm:"column:uploaded_at;not null;default:CURRENT_TIMESTAMP" json:"uploadedAt"`
}

func (SubmissionFileHistory) TableName() string { return "submission_file_history" }

// ReviewReport 审核报告
type ReviewReport struct {
	ID           int64    `gorm:"primaryKey;autoIncrement" json:"id"`
	SubmissionID int64    `gorm:"column:submission_id;not null" json:"submissionId"`
	Reviewer     string   `gorm:"type:varchar(100);not null" json:"reviewer"`
	ReviewerInfo UserInfo `gorm:"type:jsonb;not null;default:'{}'" json:"reviewerInfo"`
	// Action 本次报告对应的审核动作（revision/approve/reject/missing_audio）
	Action string `gorm:"type:varchar(20);not null" json:"action"`
	// HasRevision 本次是否上传了修订版 TTML
	HasRevision bool       `gorm:"column:has_revision;not null;default:false" json:"hasRevision"`
	ReportMD    string     `gorm:"column:report_md;type:text;not null;default:''" json:"reportMd"`
	Structured  JSONObject `gorm:"type:jsonb;not null;default:'{}'" json:"structured"`
	CreatedAt   time.Time  `gorm:"column:created_at;not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
}

func (ReviewReport) TableName() string { return "review_reports" }

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

// Admin 超级管理员（手动维护，可管理审核员名单）
type Admin struct {
	Username  string    `gorm:"primaryKey;type:varchar(100)" json:"username"`
	UpdatedAt time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"updatedAt"`
}

func (Admin) TableName() string { return "admins" }
