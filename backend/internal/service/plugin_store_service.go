package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/Masterminds/semver/v3"
	"github.com/amll-dev/amll-hub/backend/internal/config"
	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"gorm.io/gorm"
)

// 插件商店错误
var (
	ErrPluginNotFound        = errors.New("plugin not found")
	ErrPluginVersionNotFound = errors.New("plugin version not found")
	ErrPluginForbidden       = errors.New("forbidden to publish this plugin")
	ErrPluginVersionExists   = errors.New("plugin version already exists")
	ErrPluginDuplicateSHA    = errors.New("plugin artifact already uploaded")
	ErrPluginValidation      = errors.New("plugin package validation failed")
	ErrPluginInvalidStatus   = errors.New("plugin status does not allow this action")
	ErrPluginInvalidInput    = errors.New("invalid plugin input")
	ErrPluginReviewConflict  = errors.New("plugin version was already processed")
	ErrPluginReservedID      = errors.New("plugin id is reserved")
	ErrPluginIconTooLarge    = errors.New("plugin icon exceeds the size limit")
	ErrPluginIconFormat      = errors.New("plugin icon format is not supported")
	ErrPluginIconMissing     = errors.New("plugin icon not found")
	ErrPluginArtifactMissing = errors.New("plugin artifact not found")
	ErrPluginCommentEmpty    = errors.New("plugin comment content is empty")
	ErrPluginCommentTooLong  = errors.New("plugin comment content is too long")
	ErrPluginRatingInvalid   = errors.New("plugin rating must be between 1 and 5")
)

// PluginIssueError 携带校验 issues 的错误
type PluginIssueError struct {
	Issues []PluginIssue
}

func (e *PluginIssueError) Error() string {
	if len(e.Issues) == 0 {
		return ErrPluginValidation.Error()
	}
	var b strings.Builder
	b.WriteString(ErrPluginValidation.Error())
	for _, issue := range e.Issues {
		path := issue.Path
		if path == "" {
			path = "/"
		}
		b.WriteString("; ")
		b.WriteString(path)
		b.WriteString(": ")
		b.WriteString(issue.Message)
	}
	return b.String()
}

func (e *PluginIssueError) Unwrap() error { return ErrPluginValidation }

// PluginUser 当前登录用户
type PluginUser struct {
	Name        string
	DisplayName string
	Avatar      string
}

func (u *PluginUser) Info() model.UserInfo {
	return model.UserInfo{Username: u.Name, DisplayName: u.DisplayName, Avatar: u.Avatar}
}

// PluginSubmissionInput 上传表单元数据
type PluginSubmissionInput struct {
	Summary       string   `json:"summary"`
	DescriptionMD string   `json:"descriptionMd"`
	Homepage      string   `json:"homepage"`
	RepoURL       string   `json:"repoUrl"`
	License       string   `json:"license"`
	Tags          []string `json:"tags"`
	ReadmeMD      string   `json:"readmeMd"`
	ChangelogMD   string   `json:"changelogMd"`
	Platforms     []string `json:"platforms"`
	MinAppVersion string   `json:"minAppVersion"`
	// TargetPluginKey 更新已有插件时指定目标插件，manifest.id 必须与之一致
	TargetPluginKey string `json:"-"`
}

// PluginSubmissionResult 上传成功返回
type PluginSubmissionResult struct {
	ID            int64         `json:"id"`
	PluginKey     string        `json:"pluginKey"`
	Version       string        `json:"version"`
	Channel       string        `json:"channel"`
	ReviewStatus  string        `json:"reviewStatus"`
	ListingStatus string        `json:"listingStatus"`
	SHA256        string        `json:"sha256"`
	Issues        []PluginIssue `json:"issues"`
	// IconUploadFailed 投稿成功但写入包内图标失败
	IconUploadFailed bool `json:"iconUploadFailed,omitempty"`
}

// PluginStoreService 商店上传、查询、管理
type PluginStoreService struct {
	cfg       *config.Config
	db        *gorm.DB
	plugins   *repository.PluginRepo
	versions  *repository.PluginVersionRepo
	reviews   *repository.PluginReviewRepo
	audits    *repository.PluginAuditRepo
	comments  *repository.PluginCommentRepo
	ratings   *repository.PluginRatingRepo
	files     *PluginStoreFileService
	validator *PluginValidator
	catalog   *PluginCatalogService
}

// PluginNotifier 插件通知回调
type PluginNotifier interface {
	NotifyPluginReviewResult(ctx context.Context, version *model.PluginVersion, plugin *model.Plugin, action, comment string) error
}

func NewPluginStoreService(
	cfg *config.Config,
	db *gorm.DB,
	plugins *repository.PluginRepo,
	versions *repository.PluginVersionRepo,
	reviews *repository.PluginReviewRepo,
	audits *repository.PluginAuditRepo,
	comments *repository.PluginCommentRepo,
	ratings *repository.PluginRatingRepo,
	files *PluginStoreFileService,
	validator *PluginValidator,
	catalog *PluginCatalogService,
) *PluginStoreService {
	return &PluginStoreService{
		cfg:       cfg,
		db:        db,
		plugins:   plugins,
		versions:  versions,
		reviews:   reviews,
		audits:    audits,
		comments:  comments,
		ratings:   ratings,
		files:     files,
		validator: validator,
		catalog:   catalog,
	}
}

// ValidateFile 校验磁盘上的 ZIP
func (s *PluginStoreService) ValidateFile(path string) (*PluginValidationResult, int64, error) {
	result, size, err := s.validator.ValidateFile(path)
	if err != nil {
		return nil, 0, err
	}
	if !result.OK {
		return result, size, &PluginIssueError{Issues: result.Issues}
	}
	return result, size, nil
}

// CreateSubmission 校验并入库 pending 版本
func (s *PluginStoreService) CreateSubmission(
	ctx context.Context,
	user *PluginUser,
	result *PluginValidationResult,
	sha string,
	size int64,
	tmpPath string,
	in *PluginSubmissionInput,
) (*PluginSubmissionResult, error) {
	if result == nil || !result.OK {
		if result != nil {
			return nil, &PluginIssueError{Issues: result.Issues}
		}
		return nil, ErrPluginValidation
	}

	manifest := result.Manifest
	pluginKey := manifestString(manifest, "id")
	version := manifestString(manifest, "version")

	if len(pluginKey) > 100 {
		return nil, &PluginIssueError{Issues: []PluginIssue{{Path: "/manifest/id", Message: "must contain at most 100 characters"}}}
	}
	if len(version) > 64 {
		return nil, &PluginIssueError{Issues: []PluginIssue{{Path: "/manifest/version", Message: "must contain at most 64 characters"}}}
	}
	// 更新已有插件：只允许在该插件下追加版本，避免 manifest.id 不同时误建新插件
	if in.TargetPluginKey != "" {
		if pluginKey != in.TargetPluginKey {
			return nil, &PluginIssueError{Issues: []PluginIssue{{
				Path:    "/manifest/id",
				Message: "必须与当前插件 ID 一致（" + in.TargetPluginKey + "）",
			}}}
		}
		if _, err := s.plugins.GetByKey(ctx, in.TargetPluginKey); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, ErrPluginNotFound
			}
			return nil, err
		}
	}
	if err := s.checkReservedID(pluginKey); err != nil {
		return nil, err
	}
	// 同一插件包只允许出现一次；更新已有插件时允许复用同版本包
	if in.TargetPluginKey == "" {
		if count, err := s.versions.CountBySHA(ctx, sha); err != nil {
			return nil, err
		} else if count > 0 {
			return nil, ErrPluginDuplicateSHA
		}
	}

	if pkg.UTF16Len(in.License) > 128 {
		return nil, fmt.Errorf("%w: license 最多 128 个字符", ErrPluginInvalidInput)
	}

	platforms := normalizePlatforms(in.Platforms)
	if len(platforms) == 0 {
		platforms = []string{"web", "desktop"}
	}
	if in.MinAppVersion != "" && !IsValidPluginVersion(in.MinAppVersion) {
		return nil, fmt.Errorf("%w: minAppVersion 必须是 semver", ErrPluginInvalidInput)
	}

	existing, err := s.plugins.GetByKey(ctx, pluginKey)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if existing != nil {
		if existing.OwnerUsername != user.Name {
			return nil, ErrPluginForbidden
		}
		if existing.Status == model.PluginStatusBlocked {
			return nil, ErrPluginForbidden
		}
		if _, err := s.versions.GetByPluginAndVersion(ctx, existing.ID, version); err == nil {
			// 更新插件时允许相同版本：在原版本上覆盖并重新进入审核
			if in.TargetPluginKey == "" {
				return nil, ErrPluginVersionExists
			}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		var channel string
		err := s.db.WithContext(ctx).Model(&model.PluginVersion{}).
			Where("plugin_id = ?", existing.ID).
			Order("id").Limit(1).Pluck("channel", &channel).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		if channel != "" && channel != result.Kind {
			return nil, fmt.Errorf("%w: 同一插件所有版本 channel 必须一致", ErrPluginInvalidInput)
		}
	}

	artifactFile, err := os.Open(tmpPath)
	if err != nil {
		return nil, err
	}
	artifactCreated, err := s.files.PutArtifact(ctx, sha, artifactFile, size)
	_ = artifactFile.Close()
	if err != nil {
		return nil, err
	}

	var created *model.PluginVersion
	now := time.Now()
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		plugin := existing
		if plugin == nil {
			plugin = &model.Plugin{
				PluginKey:     pluginKey,
				Name:          manifestString(manifest, "name"),
				Summary:       truncateRunes(in.Summary, 512),
				DescriptionMD: in.DescriptionMD,
				Author:        manifestString(manifest, "author"),
				Homepage:      manifestString(manifest, "homepage"),
				RepoURL:       in.RepoURL,
				License:       in.License,
				Tags:          model.JSONStringArray(normalizePluginTags(in.Tags)),
				OwnerUsername: user.Name,
				Status:        model.PluginStatusActive,
			}
			if err := s.plugins.Create(ctx, tx, plugin); err != nil {
				return err
			}
		}

		// 更新模式允许相同版本号与相同插件包，追加一条历史记录
		created = &model.PluginVersion{
			PluginID:      plugin.ID,
			Version:       version,
			Channel:       result.Kind,
			APIVersion:    manifestAPIVersion(manifest, result.Kind),
			MinAppVersion: in.MinAppVersion,
			Platforms:     model.JSONStringArray(platforms),
			Entry:         result.Entry,
			ArtifactKey:   s.files.ArtifactKey(sha),
			SHA256:        sha,
			SizeBytes:     size,
			Manifest:      model.JSONObject(manifest),
			ReadmeMD:      in.ReadmeMD,
			ChangelogMD:   in.ChangelogMD,
			ReviewStatus:  model.PluginReviewPending,
			ListingStatus: model.PluginListingUnlisted,
			SubmittedBy:   user.Name,
			SubmitterInfo: user.Info(),
			SubmittedAt:   now,
		}
		return s.versions.Create(ctx, tx, created)
	})
	if txErr != nil {
		if artifactCreated {
			_ = s.files.DeleteArtifact(ctx, sha)
		}
		return nil, txErr
	}

	return &PluginSubmissionResult{
		ID:            created.ID,
		PluginKey:     pluginKey,
		Version:       version,
		Channel:       created.Channel,
		ReviewStatus:  created.ReviewStatus,
		ListingStatus: created.ListingStatus,
		SHA256:        sha,
	}, nil
}

func (s *PluginStoreService) checkReservedID(pluginKey string) error {
	for _, reserved := range s.cfg.PluginStore.ReservedIDs {
		if reserved == pluginKey {
			return ErrPluginReservedID
		}
		if strings.HasSuffix(reserved, "*") && strings.HasPrefix(pluginKey, strings.TrimSuffix(reserved, "*")) {
			return ErrPluginReservedID
		}
	}
	return nil
}

func manifestAPIVersion(manifest map[string]any, kind string) int {
	if kind == PluginKindTheme {
		if v, ok := manifest["themeApiVersion"].(float64); ok {
			return int(v)
		}
		return 0
	}
	if v, ok := manifest["apiVersion"].(float64); ok {
		return int(v)
	}
	return 0
}

func normalizePlatforms(in []string) []string {
	allowed := map[string]bool{"web": true, "desktop": true}
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, 2)
	for _, p := range in {
		p = strings.TrimSpace(strings.ToLower(p))
		if !allowed[p] {
			continue
		}
		if _, dup := seen[p]; dup {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}

func normalizePluginTags(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, tag := range in {
		tag = strings.TrimSpace(tag)
		if tag == "" || len([]rune(tag)) > 32 {
			continue
		}
		if _, dup := seen[tag]; dup {
			continue
		}
		seen[tag] = struct{}{}
		out = append(out, tag)
	}
	if len(out) > 12 {
		out = out[:12]
	}
	return out
}

// IsValidPluginVersion 校验 semver 字符串
func IsValidPluginVersion(raw string) bool {
	_, err := semver.StrictNewVersion(raw)
	return err == nil
}
