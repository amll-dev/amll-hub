package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/config"
	"github.com/amll-dev/amll-hub/backend/internal/infrastructure"
	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/sirupsen/logrus"
)

// MigrationUserMessage 投递到 migration.user 的消息体
type MigrationUserMessage struct {
	TaskID        int64          `json:"task_id"`
	Username      string         `json:"username"`
	SubmitterInfo model.UserInfo `json:"submitter_info"`
	GithubLogin   string         `json:"github_login"`
	GithubID      int64          `json:"github_id"`
	SincePrNumber int            `json:"since_pr_number"`
}

// MigrationStatus 迁移页状态概览
type MigrationStatus struct {
	Bound         bool                       `json:"bound"`
	GithubLogin   string                     `json:"githubLogin,omitempty"`
	GithubEmail   string                     `json:"githubEmail,omitempty"`
	GithubAvatar  string                     `json:"githubAvatar,omitempty"`
	BoundAt       *time.Time                 `json:"boundAt,omitempty"`
	HasActive     bool                       `json:"hasActive"`
	ActiveTask    *model.GithubMigrationTask `json:"activeTask,omitempty"`
	LatestTask    *model.GithubMigrationTask `json:"latestTask,omitempty"`
	StartPrNumber int                        `json:"startPrNumber"`
}

// MigrationList 已迁移 PR 列表（迁移页展示）
type MigrationList struct {
	Total int                          `json:"total"`
	Items []model.GithubMigratedPrItem `json:"items"`
}

// MigrationService 投稿数据迁移业务逻辑（后端只创建任务并投递 MQ）
type MigrationService struct {
	bindRepo *repository.GithubBindingRepo
	migRepo  *repository.GithubMigrationRepo
	mq       *infrastructure.RabbitMQ
	cfg      config.MigrationConfig
}

// NewMigrationService 创建 MigrationService
func NewMigrationService(
	bindRepo *repository.GithubBindingRepo,
	migRepo *repository.GithubMigrationRepo,
	mq *infrastructure.RabbitMQ,
	cfg config.MigrationConfig,
) *MigrationService {
	return &MigrationService{bindRepo: bindRepo, migRepo: migRepo, mq: mq, cfg: cfg}
}

// Status 返回绑定状态与最近任务概览
func (s *MigrationService) Status(ctx context.Context, username string) (*MigrationStatus, error) {
	binding, err := s.bindRepo.GetByUsername(ctx, username)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	st := &MigrationStatus{StartPrNumber: s.cfg.StartPrNumber}
	if binding != nil {
		st.Bound = true
		st.GithubLogin = binding.GithubLogin
		st.GithubEmail = binding.GithubEmail
		st.GithubAvatar = binding.GithubAvatar
		boundAt := binding.BoundAt
		st.BoundAt = &boundAt
	}

	active, err := s.migRepo.GetActiveTask(ctx, username)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	if active != nil {
		st.HasActive = true
		st.ActiveTask = active
	}

	latest, err := s.migRepo.GetLatestTask(ctx, username)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	st.LatestTask = latest
	return st, nil
}

// Start 创建迁移任务并投递 migration.user
func (s *MigrationService) Start(ctx context.Context, username string, submitter model.UserInfo) (*model.GithubMigrationTask, error) {
	binding, err := s.bindRepo.GetByUsername(ctx, username)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	if binding == nil {
		return nil, ErrNotBound
	}

	active, err := s.migRepo.GetActiveTask(ctx, username)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	if active != nil {
		return nil, ErrMigrationInProgress
	}

	task := &model.GithubMigrationTask{
		Username:      username,
		GithubLogin:   binding.GithubLogin,
		Status:        model.MigrationStatusPending,
		ClosePrStatus: model.MigrationStatusPending,
	}
	if err := s.migRepo.CreateTask(ctx, task); err != nil {
		return nil, fmt.Errorf("create migration task: %w", err)
	}
	if submitter.Username == "" {
		submitter.Username = username
	}
	if err := s.publish(ctx, task, binding.GithubID, submitter); err != nil {
		_ = s.migRepo.MarkFailed(ctx, task.ID, err.Error())
		return nil, err
	}
	return task, nil
}

// ListMigrated 查询该用户已迁移的 PR 列表与总数
func (s *MigrationService) ListMigrated(ctx context.Context, username string, limit int) (*MigrationList, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}

	total, err := s.migRepo.CountMigratedPrs(ctx, username)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	items, err := s.migRepo.ListMigratedPrs(ctx, username, limit)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	return &MigrationList{Total: int(total), Items: items}, nil
}

// GetTask 查询任务进度（仅本人）
func (s *MigrationService) GetTask(ctx context.Context, username string, id int64) (*model.GithubMigrationTask, error) {
	task, err := s.migRepo.GetTask(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	if task == nil || task.Username != username {
		return nil, ErrMigrationTaskNotFound
	}
	return task, nil
}

// Retry 重试任务：失败任务从 cursor 续传；已完成任务从头重新扫描（已迁移的会跳过）
func (s *MigrationService) Retry(ctx context.Context, username string, id int64, submitter model.UserInfo) (*model.GithubMigrationTask, error) {
	task, err := s.GetTask(ctx, username, id)
	if err != nil {
		return nil, err
	}
	if task.Status == model.MigrationStatusRunning || task.Status == model.MigrationStatusPending {
		return nil, ErrMigrationInProgress
	}

	binding, err := s.bindRepo.GetByUsername(ctx, username)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	if binding == nil {
		return nil, ErrNotBound
	}

	// 失败续传保留 cursor；已完成任务重新迁移则从头扫描
	resetCursor := task.Status == model.MigrationStatusCompleted
	if err := s.migRepo.ResetForRetry(ctx, task.ID, resetCursor); err != nil {
		return nil, fmt.Errorf("reset migration task: %w", err)
	}

	if submitter.Username == "" {
		submitter.Username = username
	}
	if err := s.publish(ctx, task, binding.GithubID, submitter); err != nil {
		_ = s.migRepo.MarkFailed(ctx, task.ID, err.Error())
		return nil, err
	}
	return s.GetTask(ctx, username, id)
}

// publish 投递迁移任务消息
func (s *MigrationService) publish(ctx context.Context, task *model.GithubMigrationTask, githubID int64, submitter model.UserInfo) error {
	msg := MigrationUserMessage{
		TaskID:        task.ID,
		Username:      task.Username,
		SubmitterInfo: submitter,
		GithubLogin:   task.GithubLogin,
		GithubID:      githubID,
		SincePrNumber: s.cfg.StartPrNumber,
	}
	body, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal migration message: %w", err)
	}
	if err := s.mq.PublishMigrationUser(body, fmt.Sprintf("migration.user:%d", task.ID)); err != nil {
		logrus.WithError(err).WithField("task_id", task.ID).Error("publish migration.user failed")
		return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	return nil
}
