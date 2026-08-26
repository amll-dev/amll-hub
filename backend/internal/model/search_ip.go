package model

import "time"

// SearchIPSubmission 搜索IP显示投稿
type SearchIPSubmission struct {
	ID            int64      `gorm:"primaryKey;autoIncrement" json:"id"`
	Title         string     `gorm:"type:varchar(200);not null;default:''" json:"title"`
	Data          JSONObject `gorm:"type:jsonb;not null" json:"data"`
	ImageKeys     JSONObject `gorm:"type:jsonb;default:'{}'" json:"imageKeys"`
	Submitter     string     `gorm:"type:varchar(100);not null" json:"submitter"`
	SubmitterInfo JSONObject `gorm:"type:jsonb;default:'{}'" json:"submitterInfo"`
	Status        string     `gorm:"type:varchar(20);default:'pending'" json:"status"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

func (SearchIPSubmission) TableName() string { return "search_ip_submissions" }
