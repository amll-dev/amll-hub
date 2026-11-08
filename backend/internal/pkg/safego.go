package pkg

import (
	"fmt"
	"runtime/debug"

	"github.com/sirupsen/logrus"
)

// GoSafe 在独立 goroutine 中执行 fn，并捕获 panic，避免后台 goroutine 崩溃整个进程。
func GoSafe(name string, fn func()) {
	go func() {
		defer recoverBackground(name)
		fn()
	}()
}

// RunSafe 同步执行 fn 并捕获 panic，供已有的 goroutine 或周期任务单次执行使用。
func RunSafe(name string, fn func()) {
	defer recoverBackground(name)
	fn()
}

func recoverBackground(name string) {
	if r := recover(); r != nil {
		logrus.WithFields(logrus.Fields{
			"goroutine": name,
			"panic":     fmt.Sprint(r),
			"stack":     string(debug.Stack()),
		}).Error("background panic recovered")
	}
}
