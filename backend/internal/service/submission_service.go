package service

import (
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"gorm.io/gorm"
)

// SubmissionUser 当前登录用户上下文信息（从 JWT Claims 提取）
type SubmissionUser struct {
	Name        string
	DisplayName string
	Avatar      string
}

// CreateSubmissionInput 创建投稿入参
type CreateSubmissionInput struct {
	Title    string         `json:"title"`
	Metadata map[string]any `json:"metadata"`
	FileName string         `json:"fileName"`
	Notes    string         `json:"notes"`
	Tags     []string       `json:"tags"`
	Language string         `json:"language"`
	Type     string         `json:"type"`
	Status   string         `json:"status"`
} // Submission 投稿 DTO
type Submission struct {
	ID                  int64          `json:"id"`
	Title               string         `json:"title"`
	Artist              string         `json:"artist"`
	Album               string         `json:"album"`
	NcmID               string         `json:"ncmId"`
	QqID                string         `json:"qqId"`
	AmID                string         `json:"amId"`
	SpotifyID           string         `json:"spotifyId"`
	FileName            string         `json:"fileName"`
	Notes               string         `json:"notes"`
	Tags                []string       `json:"tags"`
	Metadata            map[string]any `json:"metadata"`
	Language            string         `json:"language"`
	Status              string         `json:"status"`
	Submitter           string         `json:"submitter"`
	SubmitterInfo       UserInfo       `json:"submitterInfo"`
	Provider            string         `json:"provider"`
	CreatedAt           time.Time      `json:"createdAt"`
	UpdatedAt           time.Time      `json:"updatedAt"`
	FileUpdatedAt       *time.Time     `json:"fileUpdatedAt,omitempty"`
	RevisionRequestedAt *time.Time     `json:"revisionRequestedAt,omitempty"`
	ClosedAt            *time.Time     `json:"closedAt,omitempty"`
	ClosedBy            string         `json:"closedBy,omitempty"`
	ClosedByInfo        *UserInfo      `json:"closedByInfo,omitempty"`
	Reviewer            string         `json:"reviewer,omitempty"`
	ReviewedAt          *time.Time     `json:"reviewedAt,omitempty"`
	ReviewComment       string         `json:"reviewComment,omitempty"`
}

// UserInfo 用户信息（投稿者/审核员/关闭者）
type UserInfo struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
}

// ReviewHistory 审核历史
type ReviewHistory struct {
	ID           int64     `json:"id"`
	SubmissionID int64     `json:"submissionId"`
	Reviewer     string    `json:"reviewer"`
	ReviewerInfo UserInfo  `json:"reviewerInfo"`
	Status       string    `json:"status"`
	Comment      string    `json:"comment"`
	ReviewedAt   time.Time `json:"reviewedAt"`
}

// Comment 评论
type Comment struct {
	ID           int64     `json:"id"`
	SubmissionID int64     `json:"submissionId"`
	Author       UserInfo  `json:"author"`
	Content      string    `json:"content"`
	CreatedAt    time.Time `json:"createdAt"`
}

// SubmissionAudio 音频附件
type SubmissionAudio struct {
	ID           int64     `json:"id"`
	SubmissionID int64     `json:"submissionId"`
	FileName     string    `json:"fileName"`
	CoverURL     string    `json:"coverUrl,omitempty"`
	Title        string    `json:"title"`
	Artist       string    `json:"artist"`
	Album        string    `json:"album"`
	Platform     string    `json:"platform"`
	PlatformID   string    `json:"platformId"`
	UploadedBy   string    `json:"uploadedBy"`
	UploadedAt   time.Time `json:"uploadedAt"`
}

// FileHistory 文件更新历史
type FileHistory struct {
	ID           int64     `json:"id"`
	SubmissionID int64     `json:"submissionId"`
	Uploader     string    `json:"uploader"`
	UploaderInfo UserInfo  `json:"uploaderInfo"`
	FileName     string    `json:"fileName"`
	UploadedAt   time.Time `json:"uploadedAt"`
}

// SubmissionDetail 投稿详情（含审核历史、文件更新历史、评论、音频）
type SubmissionDetail struct {
	Submission
	ReviewHistory []ReviewHistory    `json:"reviewHistory"`
	FileHistory   []FileHistory      `json:"fileHistory"`
	Comments      []Comment          `json:"comments"`
	Audio         *SubmissionAudio   `json:"audio,omitempty"`
	Audios        []*SubmissionAudio `json:"audios,omitempty"`
}

// SubmissionListQuery 列表查询参数
type SubmissionListQuery struct {
	Mode     string
	Status   string
	Language string
	Search   string
	Page     int
	Limit    int
}

// SubmissionListResult 列表查询结果
type SubmissionListResult struct {
	Total int64
	Items []Submission
}

// SubmissionStats 各状态计数
type SubmissionStats struct {
	Pending      int64 `json:"pending"`
	Reviewing    int64 `json:"reviewing"`
	Approved     int64 `json:"approved"`
	Rejected     int64 `json:"rejected"`
	NeedRevision int64 `json:"needRevision"`
	MissingAudio int64 `json:"missingAudio"`
	Closed       int64 `json:"closed"`
	Draft        int64 `json:"draft"`
}

// AttachAudioInput 音频附件入参
type AttachAudioInput struct {
	FileName   string
	CoverURL   string
	Title      string
	Artist     string
	Album      string
	Platform   string
	PlatformID string
}

// SubmissionService 投稿业务逻辑
type SubmissionService struct {
	subRepo         *repository.SubmissionRepo
	audioRepo       *repository.AudioRepo
	historyRepo     *repository.ReviewHistoryRepo
	fileHistoryRepo *repository.FileHistoryRepo
	commentRepo     *repository.CommentRepo
	files           *FileService
	db              *gorm.DB
}

// NewSubmissionService 创建投稿服务
func NewSubmissionService(
	subRepo *repository.SubmissionRepo,
	audioRepo *repository.AudioRepo,
	historyRepo *repository.ReviewHistoryRepo,
	fileHistoryRepo *repository.FileHistoryRepo,
	commentRepo *repository.CommentRepo,
	files *FileService,
	db *gorm.DB,
) *SubmissionService {
	return &SubmissionService{
		subRepo:         subRepo,
		audioRepo:       audioRepo,
		historyRepo:     historyRepo,
		fileHistoryRepo: fileHistoryRepo,
		commentRepo:     commentRepo,
		files:           files,
		db:              db,
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
	artists := extractStrings(in.Metadata, "artist")
	album := extractStrings(in.Metadata, "album")

	sub := &model.Submission{
		Title:         title,
		Artist:        strings.Join(artists, ", "),
		Album:         strings.Join(album, ", "),
		NcmID:         extractPlatformId(in.Metadata, "ncm_music_id"),
		QqID:          extractPlatformId(in.Metadata, "qq_music_id"),
		AmID:          extractPlatformId(in.Metadata, "apple_music_id"),
		SpotifyID:     extractPlatformId(in.Metadata, "spotify_id"),
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
func (s *SubmissionService) List(ctx context.Context, user *SubmissionUser, q SubmissionListQuery) (*SubmissionListResult, error) {
	rq := repository.ListQuery{
		Mode:     q.Mode,
		Status:   q.Status,
		Language: q.Language,
		Search:   q.Search,
		Page:     q.Page,
		Limit:    q.Limit,
	}
	// creator 模式必须指定 submitter
	if rq.Mode == "creator" || rq.Mode == "" {
		rq.Submitter = user.Name
	}
	res, err := s.subRepo.List(ctx, rq)
	if err != nil {
		return nil, err
	}
	items := make([]Submission, len(res.Items))
	for i, m := range res.Items {
		items[i] = convertSubmission(m)
	}
	return &SubmissionListResult{Total: res.Total, Items: items}, nil
}

// GetTtmlContent 读取投稿的 TTML 文件内容
func (s *SubmissionService) GetTtmlContent(ctx context.Context, user *SubmissionUser, id int64, isReviewer bool) (string, error) {
	sub, err := s.subRepo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", ErrSubmissionNotFound
		}
		return "", err
	}
	if sub.Submitter != user.Name && !isReviewer {
		return "", ErrForbidden
	}
	if sub.FileName == "" {
		return "", ErrMissingFile
	}

	reader, err := s.files.Get(ctx, PendingLyricKey(sub.FileName))
	if err != nil {
		return "", ErrFileNotFound
	}
	defer reader.Close()

	data, err := io.ReadAll(reader)
	if err != nil {
		return "", fmt.Errorf("read ttml: %w", err)
	}
	return string(data), nil
}

// GetDetail 查询详情
func (s *SubmissionService) GetDetail(ctx context.Context, user *SubmissionUser, id int64, isReviewer bool) (*SubmissionDetail, error) {
	sub, err := s.subRepo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSubmissionNotFound
		}
		return nil, err
	}
	if sub.Submitter != user.Name && !isReviewer {
		return nil, ErrForbidden
	}
	history, err := s.historyRepo.ListBySubmission(ctx, id)
	if err != nil {
		return nil, err
	}
	fileHistory, err := s.fileHistoryRepo.ListBySubmission(ctx, id)
	if err != nil {
		return nil, err
	}
	comments, err := s.commentRepo.ListBySubmission(ctx, id)
	if err != nil {
		return nil, err
	}
	audios, _ := s.audioRepo.ListBySubmissionID(ctx, id) // 不存在不报错

	detail := &SubmissionDetail{
		Submission:    convertSubmission(*sub),
		ReviewHistory: convertReviewHistory(history),
		FileHistory:   convertFileHistory(fileHistory),
		Comments:      convertComments(comments),
	}
	if len(audios) > 0 {
		converted := convertAudios(audios)
		detail.Audios = converted
		if len(converted) > 0 {
			detail.Audio = converted[0]
		}
	}
	return detail, nil
}

// Stats 状态计数
func (s *SubmissionService) Stats(ctx context.Context, user *SubmissionUser, mode string) (*SubmissionStats, error) {
	submitter := ""
	if mode == "creator" || mode == "" {
		submitter = user.Name
	}
	rs, err := s.subRepo.Stats(ctx, submitter)
	if err != nil {
		return nil, err
	}
	return &SubmissionStats{
		Pending:      rs.Pending,
		Reviewing:    rs.Reviewing,
		Approved:     rs.Approved,
		Rejected:     rs.Rejected,
		NeedRevision: rs.NeedRevision,
		MissingAudio: rs.MissingAudio,
		Closed:       rs.Closed,
		Draft:        rs.Draft,
	}, nil
}

// UpdateFile 更新投稿的 TTML 文件
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
		// 除已关闭外都允许更新文件
		switch su.Status {
		case model.StatusClosed:
			return ErrInvalidStatus
		}

		// 仅 need_revision 状态下重置为 pending，其余状态（如 missing_audio）保持不变
		newStatus := ""
		if su.Status == model.StatusNeedRevision {
			newStatus = model.StatusPending
		}

		// 删除旧文件
		if su.FileName != "" && su.FileName != fileName {
			_ = s.files.Delete(ctx, PendingLyricKey(su.FileName))
		}

		// 组装元数据更新
		var metaUpdate *model.Submission
		if metadata != nil {
			artists := extractStrings(metadata.Metadata, "artist")
			album := extractStrings(metadata.Metadata, "album")
			metaUpdate = &model.Submission{
				Title:     sanitize(metadata.Title, 200),
				Artist:    strings.Join(artists, ", "),
				Album:     strings.Join(album, ", "),
				NcmID:     extractPlatformId(metadata.Metadata, "ncm_music_id"),
				QqID:      extractPlatformId(metadata.Metadata, "qq_music_id"),
				AmID:      extractPlatformId(metadata.Metadata, "apple_music_id"),
				SpotifyID: extractPlatformId(metadata.Metadata, "spotify_id"),
				Notes:     sanitize(metadata.Notes, 2000),
				Tags:      normalizeTags(metadata.Tags),
				Metadata:  normalizeMetadata(metadata.Metadata),
				Language:  validLanguage(metadata.Language),
			}
		}
		if err := s.subRepo.UpdateFile(ctx, tx, id, fileName, metaUpdate, newStatus); err != nil {
			return err
		}
		// 记录文件更新历史（独立于审核历史），用于时间线展示多次更新
		if err := s.fileHistoryRepo.Insert(ctx, tx, &model.SubmissionFileHistory{
			SubmissionID: id,
			Uploader:     user.Name,
			UploaderInfo: model.UserInfo{Username: user.Name, DisplayName: user.DisplayName, Avatar: user.Avatar},
			FileName:     fileName,
			UploadedAt:   time.Now(),
		}); err != nil {
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
func (s *SubmissionService) ListComments(ctx context.Context, id int64) ([]Comment, error) {
	comments, err := s.commentRepo.ListBySubmission(ctx, id)
	if err != nil {
		return nil, err
	}
	return convertComments(comments), nil
}

// AttachAudio 关联音频附件
func (s *SubmissionService) AttachAudio(ctx context.Context, user *SubmissionUser, id int64, in *AttachAudioInput) error {
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
	audio := &model.SubmissionAudio{
		FileName:   in.FileName,
		CoverURL:   in.CoverURL,
		Title:      in.Title,
		Artist:     in.Artist,
		Album:      in.Album,
		Platform:   in.Platform,
		PlatformID: in.PlatformID,
	}
	audio.SubmissionID = id
	audio.UploadedBy = user.Name

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.audioRepo.Append(ctx, audio); err != nil {
			return err
		}
		// missing_audio 状态下上传音频后重置为 pending
		if sub.Status == model.StatusMissingAudio {
			if err := s.subRepo.UpdateStatus(ctx, tx, &model.Submission{
				ID:     sub.ID,
				Status: model.StatusPending,
			}); err != nil {
				return err
			}
		}
		return nil
	})
}

// ---- 工具函数 ----

// sanitize 按 rune 截断 + HTML 转义（按字节截断会切碎多字节 UTF-8 字符产生乱码）
func sanitize(s string, max int) string {
	if len(s) > max {
		r := []rune(s)
		if len(r) > max {
			s = string(r[:max])
		}
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

func extractString(m map[string]any, key string) string {
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

func extractStrings(m map[string]any, key string) []string {
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
	case []any:
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

// extractPlatformId 从 metadata.platform_ids 嵌套 map 中提取指定平台 ID 的第一个值
func extractPlatformId(m map[string]any, platformKey string) string {
	if m == nil {
		return ""
	}
	rawPids, ok := m["platform_ids"]
	if !ok {
		return ""
	}
	pids, ok := rawPids.(map[string]any)
	if !ok {
		return ""
	}
	rawIds, ok := pids[platformKey]
	if !ok {
		return ""
	}
	switch val := rawIds.(type) {
	case string:
		return val
	case []any:
		for _, item := range val {
			if s, ok := item.(string); ok && s != "" {
				return s
			}
		}
	case []string:
		for _, s := range val {
			if s != "" {
				return s
			}
		}
	}
	return ""
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

func normalizeMetadata(m map[string]any) model.JSONObject {
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

// ---- model -> service DTO 转换 ----

func convertSubmission(m model.Submission) Submission {
	return Submission{
		ID:                  m.ID,
		Title:               m.Title,
		Artist:              m.Artist,
		Album:               m.Album,
		NcmID:               m.NcmID,
		QqID:                m.QqID,
		AmID:                m.AmID,
		SpotifyID:           m.SpotifyID,
		FileName:            m.FileName,
		Notes:               m.Notes,
		Tags:                ensureStringSlice(m.Tags),
		Metadata:            map[string]any(m.Metadata),
		Language:            m.Language,
		Status:              m.Status,
		Submitter:           m.Submitter,
		SubmitterInfo:       convertUserInfo(m.SubmitterInfo),
		Provider:            m.Provider,
		CreatedAt:           m.CreatedAt,
		UpdatedAt:           m.UpdatedAt,
		FileUpdatedAt:       m.FileUpdatedAt,
		RevisionRequestedAt: m.RevisionRequestedAt,
		ClosedAt:            m.ClosedAt,
		ClosedBy:            m.ClosedBy,
		ClosedByInfo:        convertUserInfoPtr(m.ClosedByInfo),
		Reviewer:            m.Reviewer,
		ReviewedAt:          m.ReviewedAt,
		ReviewComment:       m.ReviewComment,
	}
}

func convertUserInfo(u model.UserInfo) UserInfo {
	return UserInfo{Username: u.Username, DisplayName: u.DisplayName, Avatar: u.Avatar}
}

func convertUserInfoPtr(u *model.UserInfo) *UserInfo {
	if u == nil {
		return nil
	}
	out := convertUserInfo(*u)
	return &out
}

func convertReviewHistory(items []model.ReviewHistory) []ReviewHistory {
	out := make([]ReviewHistory, len(items))
	for i, h := range items {
		out[i] = ReviewHistory{
			ID:           h.ID,
			SubmissionID: h.SubmissionID,
			Reviewer:     h.Reviewer,
			ReviewerInfo: convertUserInfo(h.ReviewerInfo),
			Status:       h.Status,
			Comment:      h.Comment,
			ReviewedAt:   h.ReviewedAt,
		}
	}
	return out
}

func convertFileHistory(items []model.SubmissionFileHistory) []FileHistory {
	out := make([]FileHistory, len(items))
	for i, h := range items {
		out[i] = FileHistory{
			ID:           h.ID,
			SubmissionID: h.SubmissionID,
			Uploader:     h.Uploader,
			UploaderInfo: convertUserInfo(h.UploaderInfo),
			FileName:     h.FileName,
			UploadedAt:   h.UploadedAt,
		}
	}
	return out
}

func convertComments(items []model.Comment) []Comment {
	out := make([]Comment, len(items))
	for i, c := range items {
		out[i] = Comment{
			ID:           c.ID,
			SubmissionID: c.SubmissionID,
			Author:       convertUserInfo(c.Author),
			Content:      c.Content,
			CreatedAt:    c.CreatedAt,
		}
	}
	return out
}

func convertAudio(a *model.SubmissionAudio) *SubmissionAudio {
	if a == nil {
		return nil
	}
	return &SubmissionAudio{
		ID:           a.ID,
		SubmissionID: a.SubmissionID,
		FileName:     a.FileName,
		CoverURL:     a.CoverURL,
		Title:        a.Title,
		Artist:       a.Artist,
		Album:        a.Album,
		Platform:     a.Platform,
		PlatformID:   a.PlatformID,
		UploadedBy:   a.UploadedBy,
		UploadedAt:   a.UploadedAt,
	}
}

func convertAudios(items []*model.SubmissionAudio) []*SubmissionAudio {
	out := make([]*SubmissionAudio, 0, len(items))
	for _, a := range items {
		if c := convertAudio(a); c != nil {
			out = append(out, c)
		}
	}
	return out
}
