package service

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/Masterminds/semver/v3"
	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"
)

// PluginVersionSummary 列表卡片用的轻量版本信息（不含 manifest / README）
type PluginVersionSummary struct {
	ID            int64                 `json:"id"`
	Version       string                `json:"version"`
	Channel       string                `json:"channel"`
	APIVersion    int                   `json:"apiVersion"`
	Platforms     model.JSONStringArray `json:"platforms"`
	SHA256        string                `json:"sha256"`
	SizeBytes     int64                 `json:"sizeBytes"`
	DownloadCount int64                 `json:"downloadCount"`
	MinAppVersion string                `json:"minAppVersion"`
	ListedAt      *time.Time            `json:"listedAt,omitempty"`
}

// PluginRatingSummary 插件评分聚合
type PluginRatingSummary struct {
	Score        float64          `json:"score"`
	Count        int64            `json:"count"`
	Distribution map[string]int64 `json:"distribution"`
}

// PluginPublicListItem 公开列表项
type PluginPublicListItem struct {
	Plugin   model.Plugin         `json:"plugin"`
	Version  PluginVersionSummary `json:"version"`
	Versions []PluginVersionItem  `json:"versions"`
	IconURL  string               `json:"iconUrl,omitempty"`
	Rating   PluginRatingSummary  `json:"rating"`
}

// PluginVersionItem 版本摘要
type PluginVersionItem struct {
	Version    string     `json:"version"`
	Channel    string     `json:"channel"`
	APIVersion int        `json:"apiVersion"`
	Platforms  []string   `json:"platforms"`
	ListedAt   *time.Time `json:"listedAt,omitempty"`
	YankedAt   *time.Time `json:"yankedAt,omitempty"`
}

// PluginDetail 公开详情
type PluginDetail struct {
	Plugin   model.Plugin        `json:"plugin"`
	Version  model.PluginVersion `json:"version"`
	Versions []PluginVersionItem `json:"versions"`
	IconURL  string              `json:"iconUrl,omitempty"`
	Rating   PluginRatingSummary `json:"rating"`
	// 当前用户评分，0 表示未评分
	MyScore int `json:"myScore"`
	// 插件全部历史版本的下载总数（升级新版本后仍保留累计值）
	TotalDownloads int64 `json:"totalDownloads"`
}

// ListPublic 商店首页列表
func (s *PluginStoreService) ListPublic(ctx context.Context, q repository.PluginListQuery) ([]PluginPublicListItem, int64, error) {
	res, err := s.plugins.ListPublic(ctx, q)
	if err != nil {
		return nil, 0, err
	}
	ids := make([]int64, 0, len(res.Items))
	for i := range res.Items {
		ids = append(ids, res.Items[i].ID)
	}
	versions, err := s.versions.ListListedByPluginIDs(ctx, ids)
	if err != nil {
		return nil, 0, err
	}
	byPlugin := make(map[int64][]model.PluginVersion, len(ids))
	for _, v := range versions {
		byPlugin[v.PluginID] = append(byPlugin[v.PluginID], v)
	}

	items := make([]PluginPublicListItem, 0, len(res.Items))
	for i := range res.Items {
		plugin := res.Items[i]
		list := byPlugin[plugin.ID]
		if len(list) == 0 {
			continue
		}
		latest := pickLatestVersion(list)
		iconURL := ""
		if plugin.IconKey != "" {
			iconURL = PluginIconURLVersioned(plugin.PluginKey, plugin.IconKey)
		}
		items = append(items, PluginPublicListItem{
			Plugin:   plugin,
			Version:  toVersionSummary(latest),
			Versions: toVersionItems(list),
			IconURL:  iconURL,
		})
	}

	keys := make([]string, 0, len(items))
	for i := range items {
		keys = append(keys, items[i].Plugin.PluginKey)
	}
	summaries, err := s.ratings.Summaries(ctx, keys)
	if err != nil {
		return nil, 0, err
	}
	for i := range items {
		items[i].Rating = ratingSummaryFromRow(summaries[items[i].Plugin.PluginKey])
	}
	return items, res.Total, nil
}

// GetPublic 公开详情；viewer 非空时附带当前用户评分
func (s *PluginStoreService) GetPublic(ctx context.Context, key, viewer string) (*PluginDetail, error) {
	plugin, err := s.plugins.GetByKey(ctx, key)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPluginNotFound
		}
		return nil, err
	}
	if plugin.Status != model.PluginStatusActive {
		return nil, ErrPluginNotFound
	}
	all, err := s.versions.ListByPlugin(ctx, plugin.ID)
	if err != nil {
		return nil, err
	}
	listed := make([]model.PluginVersion, 0, len(all))
	for _, v := range all {
		if v.ReviewStatus == model.PluginReviewApproved && v.ListingStatus == model.PluginListingListed {
			listed = append(listed, v)
		}
	}
	if len(listed) == 0 {
		return nil, ErrPluginNotFound
	}
	latest := pickLatestVersion(listed)
	iconURL := ""
	if plugin.IconKey != "" {
		iconURL = PluginIconURLVersioned(plugin.PluginKey, plugin.IconKey)
	}
	summaries, err := s.ratings.Summaries(ctx, []string{plugin.PluginKey})
	if err != nil {
		return nil, err
	}
	myScore, err := s.ratings.GetUserScore(ctx, plugin.PluginKey, viewer)
	if err != nil {
		return nil, err
	}
	var totalDownloads int64
	for _, v := range all {
		totalDownloads += v.DownloadCount
	}
	return &PluginDetail{
		Plugin:         *plugin,
		Version:        latest,
		Versions:       toVersionItems(listed),
		IconURL:        iconURL,
		Rating:         ratingSummaryFromRow(summaries[plugin.PluginKey]),
		MyScore:        myScore,
		TotalDownloads: totalDownloads,
	}, nil
}

// RatePlugin 提交或更新当前用户评分，返回最新聚合与本人评分
func (s *PluginStoreService) RatePlugin(ctx context.Context, user *PluginUser, key string, score int) (*PluginRatingSummary, int, error) {
	if score < 1 || score > 5 {
		return nil, 0, ErrPluginRatingInvalid
	}
	plugin, err := s.plugins.GetByKey(ctx, key)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, 0, ErrPluginNotFound
		}
		return nil, 0, err
	}
	if plugin.Status != model.PluginStatusActive {
		return nil, 0, ErrPluginNotFound
	}
	if err := s.ratings.Upsert(ctx, plugin.PluginKey, user.Name, score); err != nil {
		return nil, 0, err
	}
	summaries, err := s.ratings.Summaries(ctx, []string{plugin.PluginKey})
	if err != nil {
		return nil, 0, err
	}
	summary := ratingSummaryFromRow(summaries[plugin.PluginKey])
	return &summary, score, nil
}

// ratingSummaryFromRow 聚合行转换为对外结构（无评分时返回空分布）
func ratingSummaryFromRow(row repository.PluginRatingSummaryRow) PluginRatingSummary {
	summary := PluginRatingSummary{
		Distribution: map[string]int64{"1": 0, "2": 0, "3": 0, "4": 0, "5": 0},
	}
	if row.Total <= 0 {
		return summary
	}
	summary.Count = row.Total
	summary.Score = math.Round(float64(row.Sum)/float64(row.Total)*10) / 10
	summary.Distribution = map[string]int64{
		"1": row.Score1,
		"2": row.Score2,
		"3": row.Score3,
		"4": row.Score4,
		"5": row.Score5,
	}
	return summary
}

func pickLatestVersion(list []model.PluginVersion) model.PluginVersion {
	best := list[0]
	bestVer, err := semver.NewVersion(best.Version)
	for _, v := range list[1:] {
		ver, err2 := semver.NewVersion(v.Version)
		switch {
		case err == nil && err2 == nil && ver.GreaterThan(bestVer):
			best, bestVer, err = v, ver, nil
		case err != nil && err2 == nil:
			best, bestVer, err = v, ver, nil
		}
	}
	return best
}

func toVersionSummary(v model.PluginVersion) PluginVersionSummary {
	platforms := []string(v.Platforms)
	if len(platforms) == 0 {
		platforms = []string{"web", "desktop"}
	}
	return PluginVersionSummary{
		ID:            v.ID,
		Version:       v.Version,
		Channel:       v.Channel,
		APIVersion:    v.APIVersion,
		Platforms:     model.JSONStringArray(platforms),
		SHA256:        v.SHA256,
		SizeBytes:     v.SizeBytes,
		DownloadCount: v.DownloadCount,
		MinAppVersion: v.MinAppVersion,
		ListedAt:      v.ListedAt,
	}
}

func toVersionItems(list []model.PluginVersion) []PluginVersionItem {
	out := make([]PluginVersionItem, 0, len(list))
	for _, v := range list {
		platforms := []string(v.Platforms)
		if len(platforms) == 0 {
			platforms = []string{"web", "desktop"}
		}
		out = append(out, PluginVersionItem{
			Version:    v.Version,
			Channel:    v.Channel,
			APIVersion: v.APIVersion,
			Platforms:  platforms,
			ListedAt:   v.ListedAt,
			YankedAt:   v.YankedAt,
		})
	}
	return out
}

// GetPublicArtifact 公开下载前查询：仅 approved + listed 且插件 active
func (s *PluginStoreService) GetPublicArtifact(ctx context.Context, sha string) (*model.PluginVersion, *model.Plugin, error) {
	var version model.PluginVersion
	err := s.db.WithContext(ctx).
		Where("sha256 = ? AND review_status = ? AND listing_status = ?", sha, model.PluginReviewApproved, model.PluginListingListed).
		First(&version).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrPluginArtifactMissing
		}
		return nil, nil, err
	}
	plugin, err := s.plugins.GetByID(ctx, version.PluginID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrPluginArtifactMissing
		}
		return nil, nil, err
	}
	if plugin.Status != model.PluginStatusActive {
		return nil, nil, ErrPluginArtifactMissing
	}
	return &version, plugin, nil
}

// IncrementDownload 异步计数
func (s *PluginStoreService) IncrementDownload(ctx context.Context, sha string) {
	if err := s.versions.IncrementDownload(ctx, sha); err != nil {
		logrus.WithError(err).WithField("sha256", sha).Warn("increment plugin download count failed")
	}
}

// Stats 商店统计
func (s *PluginStoreService) Stats(ctx context.Context) (*repository.PluginStoreStats, error) {
	return s.plugins.Stats(ctx)
}
