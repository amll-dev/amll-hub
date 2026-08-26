package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/sirupsen/logrus"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"gorm.io/gorm"
)

// ReviewAction 审核动作
const (
	ActionApprove      = "approve"
	ActionReject       = "reject"
	ActionRevision     = "revision"
	ActionMissingAudio = "missing_audio"
)

// ReviewInput 审核入参
type ReviewInput struct {
	Action  string `json:"action"`
	Comment string `json:"comment"`
}

// ReviewService 审核流程
type ReviewService struct {
	subRepo     *repository.SubmissionRepo
	historyRepo *repository.ReviewHistoryRepo
	files       *FileService
	github      *GitHubService
	viewers     *ViewerService
	db          *gorm.DB
}

// NewReviewService 创建审核服务
func NewReviewService(
	subRepo *repository.SubmissionRepo,
	historyRepo *repository.ReviewHistoryRepo,
	files *FileService,
	github *GitHubService,
	viewers *ViewerService,
	db *gorm.DB,
) *ReviewService {
	return &ReviewService{
		subRepo:     subRepo,
		historyRepo: historyRepo,
		files:       files,
		github:      github,
		viewers:     viewers,
		db:          db,
	}
}

// Review 执行审核操作。
// 通过条件更新（乐观并发控制）先原子抢占状态迁移权，再执行外部副作用
// （GitHub 上传 / MinIO 移动删除），防止两个审核员并发操作造成双重提交
func (s *ReviewService) Review(ctx context.Context, user *SubmissionUser, id int64, in *ReviewInput) error {
	if err := validateAction(in.Action); err != nil {
		return err
	}

	// 加载投稿
	sub, err := s.subRepo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrSubmissionNotFound
		}
		return err
	}

	// 状态校验
	switch sub.Status {
	case model.StatusPending, model.StatusReviewing, model.StatusNeedRevision, model.StatusMissingAudio:
	default:
		return ErrInvalidStatus
	}

	now := time.Now()
	comment := sanitize(in.Comment, 2000)
	reviewerInfo := model.UserInfo{
		Username:    user.Name,
		DisplayName: user.DisplayName,
		Avatar:      user.Avatar,
	}
	fromStatuses := []string{model.StatusPending, model.StatusReviewing, model.StatusNeedRevision, model.StatusMissingAudio}

	switch in.Action {
	case ActionApprove:
		if err := s.approve(ctx, sub, comment, user, reviewerInfo, now, fromStatuses); err != nil {
			return err
		}
	case ActionReject:
		if err := s.reject(ctx, sub, comment, user, reviewerInfo, now, fromStatuses); err != nil {
			return err
		}
	case ActionRevision:
		if err := s.simpleTransition(ctx, sub, model.StatusNeedRevision, comment, user, reviewerInfo, now, fromStatuses, true); err != nil {
			return err
		}
	case ActionMissingAudio:
		if err := s.simpleTransition(ctx, sub, model.StatusMissingAudio, comment, user, reviewerInfo, now, fromStatuses, false); err != nil {
			return err
		}
	}
	// 广播状态
	if s.viewers != nil {
		_ = s.viewers.NotifySubmissionChanged(ctx, sub.ID)
	}
	return nil
}

// MarkReviewing 审核员进入详情页时将状态标记为审核中
func (s *ReviewService) MarkReviewing(ctx context.Context, user *SubmissionUser, id int64) error {
	sub, err := s.subRepo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrSubmissionNotFound
		}
		return err
	}
	// 仅 pending 状态需要变更，避免重复标记
	if sub.Status != model.StatusPending {
		return nil
	}
	sub.Status = model.StatusReviewing
	sub.Reviewer = user.Name
	ok, err := s.subRepo.UpdateStatusWhere(ctx, nil, sub, []string{model.StatusPending})
	if err != nil {
		return err
	}
	if !ok {
		// 其他审核员已抢先标记，幂等返回成功
		return nil
	}
	if s.viewers != nil {
		_ = s.viewers.NotifySubmissionChanged(ctx, sub.ID)
	}
	return nil
}

// ReleaseReview 审核员离开详情页时释放审核占用：
func (s *ReviewService) ReleaseReview(ctx context.Context, user *SubmissionUser, id int64) error {
	sub, err := s.subRepo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrSubmissionNotFound
		}
		return err
	}
	// 非自己标记的审核中状态不处理，避免影响他人
	if sub.Status != model.StatusReviewing || sub.Reviewer != user.Name {
		return nil
	}
	sub.Status = model.StatusPending
	sub.Reviewer = ""
	ok, err := s.subRepo.UpdateStatusWhere(ctx, nil, sub, []string{model.StatusReviewing})
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	if s.viewers != nil {
		_ = s.viewers.NotifySubmissionChanged(ctx, sub.ID)
	}
	return nil
}

// claimAndRecord 在同一事务内原子完成
func (s *ReviewService) claimAndRecord(ctx context.Context, sub *model.Submission, newStatus, comment string, reviewerInfo model.UserInfo, now time.Time, fromStatuses []string) error {
	sub.Status = newStatus
	sub.Reviewer = reviewerInfo.Username
	sub.ReviewedAt = &now
	if comment != "" {
		sub.ReviewComment = comment
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		ok, err := s.subRepo.UpdateStatusWhere(ctx, tx, sub, fromStatuses)
		if err != nil {
			return err
		}
		if !ok {
			return ErrInvalidStatus
		}
		return s.historyRepo.Insert(ctx, tx, &model.ReviewHistory{
			SubmissionID: sub.ID,
			Reviewer:     reviewerInfo.Username,
			ReviewerInfo: reviewerInfo,
			Status:       newStatus,
			Comment:      comment,
		})
	})
}

// revertClaim 外部副作用失败时回滚状态迁移
func (s *ReviewService) revertClaim(ctx context.Context, sub *model.Submission, fromStatus string) {
	sub.Status = fromStatus
	sub.Reviewer = ""
	sub.ReviewedAt = nil
	sub.ReviewComment = ""
	ok, err := s.subRepo.UpdateStatusWhere(ctx, nil, sub, []string{model.StatusApproved, model.StatusRejected})
	if err != nil || !ok {
		logrus.WithFields(logrus.Fields{
			"submission_id": sub.ID,
			"target_status": fromStatus,
			"err":           err,
		}).Error("revert review claim failed, manual fix required")
	}
}

func (s *ReviewService) approve(ctx context.Context, sub *model.Submission, comment string, user *SubmissionUser, reviewerInfo model.UserInfo, now time.Time, fromStatuses []string) error {
	origStatus := sub.Status

	// 1. 原子抢占状态迁移权（并发审核员只有一个能成功）
	if err := s.claimAndRecord(ctx, sub, model.StatusApproved, comment, reviewerInfo, now, fromStatuses); err != nil {
		return err
	}

	// 2. 从 MinIO 拉取 TTML 内容
	srcKey := PendingLyricKey(sub.FileName)
	reader, err := s.files.Get(ctx, srcKey)
	if err != nil {
		s.revertClaim(ctx, sub, origStatus)
		return fmt.Errorf("读取待审核文件失败: %w", err)
	}
	defer func() { _ = reader.Close() }()

	// 3. 上传到 GitHub
	if err := s.github.UploadFile(ctx, sub.FileName, reader, user.Name); err != nil {
		logrus.WithFields(logrus.Fields{
			"submission_id": sub.ID,
			"file":          sub.FileName,
			"error":         err,
		}).Error("github upload failed on approve")
		s.revertClaim(ctx, sub, origStatus)
		return fmt.Errorf("上传 GitHub 失败: %w", err)
	}

	// 4. 对象存储内移动：tg-lyrics/ → shtg-lyrics/
	dstKey := ApprovedLyricKey(sub.FileName)
	if err := s.files.Move(ctx, srcKey, dstKey); err != nil {
		logrus.WithFields(logrus.Fields{
			"submission_id": sub.ID,
			"src":           srcKey,
			"dst":           dstKey,
			"error":         err,
		}).Error("move object failed on approve")
		// GitHub 已上传成功，文件移动失败：保留 approved 状态并记录，等待人工修复
		return fmt.Errorf("移动对象存储文件失败（GitHub 已上传，需人工检查）: %w", err)
	}
	return nil
}

func (s *ReviewService) reject(ctx context.Context, sub *model.Submission, comment string, user *SubmissionUser, reviewerInfo model.UserInfo, now time.Time, fromStatuses []string) error {
	// 先原子抢占状态迁移权，再删除文件
	if err := s.claimAndRecord(ctx, sub, model.StatusRejected, comment, reviewerInfo, now, fromStatuses); err != nil {
		return err
	}

	// 删除对象存储中的待审核文件（best-effort）
	if err := s.files.Delete(ctx, PendingLyricKey(sub.FileName)); err != nil {
		logrus.WithFields(logrus.Fields{
			"submission_id": sub.ID,
			"error":         err,
		}).Warn("delete pending lyric on reject failed")
	}
	return nil
}

// simpleTransition 纯状态迁移（无外部存储副作用）：revision / missing_audio
func (s *ReviewService) simpleTransition(ctx context.Context, sub *model.Submission, newStatus, comment string, user *SubmissionUser, reviewerInfo model.UserInfo, now time.Time, fromStatuses []string, setRevisionAt bool) error {
	if setRevisionAt {
		sub.RevisionRequestedAt = &now
	}
	return s.claimAndRecord(ctx, sub, newStatus, comment, reviewerInfo, now, fromStatuses)
}

func validateAction(action string) error {
	switch action {
	case ActionApprove, ActionReject, ActionRevision, ActionMissingAudio:
		return nil
	}
	return fmt.Errorf("invalid review action: %s", action)
}
