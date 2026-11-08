package job

import (
	"context"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/sirupsen/logrus"
)

// runPeriodic 阻塞执行周期任务：启动后立即执行一次，之后每 interval 执行一次，直到 ctx 取消
func runPeriodic(
	ctx context.Context,
	name string,
	fields logrus.Fields,
	interval time.Duration,
	fn func(context.Context),
) {
	logFields := logrus.Fields{"interval": interval.String()}
	for k, v := range fields {
		logFields[k] = v
	}
	logrus.WithFields(logFields).Infof("%s job started", name)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	pkg.RunSafe(name, func() { fn(ctx) })
	for {
		select {
		case <-ctx.Done():
			logrus.Infof("%s job stopped", name)
			return
		case <-ticker.C:
			pkg.RunSafe(name, func() { fn(ctx) })
		}
	}
}
