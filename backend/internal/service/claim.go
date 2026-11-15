package service

import (
	"context"
	"time"

	"github.com/sirupsen/logrus"
	"gorm.io/gorm"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
)

// 审核与修订两条流程原本各写了一份「抢占状态 + 回滚状态」的闭包，逐行相同。
// 这段代码是并发正确性的核心（乐观并发抢占 + 脱离取消的回滚），
// 复制两份后任何一处修复都可能漏掉另一处，所以统一到这里。

// claimStatus 以乐观并发控制抢占一次状态迁移。
// UPDATE ... WHERE id = ? AND status IN (fromStatuses) 只会命中一行，
// 并发请求里只有一个能拿到迁移权；抢不到返回 ErrInvalidStatus。
func claimStatus(ctx context.Context, tx *gorm.DB, subRepo *repository.SubmissionRepo, sub *model.Submission, fromStatuses []string) error {
	ok, err := subRepo.UpdateStatusWhere(ctx, tx, sub, fromStatuses)
	if err != nil {
		return err
	}
	if !ok {
		return ErrInvalidStatus
	}
	return nil
}

// claimAndRecord 在同一事务内原子完成「抢占状态 + 写审核历史」。
// extra 供调用方追加自己的记录（如审核报告、评论），可为 nil。
// 返回 ErrInvalidStatus 表示状态已被他人改走，调用方不得再执行外部副作用。
func claimAndRecord(
	ctx context.Context,
	tx *gorm.DB,
	subRepo *repository.SubmissionRepo,
	historyRepo *repository.ReviewHistoryRepo,
	sub *model.Submission,
	fromStatuses []string,
	history *model.ReviewHistory,
	extra func(tx *gorm.DB) error,
) error {
	if err := claimStatus(ctx, tx, subRepo, sub, fromStatuses); err != nil {
		return err
	}
	if err := historyRepo.Insert(ctx, tx, history); err != nil {
		return err
	}
	if extra != nil {
		return extra(tx)
	}
	return nil
}

// revertClaim 外部副作用失败时把投稿回滚到 restoreStatus。
// 用 pkg.DetachedTimeout 脱离请求取消：客户端断开后补偿仍必须执行，
// 否则投稿会停在「已审核」而外部系统里什么都没有。
// 只回滚仍处于终态（approved/rejected）的行，避免覆盖并发中已被推进的新状态。
func revertClaim(ctx context.Context, subRepo *repository.SubmissionRepo, sub *model.Submission, restoreStatus, logMsg string) {
	sub.Status = restoreStatus
	sub.Reviewer = ""
	sub.ReviewerInfo = nil
	sub.ReviewedAt = nil
	sub.ReviewComment = ""
	c, cancel := pkg.DetachedTimeout(ctx, 5*time.Second)
	defer cancel()
	ok, err := subRepo.UpdateStatusWhere(c, nil, sub, []string{model.StatusApproved, model.StatusRejected})
	if err != nil || !ok {
		logrus.WithFields(logrus.Fields{
			"submission_id": sub.ID,
			"target_status": restoreStatus,
			"err":           err,
		}).Error(logMsg)
	}
}
