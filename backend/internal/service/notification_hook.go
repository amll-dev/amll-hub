package service

import (
	"context"

	"github.com/amll-dev/amll-hub/backend/internal/model"
)

// Notifier 通知钩子窄接口。
// SubmissionService / ReviewService / AutoRejectJob 通过 SetNotifier 注入，
// 不改构造函数签名；NotificationService 天然实现该接口。
// 放在 service 层而非 handler：审核员名单要查 repo，且 auto_reject job 没有 handler 层
type Notifier interface {
	// NotifyReviewResult 审核结果通知投稿人（approve/reject/revision/missing_audio）
	NotifyReviewResult(ctx context.Context, sub *model.Submission, comment string) error
	// NotifyNewComment 投稿收到他人评论时通知投稿人
	NotifyNewComment(ctx context.Context, sub *model.Submission, commenter string) error
	// NotifyAutoRejected 超时自动拒绝通知投稿人
	NotifyAutoRejected(ctx context.Context, sub *model.Submission) error
}
