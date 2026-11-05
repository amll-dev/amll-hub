package model

import "time"

// PetitionLink 投稿与歌词请愿的关联
type PetitionLink struct {
	ID               int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	SubmissionID     int64     `gorm:"column:submission_id;not null;uniqueIndex:idx_sp_link_unique,priority:1" json:"submissionId"`
	RequestID        int64     `gorm:"column:request_id;not null;uniqueIndex:idx_sp_link_unique,priority:2" json:"requestId"`
	LinkedBy         string    `gorm:"column:linked_by;type:varchar(100);not null" json:"linkedBy"`
	LinkNotified     bool      `gorm:"column:link_notified;not null;default:false" json:"linkNotified"`
	CompleteNotified bool      `gorm:"column:complete_notified;not null;default:false" json:"completeNotified"`
	CreatedAt        time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
}

func (PetitionLink) TableName() string { return "submission_petition_links" }
