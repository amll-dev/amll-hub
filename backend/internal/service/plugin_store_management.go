package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Masterminds/semver/v3"
	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"gorm.io/gorm"
)

// PluginManagementVersion 创作中心插件管理使用的版本摘要
type PluginManagementVersion struct {
	ID            int64                 `json:"id"`
	Version       string                `json:"version"`
	Channel       string                `json:"channel"`
	APIVersion    int                   `json:"apiVersion"`
	Platforms     model.JSONStringArray `json:"platforms"`
	SHA256        string                `json:"sha256"`
	SizeBytes     int64                 `json:"sizeBytes"`
	ReviewStatus  string                `json:"reviewStatus"`
	ListingStatus string                `json:"listingStatus"`
	ReviewComment string                `json:"reviewComment"`
	DownloadCount int64                 `json:"downloadCount"`
	SubmitterInfo model.UserInfo        `json:"submitterInfo"`
	Reviewer      string                `json:"reviewer"`
	ReviewerInfo  model.UserInfo        `json:"reviewerInfo"`
	SubmittedAt   time.Time             `json:"submittedAt"`
	ReviewedAt    *time.Time            `json:"reviewedAt,omitempty"`
	ListedAt      *time.Time            `json:"listedAt,omitempty"`
}

// PluginManagementItem 创作中心插件管理项
type PluginManagementItem struct {
	Plugin         model.Plugin              `json:"plugin"`
	Versions       []PluginManagementVersion `json:"versions"`
	LatestVersion  *PluginManagementVersion  `json:"latestVersion,omitempty"`
	ListedCount    int                       `json:"listedCount"`
	PendingCount   int                       `json:"pendingCount"`
	TotalDownloads int64                     `json:"totalDownloads"`
	IconURL        string                    `json:"iconUrl,omitempty"`
}

// PluginManagementUpdateInput 插件级展示信息编辑
type PluginManagementUpdateInput struct {
	Summary       string   `json:"summary"`
	DescriptionMD string   `json:"descriptionMd"`
	Homepage      string   `json:"homepage"`
	RepoURL       string   `json:"repoUrl"`
	License       string   `json:"license"`
	Tags          []string `json:"tags"`
}

// ListMyPlugins 发布者自己的插件与全部版本
func (s *PluginStoreService) ListMyPlugins(ctx context.Context, username string, q repository.PluginListQuery) ([]PluginManagementItem, int64, error) {
	res, err := s.plugins.ListByOwner(ctx, username, q)
	if err != nil {
		return nil, 0, err
	}
	items, err := s.buildManagementItems(ctx, res.Items)
	if err != nil {
		return nil, 0, err
	}
	return items, res.Total, nil
}

// GetPluginManagement 读取插件管理详情
func (s *PluginStoreService) GetPluginManagement(ctx context.Context, pluginKey string) (*PluginManagementItem, error) {
	plugin, err := s.plugins.GetByKey(ctx, pluginKey)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPluginNotFound
		}
		return nil, err
	}
	items, err := s.buildManagementItems(ctx, []model.Plugin{*plugin})
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, ErrPluginNotFound
	}
	return &items[0], nil
}

// GetMyPlugin 发布者读取自己的插件详情
func (s *PluginStoreService) GetMyPlugin(ctx context.Context, username, pluginKey string) (*PluginManagementItem, error) {
	item, err := s.GetPluginManagement(ctx, pluginKey)
	if err != nil {
		return nil, err
	}
	if item.Plugin.OwnerUsername != username {
		return nil, ErrPluginForbidden
	}
	return item, nil
}

// UnlistMyPlugin 发布者下架插件：把该插件所有已上架版本转为未上架
func (s *PluginStoreService) UnlistMyPlugin(ctx context.Context, user *PluginUser, pluginKey string) error {
	plugin, err := s.plugins.GetByKey(ctx, pluginKey)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPluginNotFound
		}
		return err
	}
	if plugin.OwnerUsername != user.Name {
		return ErrPluginForbidden
	}
	versions, err := s.versions.ListByPlugin(ctx, plugin.ID)
	if err != nil {
		return err
	}
	now := time.Now()
	changed := false
	for _, v := range versions {
		if v.ListingStatus != model.PluginListingListed {
			continue
		}
		ok, err := s.versions.UpdateListing(ctx, nil, v.ID, "unlist", now)
		if err != nil {
			return err
		}
		if ok {
			changed = true
		}
	}
	if changed {
		s.writeAudit(ctx, user, "plugin.unlist", "plugin", plugin.ID, "")
		s.catalog.Invalidate(ctx)
	}
	return nil
}

// RollbackMyPluginVersion 回滚到历史版本：把该版本设为当前上架版本，其他已上架版本下架
func (s *PluginStoreService) RollbackMyPluginVersion(ctx context.Context, user *PluginUser, pluginKey string, versionID int64) error {
	plugin, err := s.plugins.GetByKey(ctx, pluginKey)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPluginNotFound
		}
		return err
	}
	if plugin.OwnerUsername != user.Name {
		return ErrPluginForbidden
	}
	v, err := s.versions.GetByID(ctx, versionID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPluginVersionNotFound
		}
		return err
	}
	if v.PluginID != plugin.ID {
		return ErrPluginVersionNotFound
	}
	if v.ReviewStatus != model.PluginReviewApproved {
		return ErrPluginInvalidStatus
	}
	// 已上架的版本就是当前版本，无需切换
	if v.ListingStatus == model.PluginListingListed {
		return ErrPluginInvalidStatus
	}

	now := time.Now()
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.PluginVersion{}).
			Where("plugin_id = ? AND listing_status = ?", plugin.ID, model.PluginListingListed).
			Updates(map[string]any{
				"listing_status": model.PluginListingUnlisted,
				"listed_at":      nil,
			}).Error; err != nil {
			return err
		}
		return tx.Model(&model.PluginVersion{}).
			Where("id = ?", versionID).
			Updates(map[string]any{
				"listing_status": model.PluginListingListed,
				"listed_at":      now,
			}).Error
	}); err != nil {
		return err
	}
	s.writeAudit(ctx, user, "version.rollback", "version", versionID, "")
	s.catalog.Invalidate(ctx)
	return nil
}

// UpdateMyPlugin 编辑插件级展示信息（不改变审核/上架状态）
func (s *PluginStoreService) UpdateMyPlugin(ctx context.Context, username, pluginKey string, in *PluginManagementUpdateInput) error {
	plugin, err := s.plugins.GetByKey(ctx, pluginKey)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPluginNotFound
		}
		return err
	}
	if plugin.OwnerUsername != username {
		return ErrPluginForbidden
	}
	homepage := strings.TrimSpace(in.Homepage)
	if homepage != "" && !strings.HasPrefix(homepage, "http://") && !strings.HasPrefix(homepage, "https://") {
		homepage = "https://" + homepage
	}
	repoURL := strings.TrimSpace(in.RepoURL)
	if repoURL != "" && !strings.HasPrefix(repoURL, "http://") && !strings.HasPrefix(repoURL, "https://") {
		repoURL = "https://" + repoURL
	}
	if pkg.UTF16Len(in.Summary) > 512 {
		return fmt.Errorf("%w: summary 最多 512 个字符", ErrPluginInvalidInput)
	}
	if len(in.DescriptionMD) > 200_000 {
		return fmt.Errorf("%w: descriptionMd 过长", ErrPluginInvalidInput)
	}
	if pkg.UTF16Len(in.License) > 128 {
		return fmt.Errorf("%w: license 最多 128 个字符", ErrPluginInvalidInput)
	}
	if err := s.plugins.UpdateFields(ctx, nil, plugin.ID, map[string]any{
		"summary":        truncateRunes(in.Summary, 512),
		"description_md": in.DescriptionMD,
		"homepage":       homepage,
		"repo_url":       repoURL,
		"license":        in.License,
		"tags":           model.JSONStringArray(normalizePluginTags(in.Tags)),
	}); err != nil {
		return err
	}
	s.catalog.Invalidate(ctx)
	return nil
}

// ListComments 插件评论列表
func (s *PluginStoreService) ListComments(ctx context.Context, pluginKey string) ([]model.PluginComment, error) {
	if _, err := s.plugins.GetByKey(ctx, pluginKey); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPluginNotFound
		}
		return nil, err
	}
	return s.comments.ListByPlugin(ctx, pluginKey)
}

// AddComment 发表插件评论
func (s *PluginStoreService) AddComment(ctx context.Context, user *PluginUser, pluginKey, content string) error {
	content = strings.TrimSpace(content)
	if content == "" {
		return ErrPluginCommentEmpty
	}
	if pkg.UTF16Len(content) > 2000 {
		return ErrPluginCommentTooLong
	}
	if _, err := s.plugins.GetByKey(ctx, pluginKey); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPluginNotFound
		}
		return err
	}
	c := &model.PluginComment{
		PluginKey: pluginKey,
		Author:    user.Info(),
		Content:   sanitize(content, 2000),
	}
	return s.comments.Insert(ctx, c)
}

func (s *PluginStoreService) buildManagementItems(ctx context.Context, plugins []model.Plugin) ([]PluginManagementItem, error) {
	if len(plugins) == 0 {
		return []PluginManagementItem{}, nil
	}
	ids := make([]int64, 0, len(plugins))
	for _, p := range plugins {
		ids = append(ids, p.ID)
	}
	rows, err := s.versions.ListSummariesByPluginIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	byPlugin := make(map[int64][]repository.PluginVersionSummaryRow, len(ids))
	for _, row := range rows {
		byPlugin[row.PluginID] = append(byPlugin[row.PluginID], row)
	}
	out := make([]PluginManagementItem, 0, len(plugins))
	for _, p := range plugins {
		item := PluginManagementItem{Plugin: p, Versions: []PluginManagementVersion{}}
		for _, row := range byPlugin[p.ID] {
			platforms := []string(row.Platforms)
			if len(platforms) == 0 {
				platforms = []string{"web", "desktop"}
			}
			v := PluginManagementVersion{
				ID:            row.ID,
				Version:       row.Version,
				Channel:       row.Channel,
				APIVersion:    row.APIVersion,
				Platforms:     model.JSONStringArray(platforms),
				SHA256:        row.SHA256,
				SizeBytes:     row.SizeBytes,
				ReviewStatus:  row.ReviewStatus,
				ListingStatus: row.ListingStatus,
				ReviewComment: row.ReviewComment,
				DownloadCount: row.DownloadCount,
				SubmitterInfo: row.SubmitterInfo,
				Reviewer:      row.Reviewer,
				ReviewerInfo:  row.ReviewerInfo,
				SubmittedAt:   row.SubmittedAt,
				ReviewedAt:    row.ReviewedAt,
				ListedAt:      row.ListedAt,
			}
			item.Versions = append(item.Versions, v)
			item.TotalDownloads += row.DownloadCount
			if row.ReviewStatus == model.PluginReviewPending {
				item.PendingCount++
			}
			if row.ReviewStatus == model.PluginReviewApproved && row.ListingStatus == model.PluginListingListed {
				item.ListedCount++
			}
		}
		if len(item.Versions) > 0 {
			latest := item.Versions[0]
			latestVer, latestErr := semver.NewVersion(latest.Version)
			for _, v := range item.Versions[1:] {
				ver, err := semver.NewVersion(v.Version)
				if err == nil && (latestErr != nil || ver.GreaterThan(latestVer)) {
					latest, latestVer, latestErr = v, ver, nil
				}
			}
			item.LatestVersion = &latest
		}
		if p.IconKey != "" {
			item.IconURL = PluginIconURLVersioned(p.PluginKey, p.IconKey)
		}
		out = append(out, item)
	}
	return out, nil
}

// ListMine 我的投稿
func (s *PluginStoreService) ListMine(ctx context.Context, username string, q repository.PluginVersionListQuery) ([]PluginSubmissionDetail, int64, error) {
	q.Submitter = username
	items, total, err := s.versions.ListMine(ctx, q)
	if err != nil {
		return nil, 0, err
	}
	out := make([]PluginSubmissionDetail, 0, len(items))
	for i := range items {
		out = append(out, s.submissionDetail(ctx, &items[i]))
	}
	return out, total, nil
}

// PluginSubmissionDetail 投稿详情
type PluginSubmissionDetail struct {
	Version       model.PluginVersion         `json:"version"`
	Plugin        model.Plugin                `json:"plugin"`
	PluginKey     string                      `json:"pluginKey"`
	PluginName    string                      `json:"pluginName"`
	ReviewHistory []model.PluginReviewHistory `json:"reviewHistory"`
}

func (s *PluginStoreService) submissionDetail(ctx context.Context, v *model.PluginVersion) PluginSubmissionDetail {
	detail := PluginSubmissionDetail{Version: *v}
	if plugin, err := s.plugins.GetByID(ctx, v.PluginID); err == nil {
		detail.Plugin = *plugin
		detail.PluginKey = plugin.PluginKey
		detail.PluginName = plugin.Name
	}
	if history, err := s.reviews.ListByVersion(ctx, v.ID); err == nil {
		if history == nil {
			history = []model.PluginReviewHistory{}
		}
		detail.ReviewHistory = history
	}
	return detail
}

// GetMine 我的投稿详情
func (s *PluginStoreService) GetMine(ctx context.Context, username string, isAdmin bool, id int64) (*PluginSubmissionDetail, error) {
	v, err := s.versions.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPluginVersionNotFound
		}
		return nil, err
	}
	if v.SubmittedBy != username && !isAdmin {
		return nil, ErrPluginForbidden
	}
	detail := s.submissionDetail(ctx, v)
	return &detail, nil
}

// UpdateMine 修改 pending / rejected 版本的展示元数据
func (s *PluginStoreService) UpdateMine(ctx context.Context, username string, id int64, in *PluginSubmissionInput) error {
	v, err := s.versions.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPluginVersionNotFound
		}
		return err
	}
	if v.SubmittedBy != username {
		return ErrPluginForbidden
	}
	if v.ReviewStatus != model.PluginReviewPending && v.ReviewStatus != model.PluginReviewRejected {
		return ErrPluginInvalidStatus
	}
	platforms := normalizePlatforms(in.Platforms)
	if len(platforms) == 0 {
		platforms = []string(v.Platforms)
	}
	if err := s.versions.UpdateMetadata(ctx, id, map[string]any{
		"readme_md":       in.ReadmeMD,
		"changelog_md":    in.ChangelogMD,
		"platforms":       model.JSONStringArray(platforms),
		"min_app_version": in.MinAppVersion,
	}); err != nil {
		return err
	}
	// platforms / minAppVersion 会进入 catalog，需要失效缓存
	s.catalog.Invalidate(ctx)
	return nil
}

// GetMineArtifact 作者/审核员/管理员下载原包
func (s *PluginStoreService) GetMineArtifact(ctx context.Context, username string, isReviewer, isAdmin bool, id int64) (*model.PluginVersion, *model.Plugin, error) {
	v, err := s.versions.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrPluginVersionNotFound
		}
		return nil, nil, err
	}
	if v.SubmittedBy != username && !isReviewer && !isAdmin {
		return nil, nil, ErrPluginForbidden
	}
	plugin, err := s.plugins.GetByID(ctx, v.PluginID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrPluginNotFound
		}
		return nil, nil, err
	}
	return v, plugin, nil
}
