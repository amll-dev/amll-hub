package pkg

import (
	"context"
	"time"
)

// DetachedTimeout 基于 ctx 中的值创建一个不受取消影响、但带超时的 context。
// 用于请求返回后的补偿、清理和异步通知，避免客户端断开导致这些操作被取消。
func DetachedTimeout(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), timeout)
}
