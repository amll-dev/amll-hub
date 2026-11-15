package job

import (
	"context"
	"time"

	"github.com/sirupsen/logrus"

	"github.com/amll-dev/amll-hub/backend/internal/service"
)

// 临时对象清理的默认参数。
const (
	// DefaultTempObjectTTL 临时对象保留时长，超过后视为孤儿
	DefaultTempObjectTTL = 24 * time.Hour
	// DefaultTempCleanupInterval 扫描间隔
	DefaultTempCleanupInterval = time.Hour
)

// TempObjectCleanupJob 清理投稿保存过程中残留的临时 TTML 对象。
// 投稿保存会先写 tg-lyrics/.tmp-* 临时对象，事务成功后再 Move 到正式 key；
// 事务失败、进程崩溃或删除失败时这些对象无人引用，按 TTL 定期回收。
type TempObjectCleanupJob struct {
	files    *service.FileService
	ttl      time.Duration
	interval time.Duration
}

// NewTempObjectCleanupJob 创建临时对象清理任务
func NewTempObjectCleanupJob(
	files *service.FileService,
	ttl, interval time.Duration,
) *TempObjectCleanupJob {
	if ttl <= 0 {
		ttl = DefaultTempObjectTTL
	}
	if interval <= 0 {
		interval = DefaultTempCleanupInterval
	}
	return &TempObjectCleanupJob{files: files, ttl: ttl, interval: interval}
}

// Run 阻塞执行，每 interval 扫描一次，直到 ctx 取消
func (j *TempObjectCleanupJob) Run(ctx context.Context) {
	runPeriodic(ctx, "temp-object-cleanup", logrus.Fields{
		"ttl":    j.ttl.String(),
		"prefix": service.TempLyricsPrefix,
	}, j.interval, j.runOnce)
}

func (j *TempObjectCleanupJob) runOnce(ctx context.Context) {
	// 单次扫描限时，避免 MinIO 异常时占住任务
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	objects, err := j.files.ListTempObjects(ctx)
	if err != nil {
		logrus.WithError(err).Error("temp-object-cleanup: list temp objects failed")
		return
	}

	cutoff := time.Now().Add(-j.ttl)
	removed, failed := 0, 0
	var freed int64
	for _, obj := range objects {
		if obj.LastModified.After(cutoff) {
			continue
		}
		if err := j.files.Delete(ctx, obj.Key); err != nil {
			failed++
			logrus.WithError(err).WithField("key", obj.Key).Warn("temp-object-cleanup: delete failed")
			continue
		}
		removed++
		freed += obj.Size
	}

	if removed == 0 && failed == 0 {
		return
	}
	logrus.WithFields(logrus.Fields{
		"removed": removed,
		"failed":  failed,
		"bytes":   freed,
	}).Info("temp-object-cleanup: removed orphan temp objects")
}
