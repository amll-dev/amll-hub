package model

import "time"

// 通知类型
const (
	NotifyTypeSystem     = "system"
	NotifyTypeReview     = "review"
	NotifyTypeSubmission = "submission"
	NotifyTypeComment    = "comment"
)

// 审核结果细分
const (
	NotifyResultApproved     = "approved"
	NotifyResultRejected     = "rejected"
	NotifyResultNeedRevision = "need_revision"
	NotifyResultMissingAudio = "missing_audio"
	NotifyResultClosed       = "closed"
	// NotifyResultRevised 审核员已提交修订版 TTML，等投稿者确认
	NotifyResultRevised = "revised"
)

// Notification 站内消息
type Notification struct {
	ID          int64      `gorm:"primaryKey;autoIncrement" json:"id"`
	Username    string     `gorm:"type:varchar(100);not null" json:"-"`
	Type        string     `gorm:"type:varchar(20);not null;default:'system'" json:"type"`
	Title       string     `gorm:"type:varchar(200);not null;default:''" json:"title"`
	Content     string     `gorm:"type:text;not null;default:''" json:"content"`
	IsRead      bool       `gorm:"column:is_read;type:boolean;not null;default:false" json:"read"`
	Result      string     `gorm:"column:result;type:varchar(20);not null;default:''" json:"-"`
	ActionPath  string     `gorm:"column:action_path;type:varchar(500)" json:"-"`
	ActionLabel string     `gorm:"column:action_label;type:varchar(100)" json:"-"`
	CreatedAt   time.Time  `gorm:"not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
	ReadAt      *time.Time `gorm:"column:read_at" json:"-"`
}

func (Notification) TableName() string { return "notifications" }
