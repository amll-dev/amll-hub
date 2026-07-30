package service

import (
	"context"
	"errors"
	"fmt"
	"html"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"gorm.io/gorm"
)

// ErrSubmissionNotFound 投稿不存在
var ErrSubmissionNotFound = errors.New("submission not found")

// ErrMissingFile 缺少文件
var ErrMissingFile = errors.New("missing file")

// ErrFileNotFound 文件不存在
var ErrFileNotFound = errors.New("file not found in object storage")

// ErrInvalidStatus 投稿状态不允许该操作
var ErrInvalidStatus = errors.New("invalid submission status for this action")

// ErrForbidden 无权操作该投稿
var ErrForbidden = errors.New("forbidden")

// SubmissionUser 当前登录用户上下文信息（从 JWT Claims 提取）
type SubmissionUser struct {
	Name        string
	DisplayName string
	Avatar      string
}

// CreateSubmissionInput 创建投稿入参
type CreateSubmissionInput struct {
	Title    string                 `json:"title"`
	Metadata map[string]interface{} `json:"metadata"`
	FileName string                 `json:"fileName"`
	Notes    string                 `json:"notes"`
	Tags     []string               `json:"tags"`
	Language string                 `json:"language"`
	Type     string                 `json:"type"`
	Status   string                 `json:"status"`
}

// SubmissionDetail 投稿详情（含审核历史、评论、音频）
type SubmissionDetail struct {
	model.Submission
	ReviewHistory []model.ReviewHistory  `json:"reviewHistory"`
	Comments      []model.Comment        `json:"comments"`
	Audio         *model.SubmissionAudio `json:"audio,omitempty"`
}

// SubmissionService 投稿业务逻辑
type SubmissionService struct {
	subRepo     *repository.SubmissionRepo
	audioRepo   *repository.AudioRepo
	historyRepo *repository.ReviewHistoryRepo
	commentRepo *repository.CommentRepo
	files       *FileService
	db          *gorm.DB
}

// NewSubmissionService 创建投稿服务
func NewSubmissionService(
	subRepo *repository.SubmissionRepo,
	audioRepo *repository.AudioRepo,
	historyRepo *repository.ReviewHistoryRepo,
	commentRepo *repository.CommentRepo,
	files *FileService,
	db *gorm.DB,
) *SubmissionService {
	return &SubmissionService{
		subRepo:     subRepo,
		audioRepo:   audioRepo,
		historyRepo: historyRepo,
		commentRepo: commentRepo,
		files:       files,
		db:          db,
	}
}

// Create 创建投稿
func (s *SubmissionService) Create(ctx context.Context, user *SubmissionUser, in *CreateSubmissionInput) (int64, error) {
	if in.FileName == "" {
		return 0, ErrMissingFile
	}
	// 校验对象存储中是否存在该文件
	exists, err := s.files.Exists(ctx, PendingLyricKey(in.FileName))
	if err != nil {
		return 0, fmt.Errorf("check file exists: %w", err)
	}
	if !exists {
		return 0, ErrFileNotFound
	}

	// 状态：默认 pending，允许 draft
	status := model.StatusPending
	if in.Status == model.StatusDraft {
		status = model.StatusDraft
	}

	// 字段清洗
	title := sanitize(in.Title, 200)
	notes := sanitize(in.Notes, 2000)
	language := validLanguage(in.Language)
	artists := extractStrings(in.Metadata, "artists")
	album := extractStrings(in.Metadata, "album")

	sub := &model.Submission{
		Title:         title,
		Artist:        strings.Join(artists, ", "),
		Album:         strings.Join(album, ", "),
		NcmID:         extractString(in.Metadata, "ncmMusicId"),
		QqID:          extractString(in.Metadata, "qqMusicId"),
		AmID:          extractString(in.Metadata, "appleMusicId"),
		SpotifyID:     extractString(in.Metadata, "spotifyId"),
		FileName:      in.FileName,
		Notes:         notes,
		Tags:          normalizeTags(in.Tags),
		Metadata:      normalizeMetadata(in.Metadata),
		Language:      language,
		Status:        status,
		Submitter:     user.Name,
		SubmitterInfo: model.UserInfo{Username: user.Name, DisplayName: user.DisplayName, Avatar: user.Avatar},
		Provider:      "casdoor",
	}

	// 事务写入
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return s.subRepo.Create(ctx, tx, sub)
	})
	if err != nil {
		return 0, err
	}
	return sub.ID, nil
}

// List 列表查询
func (s *SubmissionService) List(ctx context.Context, user *SubmissionUser, q repository.ListQuery) (*repository.ListResult, error) {
	// creator 模式必须指定 submitter
	if q.Mode == "creator" || q.Mode == "" {
		q.Submitter = user.Name
	}
	return s.subRepo.List(ctx, q)
}

// GetDetail 查询详情（含审核历史 + 评论 + 音频）
func (s *SubmissionService) GetDetail(ctx context.Context, id int64) (*SubmissionDetail, error) {
	sub, err := s.subRepo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSubmissionNotFound
		}
		return nil, err
	}
	history, err := s.historyRepo.ListBySubmission(ctx, id)
	if err != nil {
		return nil, err
	}
	comments, err := s.commentRepo.ListBySubmission(ctx, id)
	if err != nil {
		return nil, err
	}
	audio, _ := s.audioRepo.GetBySubmissionID(ctx, id) // 不存在不报错

	return &SubmissionDetail{
		Submission:    *sub,
		ReviewHistory: history,
		Comments:      comments,
		Audio:         audio,
	}, nil
}

// Stats 状态计数
func (s *SubmissionService) Stats(ctx context.Context, user *SubmissionUser, mode string) (*repository.Stats, error) {
	submitter := ""
	if mode == "creator" || mode == "" {
		submitter = user.Name
	}
	return s.subRepo.Stats(ctx, submitter)
}

// UpdateFile 更新投稿的 TTML 文件（need_revision → pending）
func (s *SubmissionService) UpdateFile(ctx context.Context, user *SubmissionUser, id int64, fileName string, metadata *CreateSubmissionInput) error {
	if fileName == "" {
		return ErrMissingFile
	}
	exists, err := s.files.Exists(ctx, PendingLyricKey(fileName))
	if err != nil {
		return fmt.Errorf("check file exists: %w", err)
	}
	if !exists {
		return ErrFileNotFound
	}

	var sub *model.Submission
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		su, err := s.subRepo.GetByIDForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		if su.Submitter != user.Name {
			return ErrForbidden
		}
		// 仅 need_revision / rejected / missing_audio 状态允许更新文件
		switch su.Status {
		case model.StatusNeedRevision, model.StatusRejected, model.StatusMissingAudio:
		default:
			return ErrInvalidStatus
		}

		// 删除旧文件
		if su.FileName != "" && su.FileName != fileName {
			_ = s.files.Delete(ctx, PendingLyricKey(su.FileName))
		}

		// 组装元数据更新
		var metaUpdate *model.Submission
		if metadata != nil {
			artists := extractStrings(metadata.Metadata, "artists")
			album := extractStrings(metadata.Metadata, "album")
			metaUpdate = &model.Submission{
				Title:     sanitize(metadata.Title, 200),
				Artist:    strings.Join(artists, ", "),
				Album:     strings.Join(album, ", "),
				NcmID:     extractString(metadata.Metadata, "ncmMusicId"),
				QqID:      extractString(metadata.Metadata, "qqMusicId"),
				AmID:      extractString(metadata.Metadata, "appleMusicId"),
				SpotifyID: extractString(metadata.Metadata, "spotifyId"),
				Notes:     sanitize(metadata.Notes, 2000),
				Tags:      normalizeTags(metadata.Tags),
				Metadata:  normalizeMetadata(metadata.Metadata),
				Language:  validLanguage(metadata.Language),
			}
		}
		if err := s.subRepo.UpdateFile(ctx, tx, id, fileName, metaUpdate); err != nil {
			return err
		}
		sub = su
		return nil
	})
	if err != nil {
		return err
	}

	// 删除旧文件对象（如果文件名变更）
	_ = sub
	return nil
}

// Close 关闭投稿
func (s *SubmissionService) Close(ctx context.Context, user *SubmissionUser, id int64, isReviewer bool) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		su, err := s.subRepo.GetByIDForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		if su.Submitter != user.Name && !isReviewer {
			return ErrForbidden
		}
		// 已 closed / approved / rejected 不允许再关闭
		switch su.Status {
		case model.StatusClosed, model.StatusApproved, model.StatusRejected:
			return ErrInvalidStatus
		}
		info := &model.UserInfo{Username: user.Name, DisplayName: user.DisplayName, Avatar: user.Avatar}
		return s.subRepo.Close(ctx, tx, id, user.Name, info)
	})
}

// AddComment 新增评论
func (s *SubmissionService) AddComment(ctx context.Context, user *SubmissionUser, id int64, content string) error {
	if content == "" {
		return errors.New("评论内容不能为空")
	}
	if len(content) > 2000 {
		return errors.New("评论内容过长")
	}
	// 检查投稿是否存在
	if _, err := s.subRepo.GetByID(ctx, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrSubmissionNotFound
		}
		return err
	}
	c := &model.Comment{
		SubmissionID: id,
		Author: model.UserInfo{
			Username:    user.Name,
			DisplayName: user.DisplayName,
			Avatar:      user.Avatar,
		},
		Content: sanitize(content, 2000),
	}
	return s.commentRepo.Insert(ctx, c)
}

// ListComments 评论列表
func (s *SubmissionService) ListComments(ctx context.Context, id int64) ([]model.Comment, error) {
	return s.commentRepo.ListBySubmission(ctx, id)
}

// AttachAudio 关联音频附件
func (s *SubmissionService) AttachAudio(ctx context.Context, user *SubmissionUser, id int64, audio *model.SubmissionAudio) error {
	// 检查投稿者是否本人
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
	audio.SubmissionID = id
	audio.UploadedBy = user.Name
	return s.audioRepo.Upsert(ctx, audio)
}

// ---- 工具函数 ----

// sanitize 截断 + HTML 转义
func sanitize(s string, max int) string {
	if len(s) > max {
		s = s[:max]
	}
	return html.EscapeString(s)
}

func validLanguage(lang string) string {
	switch lang {
	case model.LangOthers, model.LangJa, model.LangZh, model.LangEn, model.LangKo:
		return lang
	}
	return model.LangOthers
}

func extractString(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func extractStrings(m map[string]interface{}, key string) []string {
	if m == nil {
		return nil
	}
	v, ok := m[key]
	if !ok {
		return nil
	}
	switch val := v.(type) {
	case []string:
		return val
	case []interface{}:
		out := make([]string, 0, len(val))
		for _, item := range val {
			if s, ok := item.(string); ok && s != "" {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

func normalizeTags(tags []string) model.JSONStringArray {
	out := make(model.JSONStringArray, 0, len(tags))
	for _, t := range tags {
		t = strings.TrimSpace(t)
		if t != "" {
			out = append(out, t)
		}
	}
	return out
}

func normalizeMetadata(m map[string]interface{}) model.JSONObject {
	if m == nil {
		return model.JSONObject{}
	}
	return model.JSONObject(m)
}

// ParseSubmissionUserFromClaims 从 pkg.Claims 构造 SubmissionUser
func ParseSubmissionUserFromClaims(claims *pkg.Claims) *SubmissionUser {
	if claims == nil {
		return &SubmissionUser{}
	}
	return &SubmissionUser{
		Name:        claims.Name,
		DisplayName: claims.DisplayName,
		Avatar:      claims.Avatar,
	}
}

// _ 防 time 未引用
var _ = time.Now
