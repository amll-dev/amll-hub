package service

import (
	"bytes"
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

// ErrApproveNeedsManualFix GitHub 已上传成功、但其后的对象存储步骤失败：
// 此时 DB 已置为 approved 且不能回滚（否则 GitHub 与 DB 更不一致），
// GitHub 新版本 / MinIO 旧版本 / DB approved 三者不一致且无自动补偿，
// 必须人工修复。该哨兵错误可被上层识别以便告警与人工介入。
var ErrApproveNeedsManualFix = errors.New("approve side effect after github upload requires manual fix")

// logApproveFailure 把 approve 失败原因结构化落日志，
// 便于按 stage / 投稿 / 失败原因筛选需要人工处理的记录。
func logApproveFailure(sub *model.Submission, stage string, cause error, extra logrus.Fields) {
	fields := logrus.Fields{
		"submission_id":  sub.ID,
		"file_name":      sub.FileName,
		"stage":          stage,
		"failure_reason": cause.Error(),
	}
	for k, v := range extra {
		fields[k] = v
	}
	logrus.WithFields(fields).Error("approve failed")
}

// ReviewInput 审核入参
type ReviewInput struct {
	Action  string `json:"action"`
	Comment string `json:"comment"`
}

// ReviewService 审核流程
type ReviewService struct {
	subRepo      *repository.SubmissionRepo
	historyRepo  *repository.ReviewHistoryRepo
	files        *FileService
	github       *GitHubService
	viewers      *ViewerService
	validate     *ValidateService
	notifier     Notifier
	db           *gorm.DB
	petitionSync func(ctx context.Context, submissionID int64) error
}

// SetNotifier 注入通知服务（main 装配阶段调用）
func (s *ReviewService) SetNotifier(n Notifier) {
	s.notifier = n
}

// SetValidateService 注入 TTML 校验服务（main 装配阶段调用）
func (s *ReviewService) SetValidateService(v *ValidateService) {
	s.validate = v
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
	// 请愿联动
	if s.petitionSync != nil {
		if err := s.petitionSync(ctx, sub.ID); err != nil {
			logrus.WithFields(logrus.Fields{
				"submission_id": sub.ID,
				"error":         err,
			}).Warn("sync petition status failed")
		}
	}
	// T1：审核结果通知投稿人（通知失败不影响审核流程）
	if s.notifier != nil {
		if err := s.notifier.NotifyReviewResult(ctx, sub, comment); err != nil {
			logrus.WithFields(logrus.Fields{
				"submission_id": sub.ID,
				"error":         err,
			}).Warn("notify review result failed")
		}
	}
	return nil
}

// SetPetitionSync 注入请愿状态同步
func (s *ReviewService) SetPetitionSync(fn func(ctx context.Context, submissionID int64) error) {
	s.petitionSync = fn
}

// MarkReviewing 审核员进入详情页时占用该投稿（status → reviewing）。
// 返回是否由 user 持有：他人已占用或状态不允许时返回 false，且不做任何抢占。
func (s *ReviewService) MarkReviewing(ctx context.Context, user *SubmissionUser, id int64) (bool, error) {
	sub, err := s.subRepo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, ErrSubmissionNotFound
		}
		return false, err
	}
	// 已由本人占用：只刷新心跳时间，避免重复变更状态
	if sub.Status == model.StatusReviewing && sub.Reviewer == user.Name {
		return s.subRepo.RefreshReviewLease(ctx, id, user.Name, time.Now())
	}
	// 仅 pending 状态可被占用；他人已占用或已到终态时保持原状
	if sub.Status != model.StatusPending {
		return false, nil
	}
	now := time.Now()
	sub.Status = model.StatusReviewing
	sub.Reviewer = user.Name
	sub.ReviewerInfo = &model.UserInfo{
		Username:    user.Name,
		DisplayName: user.DisplayName,
		Avatar:      user.Avatar,
	}
	sub.ReviewLeaseAt = &now
	ok, err := s.subRepo.UpdateStatusWhere(ctx, nil, sub, []string{model.StatusPending})
	if err != nil {
		return false, err
	}
	if !ok {
		// 并发下被其他审核员抢先占用
		return false, nil
	}
	if s.viewers != nil {
		_ = s.viewers.NotifySubmissionChanged(ctx, sub.ID)
	}
	return true, nil
}

// Heartbeat 刷新审核占用租约，返回当前是否仍由 user 持有以及投稿最新状态。
// 租约已超时被后台释放（或已被他人接管）时会尝试重新占用。
func (s *ReviewService) Heartbeat(ctx context.Context, user *SubmissionUser, id int64) (bool, string, error) {
	ok, err := s.subRepo.RefreshReviewLease(ctx, id, user.Name, time.Now())
	if err != nil {
		return false, "", err
	}
	if ok {
		return true, model.StatusReviewing, nil
	}
	// 租约失效：若投稿已回到 pending 则重新占用
	held, err := s.MarkReviewing(ctx, user, id)
	if err != nil {
		return false, "", err
	}
	sub, err := s.subRepo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, "", ErrSubmissionNotFound
		}
		return false, "", err
	}
	return held, sub.Status, nil
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
	sub.ReviewerInfo = nil
	sub.ReviewLeaseAt = nil
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

// claimAndRecord 在同一事务内原子完成「抢占状态 + 写审核历史」。
// 并发抢占与回滚的实现见 claim.go，审核与修订两条流程共用同一份。
func (s *ReviewService) claimAndRecord(ctx context.Context, sub *model.Submission, newStatus, comment string, reviewerInfo model.UserInfo, now time.Time, fromStatuses []string) error {
	sub.Status = newStatus
	sub.Reviewer = reviewerInfo.Username
	sub.ReviewerInfo = &reviewerInfo
	sub.ReviewedAt = &now
	// 审核结论已落定，占用租约不再需要
	sub.ReviewLeaseAt = nil
	if comment != "" {
		sub.ReviewComment = comment
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return claimAndRecord(ctx, tx, s.subRepo, s.historyRepo, sub, fromStatuses, &model.ReviewHistory{
			SubmissionID: sub.ID,
			Reviewer:     reviewerInfo.Username,
			ReviewerInfo: reviewerInfo,
			Status:       newStatus,
			Comment:      comment,
		}, nil)
	})
}

// revertClaim 外部副作用失败时回滚状态迁移（实现见 claim.go）。
func (s *ReviewService) revertClaim(ctx context.Context, sub *model.Submission, fromStatus string) {
	revertClaim(ctx, s.subRepo, sub, fromStatus, "revert review claim failed, manual fix required")
}

func (s *ReviewService) approve(ctx context.Context, sub *model.Submission, comment string, user *SubmissionUser, reviewerInfo model.UserInfo, now time.Time, fromStatuses []string) error {
	origStatus := sub.Status

	// 1. 文件名必须符合仓库命名规范（不合法时不产生任何状态变更）
	if err := ValidateRepoTTMLFileName(sub.FileName); err != nil {
		logApproveFailure(sub, "validate_filename", err, nil)
		return err
	}

	// 2. 原子抢占状态迁移权（并发审核员只有一个能成功）
	if err := s.claimAndRecord(ctx, sub, model.StatusApproved, comment, reviewerInfo, now, fromStatuses); err != nil {
		logApproveFailure(sub, "claim_and_record", err, nil)
		return err
	}

	// 3. 从 MinIO 拉取 TTML 内容并做服务端校验
	srcKey := PendingLyricKey(sub.FileName)
	reader, err := s.files.Get(ctx, srcKey)
	if err != nil {
		logApproveFailure(sub, "minio_get", err, nil)
		s.revertClaim(ctx, sub, origStatus)
		return fmt.Errorf("读取待审核文件失败: %w", err)
	}
	defer func() { _ = reader.Close() }()

	content, err := ReadTTMLLimited(reader, s.files.MaxTTMLSize())
	if err != nil {
		logApproveFailure(sub, "read_ttml", err, nil)
		s.revertClaim(ctx, sub, origStatus)
		return err
	}
	prepared, err := PrepareTTML(ctx, s.validate, content, !sub.IsUnrearranged)
	if err != nil {
		logApproveFailure(sub, "prepare_ttml", err, nil)
		s.revertClaim(ctx, sub, origStatus)
		return err
	}

	// 正常模式用重排结果覆盖待审核对象，保证对象存储与 GitHub 内容一致
	if !sub.IsUnrearranged {
		if err := s.files.UploadTTML(ctx, sub.FileName, prepared); err != nil {
			logApproveFailure(sub, "minio_overwrite", err, nil)
			s.revertClaim(ctx, sub, origStatus)
			return fmt.Errorf("保存重排歌词失败: %w", err)
		}
	}

	// 4. 上传到 GitHub
	if err := s.github.UploadFile(ctx, sub.FileName, bytes.NewReader(prepared), user.Name); err != nil {
		logApproveFailure(sub, "github_upload", err, logrus.Fields{"github_state": "not_uploaded"})
		s.revertClaim(ctx, sub, origStatus)
		return fmt.Errorf("上传 GitHub 失败: %w", err)
	}

	// 5. 对象存储内移动：tg-lyrics/ → shtg-lyrics/
	dstKey := ApprovedLyricKey(sub.FileName)
	if err := s.files.Move(ctx, srcKey, dstKey); err != nil {
		// GitHub 已上传成功，文件移动失败：不能回滚 DB（否则三处更不一致），
		// 保留 approved 状态；结构化落日志并返回可被识别的明确错误，便于人工修复。
		logApproveFailure(sub, "minio_move", err, logrus.Fields{
			"src_key":      srcKey,
			"dst_key":      dstKey,
			"github_state": "uploaded",
			"db_state":     model.StatusApproved,
			"manual_fix":   true,
		})
		return fmt.Errorf("%w: submission=%d, file=%s, src=%s, dst=%s, cause=%v",
			ErrApproveNeedsManualFix, sub.ID, sub.FileName, srcKey, dstKey, err)
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
