package model

import "time"

// UserGithubBinding GitHub 账号绑定表。
// username 为站点 Casdoor 用户名（= JWT claims.name），与 GitHub 数字 ID 双向唯一。
type UserGithubBinding struct {
	ID           int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	Username     string    `gorm:"type:varchar(100);not null" json:"username"`
	GithubID     int64     `gorm:"column:github_id;not null" json:"githubId"`
	GithubLogin  string    `gorm:"column:github_login;type:varchar(100);not null" json:"githubLogin"`
	GithubEmail  string    `gorm:"column:github_email;type:varchar(255)" json:"githubEmail,omitempty"`
	GithubAvatar string    `gorm:"column:github_avatar;type:varchar(500)" json:"githubAvatar,omitempty"`
	BoundAt      time.Time `gorm:"column:bound_at;not null;default:CURRENT_TIMESTAMP" json:"boundAt"`
	UpdatedAt    time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"updatedAt"`
}

func (UserGithubBinding) TableName() string { return "user_github_bindings" }
