package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/amll-dev/amll-hub/backend/internal/infrastructure"
	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	logrus "github.com/sirupsen/logrus"
	"gorm.io/gorm"
)

// 主页资料字段上限（与迁移里的列长度一致）
const (
	MaxBioLen = 200
)

// PublicProfile 公开主页聚合资料。
//
// 刻意不包含 email / phone / isAdmin / isReviewer——公开展示不需要也不应暴露。
type PublicProfile struct {
	Name        string           `json:"name"`
	DisplayName string           `json:"displayName"`
	Avatar      string           `json:"avatar"`
	CreatedTime string           `json:"createdTime,omitempty"`
	Bio         string           `json:"bio"`
	BannerKey   string           `json:"bannerKey"`
	Birthday    *string          `json:"birthday"`
	Gender      string           `json:"gender"`
	IsSelf      bool             `json:"isSelf"`
	Stats       map[string]int64 `json:"stats"`
}

// PublicSubmissionItem 公开主页的投稿列表项（裁剪过的 DTO，不含评审信息）
type PublicSubmissionItem struct {
	ID            int64      `json:"id"`
	Title         string     `json:"title"`
	Artist        string     `json:"artist"`
	Album         string     `json:"album"`
	Language      string     `json:"language"`
	Languages     []string   `json:"languages"`
	Status        string     `json:"status"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	FileUpdatedAt *time.Time `json:"fileUpdatedAt,omitempty"`
}

// PublicSubmissionList 公开投稿列表结果
type PublicSubmissionList struct {
	Total int64                  `json:"total"`
	Items []PublicSubmissionItem `json:"items"`
}

// PublicSubmissionQuery 公开投稿列表查询参数
type PublicSubmissionQuery struct {
	Status   string
	Language string
	Sort     string
	Page     int
	Limit    int
}

// UpdateMyProfileRequest 更新本地主页资料
type UpdateMyProfileRequest struct {
	Bio      string  `json:"bio"`
	Birthday *string `json:"birthday"`
	Gender   string  `json:"gender"`
}

// MyProfileFields 本地主页资料（写入成功后的回执）
type MyProfileFields struct {
	Bio       string  `json:"bio"`
	BannerKey string  `json:"bannerKey"`
	Birthday  *string `json:"birthday"`
	Gender    string  `json:"gender"`
}

// UserProfileService 公开用户主页业务逻辑
type UserProfileService struct {
	profiles *repository.UserProfileRepo
	subs     *repository.SubmissionRepo
	files    *FileService
	casdoor  *infrastructure.CasdoorClient
	org      string
}

// NewUserProfileService 创建服务
func NewUserProfileService(
	profiles *repository.UserProfileRepo,
	subs *repository.SubmissionRepo,
	files *FileService,
	casdoor *infrastructure.CasdoorClient,
	org string,
) *UserProfileService {
	return &UserProfileService{
		profiles: profiles,
		subs:     subs,
		files:    files,
		casdoor:  casdoor,
		org:      org,
	}
}

// GetPublicProfile 聚合主页资料。
// viewer 为空表示匿名访客；viewer == name 表示本人，能看到全部状态的计数。
func (s *UserProfileService) GetPublicProfile(ctx context.Context, name, viewer string) (*PublicProfile, error) {
	u, err := s.casdoor.GetUser(ctx, s.org, name)
	if err != nil {
		if errors.Is(err, infrastructure.ErrCasdoorUserNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	p, err := s.profiles.Get(ctx, name)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if p == nil {
		p = &model.UserProfile{Username: name}
	}

	isSelf := viewer != "" && viewer == name

	stats, err := s.subs.Stats(ctx, name)
	if err != nil {
		return nil, err
	}

	return &PublicProfile{
		Name:        name,
		DisplayName: u.DisplayName,
		Avatar:      u.Avatar,
		CreatedTime: normalizeCreatedTime(u.CreatedTime),
		Bio:         p.Bio,
		BannerKey:   p.BannerKey,
		Birthday:    formatBirthday(p.Birthday),
		Gender:      normalizeGender(p.Gender),
		IsSelf:      isSelf,
		Stats:       statsMap(stats, isSelf),
	}, nil
}

// ListPublicSubmissions 查询某用户的投稿列表。
// 访客只能看到 approved：无论传入什么 status 都强制覆盖。
func (s *UserProfileService) ListPublicSubmissions(
	ctx context.Context, name string, isSelf bool, q PublicSubmissionQuery,
) (*PublicSubmissionList, error) {
	status := q.Status
	if status == "" {
		status = "all"
	}
	if !isSelf {
		status = model.StatusApproved
	}

	res, err := s.subs.List(ctx, repository.ListQuery{
		Mode:      "creator",
		Submitter: name,
		Status:    status,
		Language:  q.Language,
		Sort:      q.Sort,
		Page:      q.Page,
		Limit:     q.Limit,
	})
	if err != nil {
		return nil, err
	}

	items := make([]PublicSubmissionItem, 0, len(res.Items))
	for i := range res.Items {
		items = append(items, toPublicSubmissionItem(&res.Items[i]))
	}
	return &PublicSubmissionList{Total: res.Total, Items: items}, nil
}

// UpdateMyProfile 写入本地主页资料（不进 Casdoor）
func (s *UserProfileService) UpdateMyProfile(
	ctx context.Context, username string, req UpdateMyProfileRequest,
) (*MyProfileFields, error) {
	bio := strings.TrimSpace(req.Bio)
	if utf8.RuneCountInString(bio) > MaxBioLen {
		return nil, ErrInvalidInput
	}
	gender := strings.TrimSpace(req.Gender)
	if gender == "" {
		gender = model.GenderUnknown
	}
	if !isValidGender(gender) {
		return nil, ErrInvalidInput
	}

	birthday, err := parseBirthday(req.Birthday)
	if err != nil {
		return nil, err
	}

	p := &model.UserProfile{
		Username: username,
		Bio:      bio,
		Birthday: birthday,
		Gender:   gender,
	}
	if err := s.profiles.Upsert(ctx, p); err != nil {
		return nil, err
	}

	bannerKey := ""
	if existing, err := s.profiles.Get(ctx, username); err == nil {
		bannerKey = existing.BannerKey
	}

	return &MyProfileFields{
		Bio:       bio,
		BannerKey: bannerKey,
		Birthday:  formatBirthday(birthday),
		Gender:    gender,
	}, nil
}

// UploadBanner 上传主页背景图并写回 key，返回新的对象 key
func (s *UserProfileService) UploadBanner(ctx context.Context, username string, content []byte) (string, error) {
	if len(content) == 0 {
		return "", ErrInvalidInput
	}
	ext := sniffImageExt(content)
	if ext == "" || isSVG(content) {
		return "", ErrInvalidInput
	}
	switch ext {
	case ".jpg", ".jpeg", ".png", ".webp":
	default:
		return "", ErrInvalidInput
	}

	oldKey := ""
	old, err := s.profiles.Get(ctx, username)
	switch {
	case err == nil:
		oldKey = old.BannerKey
	case errors.Is(err, gorm.ErrRecordNotFound):
	default:
		return "", err
	}

	key, err := s.files.UploadProfileBanner(ctx, username, content, ext)
	if err != nil {
		return "", err
	}

	if err := s.profiles.UpdateBanner(ctx, username, key); err != nil {
		// 落库失败时删掉刚传的对象，避免产生孤儿
		if delErr := s.files.Delete(ctx, key); delErr != nil {
			logrus.WithError(delErr).Warn("cleanup profile banner after db failure failed")
		}
		return "", err
	}

	if oldKey != "" && oldKey != key {
		if delErr := s.files.Delete(ctx, oldKey); delErr != nil {
			logrus.WithError(delErr).Warn("delete previous profile banner failed")
		}
	}
	return key, nil
}

// ---------- helpers ----------

func toPublicSubmissionItem(s *model.Submission) PublicSubmissionItem {
	return PublicSubmissionItem{
		ID:            s.ID,
		Title:         s.Title,
		Artist:        s.Artist,
		Album:         s.Album,
		Language:      s.Language,
		Languages:     s.Languages,
		Status:        s.Status,
		CreatedAt:     s.CreatedAt,
		UpdatedAt:     s.UpdatedAt,
		FileUpdatedAt: s.FileUpdatedAt,
	}
}

// statsMap 把仓库层的固定结构体展开成 map。
// 访客视角只暴露 approved，避免泄露待审 / 被拒的数量。
func statsMap(st *repository.Stats, isSelf bool) map[string]int64 {
	if !isSelf {
		return map[string]int64{model.StatusApproved: st.Approved}
	}
	return map[string]int64{
		model.StatusDraft:        st.Draft,
		model.StatusPending:      st.Pending,
		model.StatusReviewing:    st.Reviewing,
		model.StatusRevised:      st.Revised,
		model.StatusNeedRevision: st.NeedRevision,
		model.StatusMissingAudio: st.MissingAudio,
		model.StatusApproved:     st.Approved,
		model.StatusRejected:     st.Rejected,
		model.StatusClosed:       st.Closed,
	}
}

func formatBirthday(t *time.Time) *string {
	if t == nil || t.IsZero() {
		return nil
	}
	v := t.Format("2006-01-02")
	return &v
}

// parseBirthday 空值 → nil；否则解析 YYYY-MM-DD 并做合理性校验
func parseBirthday(raw *string) (*time.Time, error) {
	if raw == nil {
		return nil, nil
	}
	v := strings.TrimSpace(*raw)
	if v == "" {
		return nil, nil
	}
	t, err := time.ParseInLocation("2006-01-02", v, time.Local)
	if err != nil {
		return nil, ErrInvalidInput
	}
	now := time.Now()
	if t.After(now) || t.Year() < 1900 {
		return nil, ErrInvalidInput
	}
	return &t, nil
}

func normalizeGender(g string) string {
	if g == "" {
		return model.GenderUnknown
	}
	return g
}

// normalizeCreatedTime 过滤 Casdoor 返回的「未设置」创建时间。
//
// Casdoor 对没有 createdTime 的用户会返回 Go 零值时间（0001-01-01T00:00:00Z），
// 直接透传会让主页显示 "0001-01-01"，这里统一折算成空串由前端隐藏。
func normalizeCreatedTime(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		// 解析不了的格式原样返回，不因为一个展示字段丢掉数据
		return raw
	}
	if t.Year() < 1900 {
		return ""
	}
	return raw
}

func isValidGender(g string) bool {
	switch g {
	case model.GenderMale, model.GenderFemale, model.GenderOther, model.GenderUnknown:
		return true
	}
	return false
}
