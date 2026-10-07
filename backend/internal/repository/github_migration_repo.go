package repository

import (
	"context"
	"errors"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
)

// GithubMigrationRepo 迁移任务/已迁 PR 数据访问。
// 说明：迁移过程中的进度更新由 Worker 直接写库完成，此处只提供后端创建/查询/重试用到的操作。
type GithubMigrationRepo struct {
	db *gorm.DB
}

// NewGithubMigrationRepo 创建 GithubMigrationRepo
func NewGithubMigrationRepo(db *gorm.DB) *GithubMigrationRepo {
	return &GithubMigrationRepo{db: db}
}

// CreateTask 创建迁移任务
func (r *GithubMigrationRepo) CreateTask(ctx context.Context, t *model.GithubMigrationTask) error {
	return r.db.WithContext(ctx).Create(t).Error
}

// GetTask 按 ID 查询任务，未找到返回 (nil, nil)
func (r *GithubMigrationRepo) GetTask(ctx context.Context, id int64) (*model.GithubMigrationTask, error) {
	var t model.GithubMigrationTask
	err := r.db.WithContext(ctx).First(&t, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// GetActiveTask 查询该用户是否有进行中的任务（pending/running）
func (r *GithubMigrationRepo) GetActiveTask(ctx context.Context, username string) (*model.GithubMigrationTask, error) {
	var t model.GithubMigrationTask
	err := r.db.WithContext(ctx).
		Where("username = ? AND status IN ?", username, []string{
			model.MigrationStatusPending, model.MigrationStatusRunning,
		}).
		Order("id DESC").
		First(&t).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// GetLatestTask 查询该用户最近一次任务
func (r *GithubMigrationRepo) GetLatestTask(ctx context.Context, username string) (*model.GithubMigrationTask, error) {
	var t model.GithubMigrationTask
	err := r.db.WithContext(ctx).
		Where("username = ?", username).
		Order("id DESC").
		First(&t).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// ResetForRetry 把任务重置为待执行。
// resetCursor=true 表示「重新迁移」：从头发起扫描（已被 github_migrated_prs 记录命中的会跳过）；
// resetCursor=false 表示失败续传：保留 cursor 从断点继续。
func (r *GithubMigrationRepo) ResetForRetry(ctx context.Context, id int64, resetCursor bool) error {
	updates := map[string]any{
		"status":     model.MigrationStatusPending,
		"error":      "",
		"updated_at": gorm.Expr("NOW()"),
	}
	if resetCursor {
		updates["cursor"] = nil
		updates["total_prs"] = 0
		updates["processed_prs"] = 0
	}
	return r.db.WithContext(ctx).
		Model(&model.GithubMigrationTask{}).
		Where("id = ?", id).
		Updates(updates).Error
}

// MarkFailed 投递失败等场景下把任务标记为失败
func (r *GithubMigrationRepo) MarkFailed(ctx context.Context, id int64, msg string) error {
	return r.db.WithContext(ctx).
		Model(&model.GithubMigrationTask{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"status":     model.MigrationStatusFailed,
			"error":      msg,
			"updated_at": gorm.Expr("NOW()"),
		}).Error
}

// HasMigratedPr 判断 PR 是否已被迁移（去重）
func (r *GithubMigrationRepo) HasMigratedPr(ctx context.Context, prNumber int) (bool, error) {
	var count int64
	if err := r.db.WithContext(ctx).
		Model(&model.GithubMigratedPr{}).
		Where("pr_number = ?", prNumber).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// CountMigratedPrs 统计该用户已迁移的 PR 数
func (r *GithubMigrationRepo) CountMigratedPrs(ctx context.Context, username string) (int64, error) {
	var count int64
	if err := r.db.WithContext(ctx).
		Model(&model.GithubMigratedPr{}).
		Where("username = ?", username).
		Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

// ListMigratedPrs 查询该用户已迁移的 PR（按 PR 号倒序，附带 PR 标题与对应稿件信息）。
// PR 标题取自迁移时写入 submissions.metadata 的 github_pr_title。
func (r *GithubMigrationRepo) ListMigratedPrs(ctx context.Context, username string, limit int) ([]model.GithubMigratedPrItem, error) {
	const q = `SELECT g.pr_number AS pr_number,
                      COALESCE(s.metadata->>'github_pr_title', '') AS pr_title,
                      g.submission_id AS submission_id,
                      COALESCE(s.title, '') AS submission_title,
                      COALESCE(s.file_name, '') AS file_name,
                      g.migrated_at AS migrated_at
               FROM github_migrated_prs g
               LEFT JOIN submissions s ON s.id = g.submission_id
               WHERE g.username = ?
               ORDER BY g.pr_number DESC
               LIMIT ?`
	items := make([]model.GithubMigratedPrItem, 0, limit)
	if err := r.db.WithContext(ctx).Raw(q, username, limit).Scan(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}
