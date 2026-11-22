package job

import (
	"context"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/sirupsen/logrus"
)

// DefaultSyncCheckInterval 定时同步检查间隔
const DefaultSyncCheckInterval = 5 * time.Minute

// syncTriggerTimeout 单次触发同步检查的超时（GitHub 请求 + DB 查询）
const syncTriggerTimeout = 30 * time.Second

// SyncScheduler 周期性比对远端 commit，有更新时向队列投递同步任务
type SyncScheduler struct {
	svc      *service.SyncService
	interval time.Duration
}

func NewSyncScheduler(svc *service.SyncService, interval time.Duration) *SyncScheduler {
	if interval <= 0 {
		interval = DefaultSyncCheckInterval
	}
	return &SyncScheduler{svc: svc, interval: interval}
}

func (j *SyncScheduler) Run(ctx context.Context) {
	runPeriodic(ctx, "sync-scheduler", nil, j.interval, func(ctx context.Context) {
		callCtx, cancel := context.WithTimeout(ctx, syncTriggerTimeout)
		defer cancel()

		result, err := j.svc.TriggerSync(callCtx, "cron")
		if err != nil {
			logrus.WithError(err).Warn("scheduled sync trigger failed")
			return
		}
		if result.Status == "syncing" {
			logrus.WithFields(logrus.Fields{
				"previous_commit": result.PreviousCommit,
				"target_commit":   result.TargetCommit,
			}).Info("scheduled sync triggered")
			return
		}
		logrus.WithField("status", result.Status).Debug("scheduled sync check done")
	})
}
