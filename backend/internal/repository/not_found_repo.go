package repository

import (
	"context"
	"encoding/json"
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

// maxRankingLimit 排行榜硬上限，limit 缺省/过大时不把整表读进内存
const maxRankingLimit = 100

// UpsertNotFound 插入或累加无歌词记录。
//
// 使用单条 INSERT ... ON CONFLICT (platform, platform_id) DO UPDATE，由数据库
// 原子完成「是否新 IP」「计数自增」「daily_requests JSONB 追加/去重」，替代原先
// 「读整行 → Go 改 JSON → 写回」：后者在并发下会重复 +1（计数虚高）并用各自
// 读到的旧 JSON 相互覆盖（IP 名单丢失）。
//
// daily_requests 结构为 {"YYYY-MM-DD": ["ip", ...]}：
//   - 用 @> 判断当天数组是否已含该 IP，已含则计数不加、数组不追加；
//   - 用 jsonb_set + || 原子追加，不读旧值到内存。
//
// 返回 (是否新增记录, 当前累计次数, err)；RETURNING (xmax = 0) 区分
// 本次是 INSERT（新记录）还是 ON CONFLICT UPDATE（已存在）。
func (r *NotFoundRepo) UpsertNotFound(ctx context.Context, platform, platformID, clientIP string) (bool, int, error) {
	today := time.Now().Format("2006-01-02")

	initialDaily, err := json.Marshal(model.DailyRequests{today: {clientIP}})
	if err != nil {
		return false, 0, fmt.Errorf("marshal daily_requests: %w", err)
	}
	ipArray, err := json.Marshal([]string{clientIP})
	if err != nil {
		return false, 0, fmt.Errorf("marshal client ip: %w", err)
	}
	ipJSON := string(ipArray)

	const q = `
INSERT INTO not_found_requests
    (platform, platform_id, request_count, first_seen_at, last_seen_at,
     daily_requests, first_request_ip, category, created_at, updated_at)
VALUES (?, ?, 1, NOW(), NOW(), ?::jsonb, ?, ?, NOW(), NOW())
ON CONFLICT (platform, platform_id) DO UPDATE SET
    last_seen_at = NOW(),
    updated_at   = NOW(),
    request_count = not_found_requests.request_count +
        (CASE WHEN COALESCE(not_found_requests.daily_requests -> ?, '[]'::jsonb) @> ?::jsonb
              THEN 0 ELSE 1 END),
    daily_requests =
        CASE WHEN COALESCE(not_found_requests.daily_requests -> ?, '[]'::jsonb) @> ?::jsonb
             THEN not_found_requests.daily_requests
             ELSE jsonb_set(
                 not_found_requests.daily_requests,
                 ARRAY[?],
                 COALESCE(not_found_requests.daily_requests -> ?, '[]'::jsonb) || ?::jsonb
             )
        END
RETURNING (xmax = 0) AS inserted, request_count`

	var res struct {
		Inserted     bool `gorm:"column:inserted"`
		RequestCount int  `gorm:"column:request_count"`
	}
	err = r.db.WithContext(ctx).Raw(q,
		platform, platformID, string(initialDaily), clientIP, model.CategoryNotFound,
		today, ipJSON, // request_count 的 IP 去重判断
		today, ipJSON, // daily_requests 的 IP 去重判断
		today, today, ipJSON, // jsonb_set 当天数组追加
	).Scan(&res).Error
	if err != nil {
		return false, 0, fmt.Errorf("upsert not_found: %w", err)
	}
	return res.Inserted, res.RequestCount, nil
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

// ClearWeekly 每周重置「本周」维度：把 category='not_found' 的请求计数与按日 IP 明细清零，
// 记录本身保留。
//
// 原来是直接 DELETE 全表，于是存活行的 first_seen_at 必然落在本周内，
// 看板的「本周新增」永远等于「总数」，两个指标都没意义。保留行后
// first_seen_at 才有跨周含义（UpsertNotFound 只在 INSERT 时写它，冲突不覆盖），
// 排行榜依旧按 last_seen_at + 每周归零的 request_count 只看本周热度，行为不变。
//
// 代价：未解决的记录不再每周消失，表会持续增长（"总数" 语义变为累计去重歌曲数）。
// 需要控制体量时应该另加归档任务，而不是回到「删光重来」。
func (r *NotFoundRepo) ClearWeekly(ctx context.Context) (int64, error) {
	result := r.db.WithContext(ctx).
		Model(&model.NotFoundRequest{}).
		Where("category = ?", model.CategoryNotFound).
		Updates(map[string]any{
			"request_count":  0,
			"daily_requests": gorm.Expr("'{}'::jsonb"),
		})
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

// GetRanking 查询排行榜（服务端真分页）
// days 最大 7（只统计近 7 天仍有请求的记录，对应每周重置的计数窗口），且窗口最多回溯到本周一 00:00；limit 缺省/过大时最多返回 maxRankingLimit 条；
// total 始终是符合条件的全量命中数，items 为 [offset, offset+limit) 区间。
func (r *NotFoundRepo) GetRanking(ctx context.Context, days int, platform string, limit, offset int) (int64, []RankingItem, error) {
	if days > 7 {
		days = 7
	}
	if days < 1 {
		days = 7
	}
	if offset < 0 {
		offset = 0
	}

	now := time.Now()
	startTime := now.AddDate(0, 0, -days)
	// 榜单窗口与每周清零边界对齐：清零前的记录 request_count 已归零，
	// 只按滚动窗口筛选会让它们以「0 次请求」继续展示，因此最多回溯到本周一。
	if weekStart := startOfWeek(now); weekStart.After(startTime) {
		startTime = weekStart
	}

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

	// limit 缺省/过大时不再退化为「返回整表」：设硬上限，且只取展示所需列，
	// 避免把每行 daily_requests 的大 JSON 一并读进内存后再丢弃。
	returnLimit := maxRankingLimit
	if limit > 0 && limit < returnLimit {
		returnLimit = limit
	}

	var items []RankingItem
	err := query.
		Select("id, platform, platform_id, song_name, artists, cover, album, request_count, first_seen_at, last_seen_at, category").
		Order("request_count DESC").
		Limit(returnLimit).
		Offset(offset).
		Find(&items).Error
	if err != nil {
		return 0, nil, fmt.Errorf("query ranking: %w", err)
	}
	return total, items, nil
}

// startOfWeek 返回 t 所在周的周一 00:00（与每周清零任务的边界一致）
func startOfWeek(t time.Time) time.Time {
	day := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
	offset := (int(t.Weekday()) + 6) % 7 // 周一 = 0
	return day.AddDate(0, 0, -offset)
}

// IncompleteRecord 待补齐记录（仅平台与歌曲 ID）
type IncompleteRecord struct {
	Platform   string `gorm:"column:platform"`
	PlatformID string `gorm:"column:platform_id"`
}

// ListIncompleteRecords 按排行榜热度优先取一批歌名或封面为空的记录。
//
// 排序与排行榜一致（request_count DESC），热门歌曲先补；updated_at ASC 作为
// 同热度内的轮转：每轮处理都会刷新 updated_at，失败的记录排到同热度队尾，
// 既保证下一轮（5 分钟后）能再次重试，又不会让同热度的少数失败记录反复占满批次。
// request_count 每周一清零，上周的失败记录会自动落到低优先级，不会长期挡住新记录。
func (r *NotFoundRepo) ListIncompleteRecords(ctx context.Context, limit int) ([]IncompleteRecord, error) {
	if limit <= 0 {
		return nil, nil
	}

	var items []IncompleteRecord
	err := r.db.WithContext(ctx).
		Model(&model.NotFoundRequest{}).
		Select("platform, platform_id").
		Where("category = ?", model.CategoryNotFound).
		Where("platform IN ?", []string{"ncm", "qq"}).
		Where("(COALESCE(song_name, '') = '' OR COALESCE(cover, '') = '')").
		Order("request_count DESC, updated_at ASC, id ASC").
		Limit(limit).
		Find(&items).Error
	if err != nil {
		return nil, fmt.Errorf("list incomplete not_found records: %w", err)
	}
	return items, nil
}

// TouchRecord 仅刷新 updated_at，作为「本轮已尝试」标记，让记录排到队尾
func (r *NotFoundRepo) TouchRecord(ctx context.Context, platform, platformID string) error {
	result := r.db.WithContext(ctx).
		Model(&model.NotFoundRequest{}).
		Where("platform = ? AND platform_id = ?", platform, platformID).
		Update("updated_at", gorm.Expr("NOW()"))
	return result.Error
}

// UpdateParsedMetadata 回写解析得到的分类与歌曲元数据。
// 字段值留空时保留已有值（记录可能只缺歌名或只缺封面），避免把已补全的信息覆盖成空。
func (r *NotFoundRepo) UpdateParsedMetadata(
	ctx context.Context,
	platform, platformID, category, songName, artists, cover, album string,
) error {
	result := r.db.WithContext(ctx).
		Model(&model.NotFoundRequest{}).
		Where("platform = ? AND platform_id = ?", platform, platformID).
		Updates(map[string]any{
			"category":  category,
			"song_name": gorm.Expr("COALESCE(NULLIF(?, ''), song_name)", songName),
			"artists":   gorm.Expr("COALESCE(NULLIF(?, ''), artists)", artists),
			"cover":     gorm.Expr("COALESCE(NULLIF(?, ''), cover)", cover),
			"album":     gorm.Expr("COALESCE(NULLIF(?, ''), album)", album),
		})
	return result.Error
}

// UpdateCategory 更新某条记录的分类（Worker 解析后回写）
func (r *NotFoundRepo) UpdateCategory(ctx context.Context, platform, platformID, category, songName string) error {
	updates := map[string]any{
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

	// 记录不再每周删除，平台分布与 Top10 必须显式限定在本周窗口内，
	// 否则会把几个月前、本周零请求（request_count 已归零）的记录也算进来。
	if err := r.db.WithContext(ctx).Model(&model.NotFoundRequest{}).
		Where("category = ? AND last_seen_at >= ?", model.CategoryNotFound, weekStart).
		Select("platform, COUNT(*) as count").
		Group("platform").
		Order("count DESC").
		Scan(&stats.PlatformDist).Error; err != nil {
		return nil, err
	}

	if err := r.db.WithContext(ctx).Model(&model.NotFoundRequest{}).
		Where("category = ? AND last_seen_at >= ?", model.CategoryNotFound, weekStart).
		Order("request_count DESC").
		Limit(10).
		Find(&stats.Top10).Error; err != nil {
		return nil, err
	}

	return &stats, nil
}
