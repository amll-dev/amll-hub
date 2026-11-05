package service

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"gorm.io/gorm"
)

// ErrLyricRequestNotFound 请愿不存在
var ErrLyricRequestNotFound = errors.New("lyric request not found")

// ValidationError 面向用户的参数校验错误（handler 直接透出 Message）
type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string { return e.Message }

func invalidInput(format string, args ...any) error {
	return &ValidationError{Message: fmt.Sprintf(format, args...)}
}

var (
	// 平台 ID 仅允许字母数字与 _-（Spotify/Apple 可能带字母）
	platformIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
	// ncm / QM ID 为纯数字
	digitIDPattern = regexp.MustCompile(`^[0-9]+$`)
)

const (
	maxSongFieldLen  = 255
	maxNoteLen       = 1000
	maxCommentLen    = 500
	defaultPageSize  = 12
	maxPageSize      = 50
	maxSupportShown  = 12
	maxCommentsShown = 300
)

// LyricRequestUser 当前登录用户
type LyricRequestUser struct {
	Name        string
	DisplayName string
	Avatar      string
}

func (u *LyricRequestUser) info() model.JSONObject {
	return model.JSONObject{
		"name":        u.Name,
		"displayName": u.DisplayName,
		"avatar":      u.Avatar,
	}
}

// CreateLyricRequestInput 发起请愿入参
type CreateLyricRequestInput struct {
	SongName     string `json:"songName"`
	Artist       string `json:"artist"`
	Album        string `json:"album"`
	NcmID        string `json:"ncmId"`
	QQID         string `json:"qqId"`
	SpotifyID    string `json:"spotifyId"`
	AppleMusicID string `json:"appleMusicId"`
	HasAppleTTML bool   `json:"hasAppleTtml"`
	ExtraInfo    string `json:"extraInfo"`
	Note         string `json:"note"`
}

// LyricRequestListParams 列表查询参数
type LyricRequestListParams struct {
	Status   string
	Keyword  string
	Sort     string
	Page     int
	PageSize int
	Mine     string
}

// LyricRequestSupporter 支持者
type LyricRequestSupporter struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
}

// LyricRequestItem 请愿条目
type LyricRequestItem struct {
	model.LyricRequest
	// SubmissionStatus 关联投稿的审核状态
	SubmissionStatus string                  `json:"submissionStatus"`
	Supported        bool                    `json:"supported"`
	CommentCount     int64                   `json:"commentCount"`
	Supporters       []LyricRequestSupporter `json:"supporters"`
}

// LyricRequestListResult 列表结果
type LyricRequestListResult struct {
	Items    []LyricRequestItem `json:"items"`
	Total    int64              `json:"total"`
	Page     int                `json:"page"`
	PageSize int                `json:"pageSize"`
}

// CreateLyricRequestResult 发起请愿结果
type CreateLyricRequestResult struct {
	ID     int64  `json:"id"`
	Merged bool   `json:"merged"`
	Status string `json:"status"`
}

// LyricRequestCommentItem 评论条目
type LyricRequestCommentItem struct {
	ID          int64     `json:"id"`
	UserName    string    `json:"userName"`
	DisplayName string    `json:"displayName"`
	Avatar      string    `json:"avatar"`
	Content     string    `json:"content"`
	CreatedAt   time.Time `json:"createdAt"`
}

// LyricRequestService 歌词请愿业务逻辑
type LyricRequestService struct {
	repo *repository.LyricRequestRepo
}

// NewLyricRequestService 创建 LyricRequestService
func NewLyricRequestService(repo *repository.LyricRequestRepo) *LyricRequestService {
	return &LyricRequestService{repo: repo}
}

// normalizeID 平台 ID 归一化：空 → '0'，其余去空白
func normalizeID(raw string) string {
	v := strings.TrimSpace(raw)
	if v == "" {
		return "0"
	}
	return v
}

func (in *CreateLyricRequestInput) normalize() {
	in.SongName = strings.TrimSpace(in.SongName)
	in.Artist = strings.TrimSpace(in.Artist)
	in.Album = strings.TrimSpace(in.Album)
	in.ExtraInfo = strings.TrimSpace(in.ExtraInfo)
	in.Note = strings.TrimSpace(in.Note)
	in.NcmID = normalizeID(in.NcmID)
	in.QQID = normalizeID(in.QQID)
	in.SpotifyID = normalizeID(in.SpotifyID)
	in.AppleMusicID = normalizeID(in.AppleMusicID)
}

func (in *CreateLyricRequestInput) validate() error {
	if in.SongName == "" {
		return invalidInput("请填写歌曲名称")
	}
	if in.Artist == "" {
		return invalidInput("请填写歌手")
	}
	if in.Album == "" {
		return invalidInput("请填写专辑")
	}
	if len([]rune(in.SongName)) > maxSongFieldLen || len([]rune(in.Artist)) > maxSongFieldLen ||
		len([]rune(in.Album)) > maxSongFieldLen {
		return invalidInput("歌曲名称、歌手、专辑长度不能超过 %d 个字符", maxSongFieldLen)
	}
	if len([]rune(in.ExtraInfo)) > maxNoteLen || len([]rune(in.Note)) > maxNoteLen {
		return invalidInput("备注长度不能超过 %d 个字符", maxNoteLen)
	}

	for label, id := range map[string]string{
		"网易云音乐 ID":       in.NcmID,
		"QQ 音乐 ID":       in.QQID,
		"Spotify ID":     in.SpotifyID,
		"Apple Music ID": in.AppleMusicID,
	} {
		if id == "0" {
			continue
		}
		if !platformIDPattern.MatchString(id) {
			return invalidInput("%s 格式不正确，只能包含字母、数字、- 和 _", label)
		}
	}
	if in.NcmID != "0" && !digitIDPattern.MatchString(in.NcmID) {
		return invalidInput("网易云音乐 ID 应为纯数字，找不到请填 0")
	}
	if in.QQID != "0" && !digitIDPattern.MatchString(in.QQID) {
		return invalidInput("QQ 音乐 ID 应为纯数字，找不到请填 0")
	}
	if in.NcmID == "0" && in.QQID == "0" && in.SpotifyID == "0" && in.AppleMusicID == "0" {
		return invalidInput("请至少填写一个平台的歌曲 ID，否则无法定位歌曲")
	}
	return nil
}

// 平台列名
func (in *CreateLyricRequestInput) platformIDs() map[string]string {
	ids := make(map[string]string, 4)
	if in.NcmID != "0" {
		ids["ncm_id"] = in.NcmID
	}
	if in.QQID != "0" {
		ids["qq_id"] = in.QQID
	}
	if in.SpotifyID != "0" {
		ids["spotify_id"] = in.SpotifyID
	}
	if in.AppleMusicID != "0" {
		ids["apple_music_id"] = in.AppleMusicID
	}
	return ids
}

// List 全站请愿列表
func (s *LyricRequestService) List(
	ctx context.Context, params LyricRequestListParams, viewer string,
) (*LyricRequestListResult, error) {
	page := params.Page
	if page <= 0 {
		page = 1
	}
	pageSize := params.PageSize
	if pageSize <= 0 {
		pageSize = defaultPageSize
	}
	if pageSize > maxPageSize {
		pageSize = maxPageSize
	}

	status := params.Status
	if status != model.LyricRequestPending && status != model.LyricRequestCompleted {
		status = ""
	}
	sortKey := params.Sort
	if sortKey != "hot" {
		sortKey = "latest"
	}

	items, total, err := s.repo.List(ctx, repository.LyricRequestFilter{
		Status:    status,
		Keyword:   params.Keyword,
		Requester: params.Mine,
		Sort:      sortKey,
		Offset:    (page - 1) * pageSize,
		Limit:     pageSize,
	})
	if err != nil {
		return nil, fmt.Errorf("查询请愿列表失败: %w", err)
	}

	enriched, err := s.enrich(ctx, items, viewer)
	if err != nil {
		return nil, err
	}
	return &LyricRequestListResult{
		Items:    enriched,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}

// Get 请愿详情
func (s *LyricRequestService) Get(
	ctx context.Context, id int64, viewer string,
) (*LyricRequestItem, error) {
	req, err := s.repo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLyricRequestNotFound
		}
		return nil, fmt.Errorf("查询请愿失败: %w", err)
	}
	items, err := s.enrich(ctx, []model.LyricRequest{*req}, viewer)
	if err != nil {
		return nil, err
	}
	return &items[0], nil
}

// Create 发起请愿
func (s *LyricRequestService) Create(
	ctx context.Context, user *LyricRequestUser, in *CreateLyricRequestInput,
) (*CreateLyricRequestResult, error) {
	in.normalize()
	if err := in.validate(); err != nil {
		return nil, err
	}

	existing, err := s.repo.FindByPlatformIDs(ctx, in.platformIDs())
	switch {
	case err == nil:
		// 合并
		if err := s.repo.IncRequestCount(ctx, existing.ID); err != nil {
			return nil, fmt.Errorf("合并请愿失败: %w", err)
		}
		if _, err := s.repo.AddSupportIfAbsent(ctx, existing.ID, user.Name, user.info()); err != nil {
			return nil, fmt.Errorf("合并请愿失败: %w", err)
		}
		return &CreateLyricRequestResult{
			ID:     existing.ID,
			Merged: true,
			Status: existing.Status,
		}, nil
	case !errors.Is(err, gorm.ErrRecordNotFound):
		return nil, fmt.Errorf("查询已有请愿失败: %w", err)
	}

	req := &model.LyricRequest{
		SongName:      in.SongName,
		Artist:        in.Artist,
		Album:         in.Album,
		NcmID:         in.NcmID,
		QQID:          in.QQID,
		SpotifyID:     in.SpotifyID,
		AppleMusicID:  in.AppleMusicID,
		HasAppleTTML:  in.HasAppleTTML,
		ExtraInfo:     in.ExtraInfo,
		Note:          in.Note,
		Status:        model.LyricRequestPending,
		RequesterName: user.Name,
		RequesterInfo: user.info(),
		SupportCount:  0,
		RequestCount:  1,
	}
	if err := s.repo.Create(ctx, req); err != nil {
		return nil, fmt.Errorf("创建请愿失败: %w", err)
	}
	// 发起人默认算一次支持
	if _, err := s.repo.AddSupportIfAbsent(ctx, req.ID, user.Name, user.info()); err != nil {
		return nil, fmt.Errorf("创建请愿失败: %w", err)
	}

	return &CreateLyricRequestResult{
		ID:     req.ID,
		Merged: false,
		Status: req.Status,
	}, nil
}

// Update 编辑请愿
func (s *LyricRequestService) Update(
	ctx context.Context, id int64, user *LyricRequestUser, in *CreateLyricRequestInput,
) error {
	req, err := s.repo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrLyricRequestNotFound
		}
		return fmt.Errorf("查询请愿失败: %w", err)
	}
	if req.RequesterName != user.Name {
		return ErrForbidden
	}
	if req.Status != model.LyricRequestPending {
		return invalidInput("请愿已完成，无法再编辑")
	}

	in.normalize()
	if err := in.validate(); err != nil {
		return err
	}

	return s.repo.UpdateFields(ctx, id, map[string]any{
		"song_name":      in.SongName,
		"artist":         in.Artist,
		"album":          in.Album,
		"ncm_id":         in.NcmID,
		"qq_id":          in.QQID,
		"spotify_id":     in.SpotifyID,
		"apple_music_id": in.AppleMusicID,
		"has_apple_ttml": in.HasAppleTTML,
		"extra_info":     in.ExtraInfo,
		"note":           in.Note,
	})
}

// Withdraw 撤回请愿
func (s *LyricRequestService) Withdraw(ctx context.Context, id int64, user *LyricRequestUser) error {
	req, err := s.repo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrLyricRequestNotFound
		}
		return fmt.Errorf("查询请愿失败: %w", err)
	}
	if req.RequesterName != user.Name {
		return ErrForbidden
	}
	return s.repo.Delete(ctx, id)
}

// ToggleSupport 支持 / 取消支持
func (s *LyricRequestService) ToggleSupport(
	ctx context.Context, id int64, user *LyricRequestUser,
) (bool, int, error) {
	if _, err := s.repo.GetByID(ctx, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, 0, ErrLyricRequestNotFound
		}
		return false, 0, fmt.Errorf("查询请愿失败: %w", err)
	}
	return s.repo.ToggleSupport(ctx, id, user.Name, user.info())
}

// ListComments 评论列表
func (s *LyricRequestService) ListComments(
	ctx context.Context, id int64,
) ([]LyricRequestCommentItem, error) {
	if _, err := s.repo.GetByID(ctx, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLyricRequestNotFound
		}
		return nil, fmt.Errorf("查询请愿失败: %w", err)
	}
	comments, err := s.repo.ListComments(ctx, id, maxCommentsShown)
	if err != nil {
		return nil, fmt.Errorf("查询评论失败: %w", err)
	}
	return mapComments(comments), nil
}

// AddComment 发表评论
func (s *LyricRequestService) AddComment(
	ctx context.Context, id int64, user *LyricRequestUser, content string,
) (*LyricRequestCommentItem, error) {
	text := strings.TrimSpace(content)
	if text == "" {
		return nil, invalidInput("评论内容不能为空")
	}
	if len([]rune(text)) > maxCommentLen {
		return nil, invalidInput("评论最多 %d 个字符", maxCommentLen)
	}
	if _, err := s.repo.GetByID(ctx, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLyricRequestNotFound
		}
		return nil, fmt.Errorf("查询请愿失败: %w", err)
	}

	comment := &model.LyricRequestComment{
		RequestID: id,
		UserName:  user.Name,
		UserInfo:  user.info(),
		Content:   text,
	}
	if err := s.repo.AddComment(ctx, comment); err != nil {
		return nil, fmt.Errorf("发表评论失败: %w", err)
	}
	return &mapComments([]model.LyricRequestComment{*comment})[0], nil
}

// SetStatus 管理员标记请愿状态
func (s *LyricRequestService) SetStatus(ctx context.Context, id int64, status string) error {
	if status != model.LyricRequestPending && status != model.LyricRequestCompleted {
		return invalidInput("状态只能是 pending 或 completed")
	}
	if _, err := s.repo.GetByID(ctx, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrLyricRequestNotFound
		}
		return fmt.Errorf("查询请愿失败: %w", err)
	}
	return s.repo.SetStatus(ctx, id, status)
}

// enrich 批量补齐支持者、当前用户是否已支持、评论数
func (s *LyricRequestService) enrich(
	ctx context.Context, items []model.LyricRequest, viewer string,
) ([]LyricRequestItem, error) {
	out := make([]LyricRequestItem, 0, len(items))
	if len(items) == 0 {
		return out, nil
	}
	ids := make([]int64, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}

	supports, err := s.repo.ListSupports(ctx, ids, maxSupportShown)
	if err != nil {
		return nil, fmt.Errorf("查询支持记录失败: %w", err)
	}
	supported, err := s.repo.SupportedRequestIDs(ctx, viewer, ids)
	if err != nil {
		return nil, fmt.Errorf("查询支持状态失败: %w", err)
	}
	commentCounts, err := s.repo.CountComments(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("查询评论数失败: %w", err)
	}
	subStatus, err := s.repo.LatestSubmissionStatus(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("查询关联投稿状态失败: %w", err)
	}

	for _, item := range items {
		supporters := make([]LyricRequestSupporter, 0, len(supports[item.ID]))
		for _, sp := range supports[item.ID] {
			supporters = append(supporters, LyricRequestSupporter{
				Name:        sp.UserName,
				DisplayName: jsonString(sp.UserInfo, "displayName", sp.UserName),
				Avatar:      jsonString(sp.UserInfo, "avatar", ""),
			})
		}
		out = append(out, LyricRequestItem{
			LyricRequest:     item,
			SubmissionStatus: subStatus[item.ID],
			Supported:        supported[item.ID],
			CommentCount:     commentCounts[item.ID],
			Supporters:       supporters,
		})
	}
	return out, nil
}

func mapComments(comments []model.LyricRequestComment) []LyricRequestCommentItem {
	out := make([]LyricRequestCommentItem, 0, len(comments))
	for _, c := range comments {
		out = append(out, LyricRequestCommentItem{
			ID:          c.ID,
			UserName:    c.UserName,
			DisplayName: jsonString(c.UserInfo, "displayName", c.UserName),
			Avatar:      jsonString(c.UserInfo, "avatar", ""),
			Content:     c.Content,
			CreatedAt:   c.CreatedAt,
		})
	}
	return out
}

// jsonString 从 JSONB 用户信息里安全取字符串字段
func jsonString(obj model.JSONObject, key, fallback string) string {
	if obj == nil {
		return fallback
	}
	if v, ok := obj[key].(string); ok && v != "" {
		return v
	}
	return fallback
}
