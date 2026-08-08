package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// NotFoundRepo 无歌词记录数据访问层
type NotFoundRepo struct {
	db *gorm.DB
}

func NewNotFoundRepo(db *gorm.DB) *NotFoundRepo {
	return &NotFoundRepo{db: db}
}

// UpsertNotFound 插入或累加无歌词记录
// - 新记录：INSERT with category='not_found'
// - 已存在：request_count + 1, last_seen_at = NOW(), 追加 daily_requests[today].ip
// 返回 (是否新增, 当前 count, err)
func (r *NotFoundRepo) UpsertNotFound(ctx context.Context, platform, platformID, clientIP string) (bool, int, error) {
	today := time.Now().Format("2006-01-02")

	// 1. 先查询是否存在
	var existing model.NotFoundRequest
	err := r.db.WithContext(ctx).
		Where("platform = ? AND platform_id = ?", platform, platformID).
		First(&existing).Error

	if err == nil {
		// 已存在：追加 IP 到 daily_requests[today]（如果未存在）
		daily := existing.DailyRequests
		if daily == nil {
			daily = model.DailyRequests{}
		}
		ips := daily[today]
		alreadyLogged := false
		for _, ip := range ips {
			if ip == clientIP {
				alreadyLogged = true
				break
			}
		}
		if !alreadyLogged {
			ips = append(ips, clientIP)
			daily[today] = ips
		}

		// 即使同 IP 已记录，也要更新 last_seen_at（仅当未记录时才 +1 count）
		updates := map[string]interface{}{
			"last_seen_at":   time.Now(),
			"daily_requests": daily,
		}
		if !alreadyLogged {
			updates["request_count"] = gorm.Expr("request_count + 1")
		}

		if err := r.db.WithContext(ctx).Model(&existing).Updates(updates).Error; err != nil {
			return false, 0, fmt.Errorf("update not_found: %w", err)
		}
		newCount := existing.RequestCount
		if !alreadyLogged {
			newCount++
		}
		return false, newCount, nil
	}

	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return false, 0, fmt.Errorf("query not_found: %w", err)
	}

	// 2. 新建记录
	record := model.NotFoundRequest{
		Platform:       platform,
		PlatformID:     platformID,
		RequestCount:   1,
		FirstSeenAt:    time.Now(),
		LastSeenAt:     time.Now(),
		DailyRequests:  model.DailyRequests{today: {clientIP}},
		FirstRequestIP: clientIP,
		Category:       model.CategoryNotFound,
	}
	if err := r.db.WithContext(ctx).Create(&record).Error; err != nil {
		// 并发情况下可能另一个请求先创建了，降级为更新
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return r.UpsertNotFound(ctx, platform, platformID, clientIP)
		}
		return false, 0, fmt.Errorf("create not_found: %w", err)
	}
	return true, 1, nil
}

// FindByPlatform 查询单条记录
func (r *NotFoundRepo) FindByPlatform(ctx context.Context, platform, platformID string) (*model.NotFoundRequest, error) {
	var rec model.NotFoundRequest
	err := r.db.WithContext(ctx).
		Where("platform = ? AND platform_id = ?", platform, platformID).
		First(&rec).Error
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

// DeleteByPlatform 按 platform + platform_id 删除（歌词补全时使用）
func (r *NotFoundRepo) DeleteByPlatform(ctx context.Context, platform, platformID string) (int64, error) {
	result := r.db.WithContext(ctx).
		Where("platform = ? AND platform_id = ? AND category = ?", platform, platformID, model.CategoryNotFound).
		Delete(&model.NotFoundRequest{})
	return result.RowsAffected, result.Error
}

// ClearWeekly 每周清空所有 category='not_found' 的记录
func (r *NotFoundRepo) ClearWeekly(ctx context.Context) (int64, error) {
	result := r.db.WithContext(ctx).
		Where("category = ?", model.CategoryNotFound).
		Delete(&model.NotFoundRequest{})
	return result.RowsAffected, result.Error
}

// RankingItem 排行榜返回项
type RankingItem struct {
	ID           int64     `json:"id"`
	Platform     string    `json:"platform"`
	PlatformID   string    `json:"platformId"`
	SongName     string    `json:"songName"`
	Artists      string    `json:"artists"` // 逗号分隔
	Cover        string    `json:"cover"`   // 封面 URL
	Album        string    `json:"album"`   // 专辑名
	RequestCount int       `json:"requestCount"`
	FirstSeenAt  time.Time `json:"firstSeenAt"`
	LastSeenAt   time.Time `json:"lastSeenAt"`
	Category     string    `json:"category"`
}

// GetRanking 查询排行榜
// days 最大 7（因为每周清空）；limit <= 0 或 > total 时返回全部
func (r *NotFoundRepo) GetRanking(ctx context.Context, days int, platform string, limit int) (int64, []RankingItem, error) {
	if days > 7 {
		days = 7
	}
	if days < 1 {
		days = 7
	}
	startTime := time.Now().AddDate(0, 0, -days)

	query := r.db.WithContext(ctx).
		Model(&model.NotFoundRequest{}).
		Where("category = ?", model.CategoryNotFound).
		Where("last_seen_at >= ?", startTime)

	if platform != "" {
		query = query.Where("platform = ?", platform)
	}

	// 总数
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return 0, nil, fmt.Errorf("count ranking: %w", err)
	}

	// 计算实际返回数量
	returnLimit := int(total)
	if limit > 0 && limit < returnLimit {
		returnLimit = limit
	}

	var items []RankingItem
	err := query.
		Order("request_count DESC").
		Limit(returnLimit).
		Find(&items).Error
	if err != nil {
		return 0, nil, fmt.Errorf("query ranking: %w", err)
	}
	return total, items, nil
}

// UpdateCategory 更新某条记录的分类（Worker 解析后回写）
func (r *NotFoundRepo) UpdateCategory(ctx context.Context, platform, platformID, category, songName string) error {
	updates := map[string]interface{}{
		"category": category,
	}
	if songName != "" {
		updates["song_name"] = songName
	}
	result := r.db.WithContext(ctx).
		Model(&model.NotFoundRequest{}).
		Where("platform = ? AND platform_id = ?", platform, platformID).
		Updates(updates)
	return result.Error
}

// --- 白名单操作 ---

// IsInWhitelist 检查是否在白名单（纯音乐或云盘）
// 同时检查 not_found_requests 表中 category 为 pure_music/cloud_music 的记录
func (r *NotFoundRepo) IsInWhitelist(ctx context.Context, platform, platformID string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&model.NotFoundRequest{}).
		Where("platform = ? AND platform_id = ? AND category IN ?", platform, platformID,
			[]string{model.CategoryPureMusic, model.CategoryCloudMusic}).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// AddPureMusic 加入纯音乐白名单
func (r *NotFoundRepo) AddPureMusic(ctx context.Context, platform, platformID, songName, reason, detectedBy string) error {
	wl := model.PureMusicWhitelist{
		Platform:   platform,
		PlatformID: platformID,
		SongName:   songName,
		Reason:     reason,
		DetectedBy: detectedBy,
	}
	// ON CONFLICT DO NOTHING
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "platform"}, {Name: "platform_id"}},
		DoNothing: true,
	}).Create(&wl).Error
}

// AddCloudMusic 加入云盘音乐白名单
func (r *NotFoundRepo) AddCloudMusic(ctx context.Context, platform, platformID, songName, reason, detectedBy string) error {
	wl := model.CloudMusicWhitelist{
		Platform:   platform,
		PlatformID: platformID,
		SongName:   songName,
		Reason:     reason,
		DetectedBy: detectedBy,
	}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "platform"}, {Name: "platform_id"}},
		DoNothing: true,
	}).Create(&wl).Error
}

// ListPureMusicWhitelist 查询纯音乐白名单
func (r *NotFoundRepo) ListPureMusicWhitelist(ctx context.Context, limit, offset int) ([]model.PureMusicWhitelist, int64, error) {
	var items []model.PureMusicWhitelist
	var total int64

	db := r.db.WithContext(ctx).Model(&model.PureMusicWhitelist{})
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if limit > 0 {
		db = db.Limit(limit).Offset(offset)
	}
	err := db.Order("detected_at DESC").Find(&items).Error
	return items, total, err
}

// ListCloudMusicWhitelist 查询云盘音乐白名单
func (r *NotFoundRepo) ListCloudMusicWhitelist(ctx context.Context, limit, offset int) ([]model.CloudMusicWhitelist, int64, error) {
	var items []model.CloudMusicWhitelist
	var total int64

	db := r.db.WithContext(ctx).Model(&model.CloudMusicWhitelist{})
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if limit > 0 {
		db = db.Limit(limit).Offset(offset)
	}
	err := db.Order("detected_at DESC").Find(&items).Error
	return items, total, err
}

// ListWhitelistForPreload 启动时批量加载白名单到 Redis
// 返回 (pure_music_keys, cloud_music_keys, err)
// 每个 key 格式为 "platform:platform_id"
func (r *NotFoundRepo) ListWhitelistForPreload(ctx context.Context) ([]string, []string, error) {
	var pureItems []model.PureMusicWhitelist
	if err := r.db.WithContext(ctx).Select("platform, platform_id").Find(&pureItems).Error; err != nil {
		return nil, nil, fmt.Errorf("load pure_music: %w", err)
	}

	var cloudItems []model.CloudMusicWhitelist
	if err := r.db.WithContext(ctx).Select("platform, platform_id").Find(&cloudItems).Error; err != nil {
		return nil, nil, fmt.Errorf("load cloud_music: %w", err)
	}

	pureKeys := make([]string, 0, len(pureItems))
	for _, p := range pureItems {
		pureKeys = append(pureKeys, p.Platform+":"+p.PlatformID)
	}

	cloudKeys := make([]string, 0, len(cloudItems))
	for _, c := range cloudItems {
		cloudKeys = append(cloudKeys, c.Platform+":"+c.PlatformID)
	}

	return pureKeys, cloudKeys, nil
}

// StatsResult 统计数据
type StatsResult struct {
	TotalNotFound   int64           `json:"totalNotFound"`
	TotalPureMusic  int64           `json:"totalPureMusic"`
	TotalCloudMusic int64           `json:"totalCloudMusic"`
	NewThisWeek     int64           `json:"newThisWeek"`
	PlatformDist    []PlatformCount `json:"platformDistribution"`
	Top10           []RankingItem   `json:"top10"`
}

// PlatformCount 平台分布
type PlatformCount struct {
	Platform string `json:"platform"`
	Count    int64  `json:"count"`
}

// GetStats 获取统计数据
func (r *NotFoundRepo) GetStats(ctx context.Context) (*StatsResult, error) {
	var stats StatsResult

	if err := r.db.WithContext(ctx).Model(&model.NotFoundRequest{}).
		Where("category = ?", model.CategoryNotFound).
		Count(&stats.TotalNotFound).Error; err != nil {
		return nil, err
	}

	if err := r.db.WithContext(ctx).Model(&model.NotFoundRequest{}).
		Where("category = ?", model.CategoryPureMusic).
		Count(&stats.TotalPureMusic).Error; err != nil {
		return nil, err
	}

	if err := r.db.WithContext(ctx).Model(&model.NotFoundRequest{}).
		Where("category = ?", model.CategoryCloudMusic).
		Count(&stats.TotalCloudMusic).Error; err != nil {
		return nil, err
	}

	weekStart := time.Now().AddDate(0, 0, -7)
	if err := r.db.WithContext(ctx).Model(&model.NotFoundRequest{}).
		Where("category = ? AND first_seen_at >= ?", model.CategoryNotFound, weekStart).
		Count(&stats.NewThisWeek).Error; err != nil {
		return nil, err
	}

	if err := r.db.WithContext(ctx).Model(&model.NotFoundRequest{}).
		Where("category = ?", model.CategoryNotFound).
		Select("platform, COUNT(*) as count").
		Group("platform").
		Order("count DESC").
		Scan(&stats.PlatformDist).Error; err != nil {
		return nil, err
	}

	if err := r.db.WithContext(ctx).Model(&model.NotFoundRequest{}).
		Where("category = ?", model.CategoryNotFound).
		Order("request_count DESC").
		Limit(10).
		Find(&stats.Top10).Error; err != nil {
		return nil, err
	}

	return &stats, nil
}
