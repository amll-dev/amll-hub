package model

import "time"

const RecruitmentTag = "参与审核招募"

type ReviewerRecruitment struct {
	ID             string     `gorm:"type:uuid;primaryKey" json:"id"`
	FormData       JSONObject `gorm:"type:jsonb;not null" json:"formData"`
	StartsOn       string     `gorm:"type:date;not null" json:"startsOn"`
	EndsOn         *string    `gorm:"type:date" json:"endsOn,omitempty"`
	EndedOn        *string    `gorm:"type:date" json:"endedOn,omitempty"`
	TargetMembers  int        `json:"targetMembers"`
	CompletedCount int        `json:"completedCount"`
	Status         string     `json:"status"`
	CreatedBy      string     `json:"createdBy"`
	CreatedAt      time.Time  `json:"createdAt"`
}

func (ReviewerRecruitment) TableName() string { return "reviewer_recruitments" }

type ReviewerRecruitmentMember struct {
	ID            int64      `gorm:"primaryKey" json:"id"`
	RecruitmentID string     `gorm:"type:uuid;not null" json:"recruitmentId"`
	Username      string     `json:"username"`
	UserInfo      UserInfo   `gorm:"type:jsonb" json:"userInfo"`
	Progress      JSONObject `gorm:"type:jsonb" json:"-"`
	JoinedAt      time.Time  `json:"joinedAt"`
}

func (ReviewerRecruitmentMember) TableName() string { return "reviewer_recruitment_members" }
