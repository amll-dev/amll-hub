package job

import (
	"context"
	"time"

	"github.com/sirupsen/logrus"

	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/amll-dev/amll-hub/backend/internal/service"
)

// ReviewLeaseJob 审核占用租约清理任务。
// 审核员停留在详情页期间由前端定时心跳刷新 review_lease_at，
// 超过 ttl 未刷新（关标签页、崩溃、断网等无法发释放请求的情况）则回退为 pending。
type ReviewLeaseJob struct {
	subRepo  *repository.SubmissionRepo
	viewers  *service.ViewerService
	ttl      time.Duration
	interval time.Duration
}

// NewReviewLeaseJob 创建审核占用租约清理任务
func NewReviewLeaseJob(
	subRepo *repository.SubmissionRepo,
	viewers *service.ViewerService,
	ttl, interval time.Duration,
) *ReviewLeaseJob {
	if ttl <= 0 {
		ttl = 3 * time.Minute
	}
	if interval <= 0 {
		interval = 30 * time.Second
	}
	return &ReviewLeaseJob{
		subRepo:  subRepo,
		viewers:  viewers,
		ttl:      ttl,
		interval: interval,
	}
}

// Run 阻塞执行，每 interval 扫描一次，直到 ctx 取消
func (j *ReviewLeaseJob) Run(ctx context.Context) {
	logrus.WithFields(logrus.Fields{
		"interval": j.interval.String(),
		"ttl":      j.ttl.String(),
	}).Info("review-lease job started")

	ticker := time.NewTicker(j.interval)
	defer ticker.Stop()

	j.runOnce(ctx)

	for {
		select {
		case <-ctx.Done():
			logrus.Info("review-lease job stopped")
			return
		case <-ticker.C:
			j.runOnce(ctx)
		}
	}
}

func (j *ReviewLeaseJob) runOnce(ctx context.Context) {
	cutoff := time.Now().Add(-j.ttl)
	released, err := j.subRepo.ReleaseStaleReviewing(ctx, cutoff)
	if err != nil {
		logrus.WithError(err).Error("review-lease job failed")
		return
	}
	if len(released) == 0 {
		return
	}

	logrus.WithField("count", len(released)).Info("review-lease: released stale reviewing submissions")
	for i := range released {
		if j.viewers != nil {
			_ = j.viewers.NotifySubmissionChanged(ctx, released[i].ID)
		}
	}
}
