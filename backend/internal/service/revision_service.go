package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/sirupsen/logrus"
	"gorm.io/gorm"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
)

// RevisionService 审核员修订版流程
type RevisionService struct {
	subRepo     *repository.SubmissionRepo
	historyRepo *repository.ReviewHistoryRepo
	reportRepo  *repository.ReviewReportRepo
	commentRepo *repository.CommentRepo
	audioRepo   *repository.AudioRepo
	files       *FileService
	github      *GitHubService
	viewers     *ViewerService
	notifier    Notifier
	db          *gorm.DB
}

// SetNotifier 注入通知服务（main 装配阶段调用）
func (s *RevisionService) SetNotifier(n Notifier) {
	s.notifier = n
}

// NewRevisionService 创建审核修订服务
func NewRevisionService(
	subRepo *repository.SubmissionRepo,
	historyRepo *repository.ReviewHistoryRepo,
	reportRepo *repository.ReviewReportRepo,
	commentRepo *repository.CommentRepo,
	audioRepo *repository.AudioRepo,
	files *FileService,
	github *GitHubService,
	viewers *ViewerService,
	db *gorm.DB,
) *RevisionService {
	return &RevisionService{
		subRepo:     subRepo,
		historyRepo: historyRepo,
		reportRepo:  reportRepo,
		commentRepo: commentRepo,
		audioRepo:   audioRepo,
		files:       files,
		github:      github,
		viewers:     viewers,
		db:          db,
	}
}

// SaveRevisionInput 审核员保存修订版入参
type SaveRevisionInput struct {
	UploadTTML  bool           `json:"uploadTtml"`
	TTMLContent string         `json:"ttmlContent"`
	Metadata    map[string]any `json:"metadata"`
	ReportMD    string         `json:"reportMd"`
	Structured  map[string]any `json:"structured"`
	Comment     string         `json:"comment"`
	Action      string         `json:"action"`
	HasEdit     bool           `json:"hasEdit"`
}

// SaveRevision 审核员在编辑器中上传
func (s *RevisionService) SaveRevision(ctx context.Context, user *SubmissionUser, id int64, in *SaveRevisionInput) error {
	sub, err := s.subRepo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrSubmissionNotFound
		}
		return err
	}
	switch sub.Status {
	case model.StatusPending, model.StatusReviewing, model.StatusNeedRevision, model.StatusMissingAudio:
	default:
		return ErrInvalidStatus
	}

	reviewerInfo := model.UserInfo{
		Username:    user.Name,
		DisplayName: user.DisplayName,
		Avatar:      user.Avatar,
	}
	reportMD := strings.TrimSpace(in.ReportMD)
	comment := sanitize(in.Comment, 500)

	// 不上传修订版：只发报告
	if !in.UploadTTML {
		return s.saveWithoutRevision(ctx, sub, user, reviewerInfo, reportMD, comment, in)
	}
	return s.saveWithRevision(ctx, sub, user, reviewerInfo, reportMD, comment, in)
}

// saveWithRevision 写入修订版并把投稿推到 revised 待确认
func (s *RevisionService) saveWithRevision(
	ctx context.Context,
	sub *model.Submission,
	user *SubmissionUser,
	reviewerInfo model.UserInfo,
	reportMD, comment string,
	in *SaveRevisionInput,
) error {
	if sub.FileName == "" {
		return ErrMissingFile
	}
	if strings.TrimSpace(in.TTMLContent) == "" {
		return fmt.Errorf("%w: 修订版 TTML 内容为空", ErrInvalidInput)
	}

	// 先落对象存储
	key, err := s.files.UploadRevisionTTML(ctx, sub.FileName, []byte(in.TTMLContent))
	if err != nil {
		return fmt.Errorf("上传修订版失败: %w", err)
	}

	now := time.Now()
	ttmlContent := in.TTMLContent
	metadata := model.JSONObject{}
	if in.Metadata != nil {
		metadata = model.JSONObject(in.Metadata)
	}
	sub.Status = model.StatusRevised
	sub.Reviewer = reviewerInfo.Username
	sub.ReviewedAt = &now
	if comment != "" {
		sub.ReviewComment = comment
	}
	sub.RevisionFileKey = key
	sub.RevisionTTML = &ttmlContent
	sub.RevisionMetadata = metadata
	sub.RevisionAt = &now
	sub.RevisionReviewer = reviewerInfo.Username
	info := reviewerInfo
	sub.RevisionReviewerInfo = &info

	fromStatuses := []string{
		model.StatusPending,
		model.StatusReviewing,
		model.StatusNeedRevision,
		model.StatusMissingAudio,
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		ok, err := s.subRepo.UpdateStatusWhere(ctx, tx, sub, fromStatuses)
		if err != nil {
			return err
		}
		if !ok {
			return ErrInvalidStatus
		}
		if err := s.historyRepo.Insert(ctx, tx, &model.ReviewHistory{
			SubmissionID: sub.ID,
			Reviewer:     reviewerInfo.Username,
			ReviewerInfo: reviewerInfo,
			Status:       model.StatusRevised,
			Comment:      comment,
		}); err != nil {
			return err
		}
		if err := s.reportRepo.Insert(ctx, tx, &model.ReviewReport{
			SubmissionID: sub.ID,
			Reviewer:     reviewerInfo.Username,
			ReviewerInfo: reviewerInfo,
			Action:       ActionRevision,
			HasRevision:  true,
			ReportMD:     reportMD,
			Structured:   toJSONObject(in.Structured),
		}); err != nil {
			return err
		}
		return s.postReportToComments(ctx, sub.ID, reviewerInfo, reportMD, comment)
	})
	if err != nil {
		return err
	}

	s.broadcast(ctx, sub.ID)
	s.notifyReviewResult(ctx, sub, comment)
	return nil
}

// saveWithoutRevision 未上传修订版：只发报告
func (s *RevisionService) saveWithoutRevision(
	ctx context.Context,
	sub *model.Submission,
	user *SubmissionUser,
	reviewerInfo model.UserInfo,
	reportMD, comment string,
	in *SaveRevisionInput,
) error {
	action := in.Action
	if action == "" {
		action = ActionApprove
	}
	if err := validateAction(action); err != nil {
		return err
	}
	// 上传修订版才进revised，未上传时 revised 无意义
	if action == ActionRevision && !in.UploadTTML {
		action = ActionApprove
	}

	now := time.Now()
	sub.Reviewer = reviewerInfo.Username
	sub.ReviewedAt = &now
	if comment != "" {
		sub.ReviewComment = comment
	}
	fromStatuses := []string{
		model.StatusPending,
		model.StatusReviewing,
		model.StatusNeedRevision,
		model.StatusMissingAudio,
	}

	// 结论涉及的外部副作用（GitHub 上传 / 对象存储移动）复用 ReviewService 的实现，
	// 这里只负责额外把报告与评论写进同一个事务。
	claim := func(tx *gorm.DB) error {
		ok, err := s.subRepo.UpdateStatusWhere(ctx, tx, sub, fromStatuses)
		if err != nil {
			return err
		}
		if !ok {
			return ErrInvalidStatus
		}
		if err := s.historyRepo.Insert(ctx, tx, &model.ReviewHistory{
			SubmissionID: sub.ID,
			Reviewer:     reviewerInfo.Username,
			ReviewerInfo: reviewerInfo,
			Status:       action,
			Comment:      comment,
		}); err != nil {
			return err
		}
		if err := s.reportRepo.Insert(ctx, tx, &model.ReviewReport{
			SubmissionID: sub.ID,
			Reviewer:     reviewerInfo.Username,
			ReviewerInfo: reviewerInfo,
			Action:       action,
			HasRevision:  false,
			ReportMD:     reportMD,
			Structured:   toJSONObject(in.Structured),
		}); err != nil {
			return err
		}
		return s.postReportToComments(ctx, sub.ID, reviewerInfo, reportMD, comment)
	}

	switch action {
	case ActionApprove, ActionReject:
		// 这两个会触发 GitHub 上传 / 文件删除等外部副作用，必须在事务提交后执行
		// 先占位记录状态与报告，再由 ReviewService 完成文件搬运；
		// 若搬运失败，状态会被 revertClaim 回滚，报告记录保留（便于追溯）
		if err := s.db.WithContext(ctx).Transaction(claim); err != nil {
			return err
		}
		if err := s.applyConclusionSideEffects(ctx, sub, action, user); err != nil {
			return err
		}
	default:
		if action == ActionRevision {
			sub.RevisionRequestedAt = &now
		}
		sub.Status = action
		if err := s.db.WithContext(ctx).Transaction(claim); err != nil {
			return err
		}
	}

	s.broadcast(ctx, sub.ID)
	s.notifyReviewResult(ctx, sub, comment)
	return nil
}

// applyConclusionSideEffects 完成 approve/reject 的外部副作用
// 与 review_service.approve/reject 保持同样的顺序：先推 GitHub，再搬对象存储
func (s *RevisionService) applyConclusionSideEffects(ctx context.Context, sub *model.Submission, action string, user *SubmissionUser) error {
	if action != ActionApprove {
		// reject：删除待审核文件（best-effort，失败不影响结论）
		if err := s.files.Delete(ctx, PendingLyricKey(sub.FileName)); err != nil {
			logrus.WithFields(logrus.Fields{
				"submission_id": sub.ID,
				"error":         err,
			}).Warn("delete pending lyric on reject failed")
		}
		return nil
	}

	reader, err := s.files.Get(ctx, PendingLyricKey(sub.FileName))
	if err != nil {
		return fmt.Errorf("读取待审核文件失败: %w", err)
	}
	defer func() { _ = reader.Close() }()

	if err := s.github.UploadFile(ctx, sub.FileName, reader, user.Name); err != nil {
		logrus.WithFields(logrus.Fields{
			"submission_id": sub.ID,
			"file":          sub.FileName,
			"error":         err,
		}).Error("github upload failed on approve")
		return fmt.Errorf("上传 GitHub 失败: %w", err)
	}

	if err := s.files.Move(ctx, PendingLyricKey(sub.FileName), ApprovedLyricKey(sub.FileName)); err != nil {
		// GitHub 已成功，保留 approved 状态等待人工修复
		return fmt.Errorf("移动对象存储文件失败（GitHub 已上传，需人工检查）: %w", err)
	}
	return nil
}

// AdoptRevision 投稿者确认采用审核员的修订版，直接视为通过
func (s *RevisionService) AdoptRevision(ctx context.Context, user *SubmissionUser, id int64) error {
	sub, err := s.subRepo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrSubmissionNotFound
		}
		return err
	}
	// 只有投稿者本人能确认
	if sub.Submitter != user.Name {
		return ErrForbidden
	}
	if sub.Status != model.StatusRevised {
		return ErrInvalidStatus
	}
	if sub.RevisionFileKey == "" {
		return ErrMissingFile
	}

	now := time.Now()
	// 修订版快照：清空字段前先留一份，推 GitHub 失败时 revertAdopt 要靠它恢复
	revSnapshot := sub.SnapshotRevision()
	sub.Status = model.StatusApproved
	sub.ReviewedAt = &now
	sub.ClearRevision()

	ok, err := s.subRepo.UpdateStatusWhere(ctx, nil, sub, []string{model.StatusRevised})
	if err != nil {
		return err
	}
	if !ok {
		return ErrInvalidStatus
	}

	// 推 GitHub：使用修订版内容
	reader, err := s.files.Get(ctx, sub.RevisionFileKey)
	if err != nil {
		s.revertAdopt(ctx, sub, revSnapshot)
		return fmt.Errorf("读取修订版文件失败: %w", err)
	}
	defer func() { _ = reader.Close() }()

	if err := s.github.UploadFile(ctx, sub.FileName, reader, sub.RevisionReviewer); err != nil {
		logrus.WithFields(logrus.Fields{
			"submission_id": sub.ID,
			"file":          sub.FileName,
			"error":         err,
		}).Error("github upload failed on adopt revision")
		s.revertAdopt(ctx, sub, revSnapshot)
		return fmt.Errorf("上传 GitHub 失败: %w", err)
	}

	// 修订版晋升为正式文件，待审核区的原始文件清理掉
	if err := s.files.Move(ctx, sub.RevisionFileKey, ApprovedLyricKey(sub.FileName)); err != nil {
		return fmt.Errorf("移动修订版到正式目录失败（GitHub 已上传，需人工检查）: %w", err)
	}
	if err := s.files.Delete(ctx, PendingLyricKey(sub.FileName)); err != nil {
		logrus.WithFields(logrus.Fields{
			"submission_id": sub.ID,
			"error":         err,
		}).Warn("delete original pending lyric after adopt failed")
	}

	// 采纳记录进审核历史
	if err := s.historyRepo.Insert(ctx, nil, &model.ReviewHistory{
		SubmissionID: sub.ID,
		Reviewer:     sub.RevisionReviewer,
		ReviewerInfo: userInfoOrEmpty(sub.RevisionReviewerInfo),
		Status:       model.StatusApproved,
		Comment:      "投稿者确认采用审核员修订版",
	}); err != nil {
		logrus.WithError(err).Warn("insert adopt history failed")
	}

	s.broadcast(ctx, sub.ID)
	return nil
}

// revertAdopt 外部副作用失败时回滚 adopted 状态
func (s *RevisionService) revertAdopt(ctx context.Context, sub *model.Submission, saved *model.Submission) {
	sub.Status = model.StatusRevised
	sub.ReviewedAt = nil
	sub.RestoreRevision(saved)
	ok, err := s.subRepo.UpdateStatusWhere(ctx, nil, sub, []string{model.StatusApproved})
	if err != nil || !ok {
		logrus.WithFields(logrus.Fields{
			"submission_id": sub.ID,
			"error":         err,
		}).Error("revert adopt revision failed, manual fix required")
	}
}

// RejectRevision 投稿者选择保留原版，退回需修改状态
func (s *RevisionService) RejectRevision(ctx context.Context, user *SubmissionUser, id int64, reason string) error {
	sub, err := s.subRepo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrSubmissionNotFound
		}
		return err
	}
	if sub.Submitter != user.Name {
		return ErrForbidden
	}
	if sub.Status != model.StatusRevised {
		return ErrInvalidStatus
	}

	now := time.Now()
	comment := sanitize(reason, 500)
	sub.Status = model.StatusNeedRevision
	sub.RevisionRequestedAt = &now
	sub.ReviewedAt = &now
	sub.ClearRevision()
	ok, err := s.subRepo.UpdateStatusWhere(ctx, nil, sub, []string{model.StatusRevised})
	if err != nil {
		return err
	}
	if !ok {
		return ErrInvalidStatus
	}

	if comment != "" {
		if err := s.commentRepo.Insert(ctx, &model.Comment{
			SubmissionID: sub.ID,
			Author: model.UserInfo{
				Username:    user.Name,
				DisplayName: user.DisplayName,
				Avatar:      user.Avatar,
			},
			Content: comment,
		}); err != nil {
			// 评论写失败不该回滚状态变更
			logrus.WithFields(logrus.Fields{
				"submission_id": sub.ID,
				"error":         err,
			}).Warn("insert submitter comment after keeping own revision failed")
		}
	}

	s.broadcast(ctx, sub.ID)
	return nil
}

// GetRevisionContent 读取审核员修订版 TTML 原文
// 投稿者本人与审核员均可查看，用于详情页对比。
func (s *RevisionService) GetRevisionContent(ctx context.Context, user *SubmissionUser, id int64) (string, error) {
	sub, err := s.subRepo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", ErrSubmissionNotFound
		}
		return "", err
	}
	if sub.Submitter != user.Name {
		return "", ErrForbidden
	}
	if sub.RevisionTTML == nil || *sub.RevisionTTML == "" {
		return "", ErrFileNotFound
	}
	return *sub.RevisionTTML, nil
}

// EditorContext 审核员进入编辑器所需的上下文
type EditorContext struct {
	// TTML 原始投稿文件内容
	TTML string `json:"ttml"`
	// FileName 投稿文件名
	FileName string `json:"fileName"`
	// Audios 投稿关联的上传音频
	Audios []*model.SubmissionAudio `json:"audios"`
	// NcmID 网易云歌曲 ID
	NcmID string `json:"ncmId"`
	// Status 当前状态
	Status string `json:"status"`
	// HasRevision 是否已存在待确认的修订版
	HasRevision bool `json:"hasRevision"`
}

// GetEditorContext 审核员打开编辑器时拉取上下文
func (s *RevisionService) GetEditorContext(ctx context.Context, id int64) (*EditorContext, error) {
	sub, err := s.subRepo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSubmissionNotFound
		}
		return nil, err
	}
	if sub.FileName == "" {
		return nil, ErrMissingFile
	}
	reader, err := s.files.Get(ctx, PendingLyricKey(sub.FileName))
	if err != nil {
		return nil, ErrFileNotFound
	}
	defer reader.Close()
	raw, err := readAllString(reader)
	if err != nil {
		return nil, fmt.Errorf("read ttml: %w", err)
	}

	audios, err := s.audioRepo.ListBySubmissionID(ctx, id)
	if err != nil {
		return nil, err
	}
	return &EditorContext{
		TTML:        raw,
		FileName:    sub.FileName,
		Audios:      audios,
		NcmID:       firstNonEmpty(sub.NcmID, extractPlatformId(map[string]any(sub.Metadata), "ncm_music_id")),
		Status:      sub.Status,
		HasRevision: sub.RevisionFileKey != "",
	}, nil
}

// firstNonEmpty 返回首个非空字符串，用于多来源字段的兜底
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}

// postReportToComments 把审核报告发到评论区
func (s *RevisionService) postReportToComments(
	ctx context.Context,
	submissionID int64,
	reviewerInfo model.UserInfo,
	reportMD, comment string,
) error {
	content := strings.TrimSpace(comment)
	if reportMD != "" {
		if content != "" {
			content += "\n\n"
		}
		content += reportMD
	}
	if content == "" {
		// 报告和说明都为空时不留空评论
		return nil
	}
	return s.commentRepo.Insert(ctx, &model.Comment{
		SubmissionID: submissionID,
		Author:       reviewerInfo,
		Content:      content,
	})
}

func (s *RevisionService) broadcast(ctx context.Context, id int64) {
	if s.viewers != nil {
		_ = s.viewers.NotifySubmissionChanged(ctx, id)
	}
}

func (s *RevisionService) notifyReviewResult(ctx context.Context, sub *model.Submission, comment string) {
	if s.notifier == nil {
		return
	}
	if err := s.notifier.NotifyReviewResult(ctx, sub, comment); err != nil {
		logrus.WithFields(logrus.Fields{
			"submission_id": sub.ID,
			"error":         err,
		}).Warn("notify review result failed")
	}
}

func toJSONObject(m map[string]any) model.JSONObject {
	if m == nil {
		return model.JSONObject{}
	}
	return model.JSONObject(m)
}

func userInfoOrEmpty(info *model.UserInfo) model.UserInfo {
	if info == nil {
		return model.UserInfo{}
	}
	return *info
}

// readAllString 读完整个 reader 并转成字符串
func readAllString(r io.Reader) (string, error) {
	data, err := io.ReadAll(r)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
