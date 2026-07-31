package job

import (
	"context"
	"log/slog"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"gorm.io/gorm"
)

// AutoRejectJob 自动拒绝任务
type AutoRejectJob struct {
	db          *gorm.DB
	subRepo     *repository.SubmissionRepo
	historyRepo *repository.ReviewHistoryRepo
	files       *service.FileService
	viewers     *service.ViewerService
	after       time.Duration
	interval    time.Duration
}

// NewAutoRejectJob 创建自动拒绝任务
func NewAutoRejectJob(
	db *gorm.DB,
	subRepo *repository.SubmissionRepo,
	historyRepo *repository.ReviewHistoryRepo,
	files *service.FileService,
	viewers *service.ViewerService,
	after, interval time.Duration,
) *AutoRejectJob {
	if interval <= 0 {
		interval = time.Hour
	}
	if after <= 0 {
		after = 96 * time.Hour // 4 天
	}
	return &AutoRejectJob{
		db:          db,
		subRepo:     subRepo,
		historyRepo: historyRepo,
		files:       files,
		viewers:     viewers,
		after:       after,
		interval:    interval,
	}
}

// Run 阻塞执行，每 interval 执行一次扫描，直到 ctx 取消
func (j *AutoRejectJob) Run(ctx context.Context) {
	slog.Info("auto-reject job started",
		"interval", j.interval.String(),
		"after", j.after.String(),
	)
	ticker := time.NewTicker(j.interval)
	defer ticker.Stop()

	// 启动后立即执行一次
	j.runOnce(ctx)

	for {
		select {
		case <-ctx.Done():
			slog.Info("auto-reject job stopped")
			return
		case <-ticker.C:
			j.runOnce(ctx)
		}
	}
}

func (j *AutoRejectJob) runOnce(ctx context.Context) {
	cutoff := time.Now().Add(-j.after)

	var affected []model.Submission
	err := j.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		items, err := j.subRepo.AutoReject(ctx, tx, cutoff)
		if err != nil {
			return err
		}
		affected = items
		// 插入审核历史
		for i := range items {
			h := &model.ReviewHistory{
				SubmissionID: items[i].ID,
				Reviewer:     "system",
				ReviewerInfo: model.UserInfo{Username: "system", DisplayName: "系统"},
				Status:       model.StatusRejected,
				Comment:      "[系统自动处理] 超过4天未修改，自动拒绝。",
			}
			if err := j.historyRepo.Insert(ctx, tx, h); err != nil {
				slog.Warn("auto-reject: insert review history failed",
					"submission_id", items[i].ID,
					"error", err,
				)
			}
		}
		return nil
	})
	if err != nil {
		slog.Error("auto-reject job failed", "error", err)
		return
	}

	if len(affected) == 0 {
		return
	}

	slog.Info("auto-reject: marked submissions as rejected",
		"count", len(affected),
	)

	// 删除对象存储中的待审核文件 + 通知状态变更
	for i := range affected {
		fileName := affected[i].FileName
		if fileName != "" {
			if err := j.files.Delete(ctx, service.PendingLyricKey(fileName)); err != nil {
				slog.Warn("auto-reject: delete file failed",
					"submission_id", affected[i].ID,
					"file", fileName,
					"error", err,
				)
			}
		}
		if j.viewers != nil {
			_ = j.viewers.NotifySubmissionChanged(ctx, affected[i].ID)
		}
	}
}
