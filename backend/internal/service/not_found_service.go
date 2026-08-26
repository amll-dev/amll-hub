package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/infrastructure"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/redis/go-redis/v9"
	logrus "github.com/sirupsen/logrus"
)

// RankingItem 排行榜项
type RankingItem struct {
	ID           int64     `json:"id"`
	Platform     string    `json:"platform"`
	PlatformID   string    `json:"platformId"`
	SongName     string    `json:"songName"`
	Artists      []string  `json:"artists"`
	Cover        string    `json:"cover"`
	Album        string    `json:"album"`
	RequestCount int       `json:"requestCount"`
	FirstSeenAt  time.Time `json:"firstSeenAt"`
	LastSeenAt   time.Time `json:"lastSeenAt"`
	Category     string    `json:"category"`
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

// PureMusicWhitelistItem 纯音乐白名单
type PureMusicWhitelistItem struct {
	ID         int64     `json:"id"`
	Platform   string    `json:"platform"`
	PlatformID string    `json:"platformId"`
	SongName   string    `json:"songName"`
	Reason     string    `json:"reason"`
	DetectedAt time.Time `json:"detectedAt"`
	DetectedBy string    `json:"detectedBy"`
	CreatedAt  time.Time `json:"createdAt"`
}

// CloudMusicWhitelistItem 云盘音乐白名单
type CloudMusicWhitelistItem struct {
	ID         int64     `json:"id"`
	Platform   string    `json:"platform"`
	PlatformID string    `json:"platformId"`
	SongName   string    `json:"songName"`
	Reason     string    `json:"reason"`
	DetectedAt time.Time `json:"detectedAt"`
	DetectedBy string    `json:"detectedBy"`
	CreatedAt  time.Time `json:"createdAt"`
}

// NotFoundService 无歌词记录服务
type NotFoundService struct {
	repo  *repository.NotFoundRepo
	redis *redis.Client
	mq    *infrastructure.RabbitMQ

	// 进程内并发去重锁：Redis 不可用时的单进程兜底
	inFlight sync.Map
}

// notFoundInFlightTTL 分布式处理锁 TTL，略大于 worker 单次处理上限
const notFoundInFlightTTL = 5 * time.Minute

// NewNotFoundService 创建服务
func NewNotFoundService(
	repo *repository.NotFoundRepo,
	redisClient *redis.Client,
	mq *infrastructure.RabbitMQ,
) *NotFoundService {
	return &NotFoundService{
		repo:  repo,
		redis: redisClient,
		mq:    mq,
	}
}

// PreloadWhitelist 启动时加载白名单到 Redis Set
func (s *NotFoundService) PreloadWhitelist(ctx context.Context) error {
	if s.redis == nil {
		return nil
	}
	pureKeys, cloudKeys, err := s.repo.ListWhitelistForPreload(ctx)
	if err != nil {
		return fmt.Errorf("load whitelist: %w", err)
	}

	// 清空旧集合
	s.redis.Del(ctx, "not_found:pure_music:set")
	s.redis.Del(ctx, "not_found:cloud_music:set")

	// 批量写入
	if len(pureKeys) > 0 {
		members := make([]any, len(pureKeys))
		for i, k := range pureKeys {
			members[i] = k
		}
		if err := s.redis.SAdd(ctx, "not_found:pure_music:set", members...).Err(); err != nil {
			return fmt.Errorf("sadd pure_music: %w", err)
		}
	}
	if len(cloudKeys) > 0 {
		members := make([]any, len(cloudKeys))
		for i, k := range cloudKeys {
			members[i] = k
		}
		if err := s.redis.SAdd(ctx, "not_found:cloud_music:set", members...).Err(); err != nil {
			return fmt.Errorf("sadd cloud_music: %w", err)
		}
	}

	logrus.Infof("[not_found] preload whitelist: pure=%d, cloud=%d", len(pureKeys), len(cloudKeys))
	return nil
}

// IsInWhitelist 检查是否在白名单（Redis 优先，PG 兜底）
func (s *NotFoundService) IsInWhitelist(ctx context.Context, platform, platformID string) (bool, error) {
	member := platform + ":" + platformID

	if s.redis != nil {
		// 同时检查两个白名单
		pureOK, err := s.redis.SIsMember(ctx, "not_found:pure_music:set", member).Result()
		if err == nil && pureOK {
			return true, nil
		}
		cloudOK, err := s.redis.SIsMember(ctx, "not_found:cloud_music:set", member).Result()
		if err == nil && cloudOK {
			return true, nil
		}
	}

	// Redis 未命中或异常，查 PG
	return s.repo.IsInWhitelist(ctx, platform, platformID)
}

// HandleNotFoundRequest 处理一次无歌词请求
func (s *NotFoundService) HandleNotFoundRequest(ctx context.Context, platform, platformID, clientIP string) {
	key := platform + ":" + platformID

	// 1. 白名单命中：直接丢弃
	if inWL, _ := s.IsInWhitelist(ctx, platform, platformID); inWL {
		return
	}

	// 进程内/分布式并发去重锁
	if !s.acquireInFlight(ctx, key) {
		return
	}
	defer s.releaseInFlight(key)

	// 3. Redis 按日去重（platform:platformId:today:ip）
	today := time.Now().Format("2006-01-02")
	dedupKey := fmt.Sprintf("not_found:dedup:%s:%s:%s:%s", platform, platformID, today, clientIP)

	if s.redis != nil {
		set, err := s.redis.SetNX(ctx, dedupKey, "1", 25*time.Hour).Result()
		if err == nil && !set {
			// 今日同 IP 已记录过则不加
			_, _, _ = s.repo.UpsertNotFound(ctx, platform, platformID, clientIP)
			return
		}
	}

	// 4. 写入/更新 PG
	isNew, _, err := s.repo.UpsertNotFound(ctx, platform, platformID, clientIP)
	if err != nil {
		logrus.WithError(err).Error("[not_found] upsert failed")
		return
	}

	// 5. 新记录发送 MQ 消息
	if isNew && s.mq != nil {
		if err := s.mq.PublishNotFoundParse(infrastructure.NotFoundParseMessage{
			Platform:   platform,
			PlatformID: platformID,
			ClientIP:   clientIP,
		}); err != nil {
			logrus.WithError(err).Error("[not_found] publish mq failed")
		}
	}
}

// CheckAndDeleteOnLyricResolved 歌词补全时调用：从排行榜中删除记录
func (s *NotFoundService) CheckAndDeleteOnLyricResolved(ctx context.Context, platform, platformID string) {
	rowsAffected, err := s.repo.DeleteByPlatform(ctx, platform, platformID)
	if err != nil {
		logrus.WithError(err).Error("[not_found] delete on resolved failed")
		return
	}
	if rowsAffected == 0 {
		return
	}

	// 清理 Redis 相关缓存
	if s.redis != nil {
		pattern := fmt.Sprintf("not_found:dedup:%s:%s:*", platform, platformID)
		var keys []string
		var cursor uint64
		for i := 0; i < 200; i++ {
			var batch []string
			batch, cursor = s.redis.Scan(ctx, cursor, pattern, 100).Val()
			keys = append(keys, batch...)
			if cursor == 0 {
				break
			}
		}
		if len(keys) > 0 {
			s.redis.Del(ctx, keys...)
		}
		// 清理排行榜缓存
		s.clearRankingCache(ctx)
	}

	logrus.Infof("[not_found] lyric resolved, deleted %d record(s): platform=%s id=%s",
		rowsAffected, platform, platformID)
}

// GetRanking 查询排行榜（带 Redis 缓存）
func (s *NotFoundService) GetRanking(ctx context.Context, days int, platform string, limit int) (int64, []RankingItem, error) {
	if days > 7 {
		days = 7
	}
	if days < 1 {
		days = 7
	}

	// 尝试缓存（仅当指定 limit 时缓存，避免不同参数缓存击穿）
	limitStr := "all"
	if limit > 0 {
		limitStr = strconv.Itoa(limit)
	}
	cacheKey := fmt.Sprintf("not_found:ranking:cache:%d:%s:%s", days, platform, limitStr)

	if s.redis != nil {
		if cached, err := s.redis.Get(ctx, cacheKey).Result(); err == nil && cached != "" {
			if data, err := decodeRankingCache(cached); err == nil {
				return data.Total, data.Items, nil
			}
		}
	}

	total, repoItems, err := s.repo.GetRanking(ctx, days, platform, limit)
	if err != nil {
		return 0, nil, err
	}
	items := convertRankingItems(repoItems)

	// 缓存 60s
	if s.redis != nil {
		if encoded, err := encodeRankingCache(total, items); err == nil {
			_ = s.redis.Set(ctx, cacheKey, encoded, 60*time.Second).Err()
			s.trackRankingCacheKey(ctx, cacheKey)
		}
	}

	return total, items, nil
}

// GetStats 统计数据
func (s *NotFoundService) GetStats(ctx context.Context) (*StatsResult, error) {
	rs, err := s.repo.GetStats(ctx)
	if err != nil {
		return nil, err
	}
	return convertStats(rs), nil
}

// ListPureMusicWhitelist 查询纯音乐白名单
func (s *NotFoundService) ListPureMusicWhitelist(ctx context.Context, limit, offset int) ([]PureMusicWhitelistItem, int64, error) {
	items, total, err := s.repo.ListPureMusicWhitelist(ctx, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	out := make([]PureMusicWhitelistItem, len(items))
	for i, m := range items {
		out[i] = PureMusicWhitelistItem{
			ID:         m.ID,
			Platform:   m.Platform,
			PlatformID: m.PlatformID,
			SongName:   m.SongName,
			Reason:     m.Reason,
			DetectedAt: m.DetectedAt,
			DetectedBy: m.DetectedBy,
			CreatedAt:  m.CreatedAt,
		}
	}
	return out, total, nil
}

// ListCloudMusicWhitelist 查询云盘音乐白名单
func (s *NotFoundService) ListCloudMusicWhitelist(ctx context.Context, limit, offset int) ([]CloudMusicWhitelistItem, int64, error) {
	items, total, err := s.repo.ListCloudMusicWhitelist(ctx, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	out := make([]CloudMusicWhitelistItem, len(items))
	for i, m := range items {
		out[i] = CloudMusicWhitelistItem{
			ID:         m.ID,
			Platform:   m.Platform,
			PlatformID: m.PlatformID,
			SongName:   m.SongName,
			Reason:     m.Reason,
			DetectedAt: m.DetectedAt,
			DetectedBy: m.DetectedBy,
			CreatedAt:  m.CreatedAt,
		}
	}
	return out, total, nil
}

// ClearWeekly 每周清空所有无歌词记录（保留白名单）
func (s *NotFoundService) ClearWeekly(ctx context.Context) (int64, error) {
	rows, err := s.repo.ClearWeekly(ctx)
	if err != nil {
		return 0, err
	}
	// 清理排行榜缓存
	s.clearRankingCache(ctx)
	logrus.Infof("[not_found] weekly clear: deleted %d records", rows)
	return rows, nil
}

// StartWeeklyClearTask 启动每周清空定时任务
func (s *NotFoundService) StartWeeklyClearTask(ctx context.Context) {
	nextMonday := nextMonday()
	duration := time.Until(nextMonday)

	time.AfterFunc(duration, func() {
		taskCtx, taskCancel := context.WithCancel(ctx)
		defer taskCancel()

		runCtx, runCancel := context.WithTimeout(taskCtx, 5*time.Minute)
		if _, err := s.ClearWeekly(runCtx); err != nil {
			logrus.WithError(err).Error("[not_found] weekly clear failed")
		}
		runCancel()

		ticker := time.NewTicker(7 * 24 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				runCtx, runCancel := context.WithTimeout(taskCtx, 5*time.Minute)
				if _, err := s.ClearWeekly(runCtx); err != nil {
					logrus.WithError(err).Error("[not_found] weekly clear failed")
				}
				runCancel()
			case <-taskCtx.Done():
				return
			}
		}
	})
	logrus.Infof("[not_found] weekly clear task scheduled, next run at %s", nextMonday.Format(time.RFC3339))
}

// nextMonday 计算下周一 00:00:00（本地时间）
func nextMonday() time.Time {
	now := time.Now()
	daysUntilMonday := (8 - int(now.Weekday())) % 7
	if daysUntilMonday == 0 {
		daysUntilMonday = 7
	}
	return time.Date(now.Year(), now.Month(), now.Day()+daysUntilMonday,
		0, 0, 0, 0, now.Location())
}

// 获取处理锁
func (s *NotFoundService) acquireInFlight(ctx context.Context, key string) bool {
	if s.redis != nil {
		lockKey := "not_found:inflight:" + key
		ok, err := s.redis.SetNX(ctx, lockKey, "1", notFoundInFlightTTL).Result()
		if err == nil {
			return ok
		}
		// Redis出错回退进程内锁
		logrus.WithError(err).Warn("[not_found] redis SetNX inflight failed, fallback to local")
	}
	if _, exists := s.inFlight.Load(key); exists {
		return false
	}
	s.inFlight.Store(key, true)
	return true
}

// 释放处理锁
func (s *NotFoundService) releaseInFlight(key string) {
	if s.redis != nil {
		_ = s.redis.Del(context.Background(), "not_found:inflight:"+key).Err()
	}
	s.inFlight.Delete(key)
}

// rankingCacheData 排行榜缓存结构（包含 total 与 items）
type rankingCacheData struct {
	Total int64         `json:"total"`
	Items []RankingItem `json:"items"`
}

// 排行榜缓存 key 索引集合
const rankingCacheIndexKey = "not_found:ranking:index"

// 通过索引集合批量删除排行榜缓存，避免全库 SCAN
func (s *NotFoundService) clearRankingCache(ctx context.Context) {
	if s.redis == nil {
		return
	}
	keys, err := s.redis.SMembers(ctx, rankingCacheIndexKey).Result()
	if err != nil || len(keys) == 0 {
		_ = s.redis.Del(ctx, rankingCacheIndexKey).Err()
		return
	}
	delKeys := append(keys, rankingCacheIndexKey)
	s.redis.Del(ctx, delKeys...)
}

// 记录缓存 key 到索引集合，便于批量清理
func (s *NotFoundService) trackRankingCacheKey(ctx context.Context, key string) {
	if s.redis == nil {
		return
	}
	// 索引集合设 TTL 与缓存最长有效期对齐，避免无限增长
	pipe := s.redis.Pipeline()
	pipe.SAdd(ctx, rankingCacheIndexKey, key)
	pipe.Expire(ctx, rankingCacheIndexKey, 120*time.Second)
	_, _ = pipe.Exec(ctx)
}

// encodeRankingCache / decodeRankingCache 使用 JSON 编码
func encodeRankingCache(total int64, items []RankingItem) (string, error) {
	data := rankingCacheData{Total: total, Items: items}
	b, err := json.Marshal(data)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func decodeRankingCache(s string) (*rankingCacheData, error) {
	var data rankingCacheData
	if err := json.Unmarshal([]byte(s), &data); err != nil {
		return nil, err
	}
	return &data, nil
}

// convertRankingItems 将 repository 层结果转为 service DTO
func convertRankingItems(items []repository.RankingItem) []RankingItem {
	if len(items) == 0 {
		return []RankingItem{}
	}
	out := make([]RankingItem, len(items))
	for i, it := range items {
		var artists []string
		if it.Artists != "" {
			artists = strings.Split(it.Artists, " / ")
		} else {
			artists = []string{}
		}
		out[i] = RankingItem{
			ID:           it.ID,
			Platform:     it.Platform,
			PlatformID:   it.PlatformID,
			SongName:     it.SongName,
			Artists:      artists,
			Cover:        it.Cover,
			Album:        it.Album,
			RequestCount: it.RequestCount,
			FirstSeenAt:  it.FirstSeenAt,
			LastSeenAt:   it.LastSeenAt,
			Category:     it.Category,
		}
	}
	return out
}

// convertStats 将 repository 层统计结果转为 service DTO
func convertStats(rs *repository.StatsResult) *StatsResult {
	if rs == nil {
		return nil
	}
	out := &StatsResult{
		TotalNotFound:   rs.TotalNotFound,
		TotalPureMusic:  rs.TotalPureMusic,
		TotalCloudMusic: rs.TotalCloudMusic,
		NewThisWeek:     rs.NewThisWeek,
		PlatformDist:    make([]PlatformCount, len(rs.PlatformDist)),
		Top10:           convertRankingItems(rs.Top10),
	}
	for i, p := range rs.PlatformDist {
		out.PlatformDist[i] = PlatformCount{Platform: p.Platform, Count: p.Count}
	}
	return out
}
