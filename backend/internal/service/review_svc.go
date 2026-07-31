package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

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

// Review 执行审核操作
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

	switch in.Action {
	case ActionApprove:
		if err := s.approve(ctx, sub, comment, user, reviewerInfo, now); err != nil {
			return err
		}
	case ActionReject:
		if err := s.reject(ctx, sub, comment, user, reviewerInfo, now); err != nil {
			return err
		}
	case ActionRevision:
		if err := s.revision(ctx, sub, comment, user, reviewerInfo, now); err != nil {
			return err
		}
	case ActionMissingAudio:
		if err := s.missingAudio(ctx, sub, comment, user, reviewerInfo, now); err != nil {
			return err
		}
	}
	// 广播状态
	if s.viewers != nil {
		_ = s.viewers.NotifySubmissionChanged(ctx, sub.ID)
	}
	return nil
}

func (s *ReviewService) approve(ctx context.Context, sub *model.Submission, comment string, user *SubmissionUser, reviewerInfo model.UserInfo, now time.Time) error {
	// 1. 从 MinIO 拉取 TTML 内容
	srcKey := PendingLyricKey(sub.FileName)
	reader, err := s.files.Get(ctx, srcKey)
	if err != nil {
		return fmt.Errorf("读取待审核文件失败: %w", err)
	}
	defer func() { _ = reader.Close() }()

	// 2. 上传到 GitHub
	if err := s.github.UploadFile(ctx, sub.FileName, reader, user.Name); err != nil {
		slog.Error("github upload failed on approve",
			"submission_id", sub.ID,
			"file", sub.FileName,
			"error", err,
		)
		return fmt.Errorf("上传 GitHub 失败: %w", err)
	}

	// 4. 对象存储内移动：tg-lyrics/ → shtg-lyrics/
	dstKey := ApprovedLyricKey(sub.FileName)
	if err := s.files.Move(ctx, srcKey, dstKey); err != nil {
		slog.Error("move object failed on approve",
			"submission_id", sub.ID,
			"src", srcKey,
			"dst", dstKey,
			"error", err,
		)
		// GitHub 已上传成功，文件移动失败：状态不修改，等待人工修复
		return fmt.Errorf("移动对象存储文件失败（GitHub 已上传，需人工检查）: %w", err)
	}

	// 5. 事务更新状态 + 审核历史
	sub.Status = model.StatusApproved
	sub.Reviewer = user.Name
	sub.ReviewedAt = &now
	if comment != "" {
		sub.ReviewComment = comment
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.subRepo.UpdateStatus(ctx, tx, sub); err != nil {
			return err
		}
		return s.historyRepo.Insert(ctx, tx, &model.ReviewHistory{
			SubmissionID: sub.ID,
			Reviewer:     user.Name,
			ReviewerInfo: reviewerInfo,
			Status:       model.StatusApproved,
			Comment:      comment,
		})
	})
}

func (s *ReviewService) reject(ctx context.Context, sub *model.Submission, comment string, user *SubmissionUser, reviewerInfo model.UserInfo, now time.Time) error {
	// 删除对象存储中的待审核文件
	_ = s.files.Delete(ctx, PendingLyricKey(sub.FileName))

	sub.Status = model.StatusRejected
	sub.Reviewer = user.Name
	sub.ReviewedAt = &now
	if comment != "" {
		sub.ReviewComment = comment
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.subRepo.UpdateStatus(ctx, tx, sub); err != nil {
			return err
		}
		return s.historyRepo.Insert(ctx, tx, &model.ReviewHistory{
			SubmissionID: sub.ID,
			Reviewer:     user.Name,
			ReviewerInfo: reviewerInfo,
			Status:       model.StatusRejected,
			Comment:      comment,
		})
	})
}

func (s *ReviewService) revision(ctx context.Context, sub *model.Submission, comment string, user *SubmissionUser, reviewerInfo model.UserInfo, now time.Time) error {
	sub.Status = model.StatusNeedRevision
	sub.Reviewer = user.Name
	sub.ReviewedAt = &now
	sub.RevisionRequestedAt = &now
	if comment != "" {
		sub.ReviewComment = comment
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.subRepo.UpdateStatus(ctx, tx, sub); err != nil {
			return err
		}
		return s.historyRepo.Insert(ctx, tx, &model.ReviewHistory{
			SubmissionID: sub.ID,
			Reviewer:     user.Name,
			ReviewerInfo: reviewerInfo,
			Status:       model.StatusNeedRevision,
			Comment:      comment,
		})
	})
}

func (s *ReviewService) missingAudio(ctx context.Context, sub *model.Submission, comment string, user *SubmissionUser, reviewerInfo model.UserInfo, now time.Time) error {
	sub.Status = model.StatusMissingAudio
	sub.Reviewer = user.Name
	sub.ReviewedAt = &now
	if comment != "" {
		sub.ReviewComment = comment
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.subRepo.UpdateStatus(ctx, tx, sub); err != nil {
			return err
		}
		return s.historyRepo.Insert(ctx, tx, &model.ReviewHistory{
			SubmissionID: sub.ID,
			Reviewer:     user.Name,
			ReviewerInfo: reviewerInfo,
			Status:       model.StatusMissingAudio,
			Comment:      comment,
		})
	})
}

func validateAction(action string) error {
	switch action {
	case ActionApprove, ActionReject, ActionRevision, ActionMissingAudio:
		return nil
	}
	return fmt.Errorf("invalid review action: %s", action)
}
