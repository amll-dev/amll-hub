package model

import "time"

// 迁移任务状态
const (
	MigrationStatusPending   = "pending"
	MigrationStatusRunning   = "running"
	MigrationStatusCompleted = "completed"
	MigrationStatusFailed    = "failed"
)

// GithubMigratedPr 已迁移 PR 记录（全局唯一，用于去重跳过）
type GithubMigratedPr struct {
	ID           int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	PrNumber     int       `gorm:"column:pr_number;not null" json:"prNumber"`
	Username     string    `gorm:"type:varchar(100);not null" json:"username"`
	SubmissionID *int64    `gorm:"column:submission_id" json:"submissionId,omitempty"`
	MigratedAt   time.Time `gorm:"column:migrated_at;not null;default:CURRENT_TIMESTAMP" json:"migratedAt"`
}

func (GithubMigratedPr) TableName() string { return "github_migrated_prs" }

// GithubMigratedPrItem 已迁移 PR 概览（迁移页展示用，含 PR 标题与对应稿件）
type GithubMigratedPrItem struct {
	PrNumber        int       `gorm:"column:pr_number" json:"prNumber"`
	PrTitle         string    `gorm:"column:pr_title" json:"prTitle"`
	SubmissionID    *int64    `gorm:"column:submission_id" json:"submissionId,omitempty"`
	SubmissionTitle string    `gorm:"column:submission_title" json:"submissionTitle"`
	FileName        string    `gorm:"column:file_name" json:"fileName"`
	MigratedAt      time.Time `gorm:"column:migrated_at" json:"migratedAt"`
}

// GithubMigrationTask 迁移任务与进度
type GithubMigrationTask struct {
	ID            int64      `gorm:"primaryKey;autoIncrement" json:"id"`
	Username      string     `gorm:"type:varchar(100);not null" json:"username"`
	GithubLogin   string     `gorm:"column:github_login;type:varchar(100);not null" json:"githubLogin"`
	Status        string     `gorm:"type:varchar(20);not null;default:'pending'" json:"status"`
	TotalPrs      int        `gorm:"column:total_prs;not null;default:0" json:"totalPrs"`
	ProcessedPrs  int        `gorm:"column:processed_prs;not null;default:0" json:"processedPrs"`
	CreatedCount  int        `gorm:"column:created_count;not null;default:0" json:"createdCount"`
	SkippedCount  int        `gorm:"column:skipped_count;not null;default:0" json:"skippedCount"`
	FailedCount   int        `gorm:"column:failed_count;not null;default:0" json:"failedCount"`
	Cursor        string     `gorm:"type:varchar(64)" json:"cursor,omitempty"`
	Error         string     `gorm:"type:text" json:"error,omitempty"`
	ClosePrStatus string     `gorm:"column:close_pr_status;type:varchar(20);not null;default:'pending'" json:"closePrStatus"`
	ClosedPrCount int        `gorm:"column:closed_pr_count;not null;default:0" json:"closedPrCount"`
	CreatedAt     time.Time  `gorm:"not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
	UpdatedAt     time.Time  `gorm:"not null;default:CURRENT_TIMESTAMP" json:"updatedAt"`
	CompletedAt   *time.Time `gorm:"column:completed_at;type:timestamptz" json:"completedAt,omitempty"`
}

func (GithubMigrationTask) TableName() string { return "github_migration_tasks" }
