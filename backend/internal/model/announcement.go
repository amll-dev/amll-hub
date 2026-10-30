package model

import "time"

// 公告邮件的发送状态
const (
	// AnnouncementMailNone 未勾选发送邮件
	AnnouncementMailNone = "none"
	// AnnouncementMailSending 后台正在逐封发送
	AnnouncementMailSending = "sending"
	// AnnouncementMailDone 发送结束
	AnnouncementMailDone = "done"
)

// Announcement 系统公告发布记录
type Announcement struct {
	ID          int64  `gorm:"primaryKey;autoIncrement" json:"id"`
	Title       string `gorm:"type:varchar(200);not null" json:"title"`
	Content     string `gorm:"type:text;not null" json:"content"`
	ActionPath  string `gorm:"column:action_path;type:varchar(500);not null;default:''" json:"actionPath"`
	ActionLabel string `gorm:"column:action_label;type:varchar(100);not null;default:''" json:"actionLabel"`
	Sender      string `gorm:"type:varchar(100);not null" json:"sender"`
	// MailEnabled 本次发布是否勾选发送邮件
	MailEnabled bool `gorm:"column:mail_enabled;type:boolean;not null;default:false" json:"mailEnabled"`
	// AudienceCount 站内信收件人总数
	AudienceCount int `gorm:"column:audience_count;type:integer;not null;default:0" json:"audienceCount"`
	MailSent      int `gorm:"column:mail_sent;type:integer;not null;default:0" json:"mailSent"`
	MailFailed    int `gorm:"column:mail_failed;type:integer;not null;default:0" json:"mailFailed"`
	// MailSkipped Casdoor 查不到邮箱而跳过的用户数
	MailSkipped    int        `gorm:"column:mail_skipped;type:integer;not null;default:0" json:"mailSkipped"`
	MailStatus     string     `gorm:"column:mail_status;type:varchar(20);not null;default:'none'" json:"mailStatus"`
	CreatedAt      time.Time  `gorm:"not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
	MailFinishedAt *time.Time `gorm:"column:mail_finished_at" json:"mailFinishedAt,omitempty"`
}

func (Announcement) TableName() string { return "announcements" }
