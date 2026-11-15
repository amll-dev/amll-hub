package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/redis/go-redis/v9"
)

// statsCacheTTL 词库统计缓存时长。6 次全表聚合代价高且实时性要求低，
// 首页刷新不必每次都触发全表扫描。
const statsCacheTTL = 2 * time.Minute

// statsCacheKey 统计结果在 Redis 中的键。多副本共用，避免每个实例各跑一遍聚合。
const statsCacheKey = "stats:public:v1"

// StatsService 词库统计服务
type StatsService struct {
	songRepo   *repository.SongRepo
	artistRepo *repository.ArtistRepo
	syncRepo   *repository.SyncRepo

	// redis 为 nil 时退化为纯进程内缓存（fail-open，不影响统计功能）
	redis *redis.Client

	// 进程内缓存 + 互斥锁实现并发收敛：同一时刻只有一个请求真正跑 6 次聚合或
	// 回源 Redis，其余请求等待并复用结果；TTL 内直接返回缓存。
	mu         sync.Mutex
	cached     *StatsResponse
	cacheUntil time.Time
}

func NewStatsService(
	songRepo *repository.SongRepo,
	artistRepo *repository.ArtistRepo,
	syncRepo *repository.SyncRepo,
	rdb *redis.Client,
) *StatsService {
	return &StatsService{
		songRepo:   songRepo,
		artistRepo: artistRepo,
		syncRepo:   syncRepo,
		redis:      rdb,
	}
}

// StatsResponse 词库统计响应
type StatsResponse struct {
	TotalSongs           int64            `json:"totalSongs"`
	TotalArtists         int64            `json:"totalArtists"`
	TotalAlbums          int64            `json:"totalAlbums"`
	TotalWords           int64            `json:"totalWords"`
	TotalLines           int64            `json:"totalLines"`
	PlatformDistribution map[string]int64 `json:"platformDistribution"`
	LastSyncAt           string           `json:"lastSyncAt"`
}

// GetStats 返回词库统计（Redis 缓存 + 进程内兜底 + 并发收敛）
func (s *StatsService) GetStats(ctx context.Context) (*StatsResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.cached != nil && time.Now().Before(s.cacheUntil) {
		return s.copyCached(), nil
	}

	// 多副本部署时其他实例可能刚算过，先看 Redis。
	if resp := s.loadFromRedis(ctx); resp != nil {
		s.storeLocal(resp)
		return s.copyCached(), nil
	}

	resp, err := s.compute(ctx)
	if err != nil {
		return nil, err
	}
	s.saveToRedis(ctx, resp)
	s.storeLocal(resp)
	return s.copyCached(), nil
}

// copyCached 返回进程内缓存副本，避免调用方改到 map
func (s *StatsService) copyCached() *StatsResponse {
	resp := *s.cached
	if s.cached.PlatformDistribution != nil {
		dist := make(map[string]int64, len(s.cached.PlatformDistribution))
		for k, v := range s.cached.PlatformDistribution {
			dist[k] = v
		}
		resp.PlatformDistribution = dist
	}
	return &resp
}

// storeLocal 写入进程内缓存
func (s *StatsService) storeLocal(resp *StatsResponse) {
	s.cached = resp
	s.cacheUntil = time.Now().Add(statsCacheTTL)
}

// loadFromRedis 读 Redis 缓存；Redis 未配置或出错时返回 nil（fail-open，回落到实时计算）
func (s *StatsService) loadFromRedis(ctx context.Context) *StatsResponse {
	if s.redis == nil {
		return nil
	}
	raw, err := s.redis.Get(ctx, statsCacheKey).Bytes()
	if err != nil || len(raw) == 0 {
		return nil
	}
	var resp StatsResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil
	}
	return &resp
}

// saveToRedis 写 Redis 缓存；失败只影响共享缓存，不影响本次请求
func (s *StatsService) saveToRedis(ctx context.Context, resp *StatsResponse) {
	if s.redis == nil {
		return
	}
	data, err := json.Marshal(resp)
	if err != nil {
		return
	}
	_ = s.redis.Set(ctx, statsCacheKey, data, statsCacheTTL).Err()
}

// compute 执行 6 次全表聚合并取最近同步时间。
// 这里的失败全部来自数据库：不能包装成 ErrUpstreamUnavailable（handler 会返回 502
// 把告警指向错误的方向），也不要用 %v 切断错误链，交给 handler 归为 500 即可。
func (s *StatsService) compute(ctx context.Context) (*StatsResponse, error) {
	totalSongs, err := s.songRepo.CountSongs(ctx)
	if err != nil {
		return nil, fmt.Errorf("count songs: %w", err)
	}
	totalArtists, err := s.artistRepo.CountArtists(ctx)
	if err != nil {
		return nil, fmt.Errorf("count artists: %w", err)
	}
	totalAlbums, err := s.songRepo.CountAlbums(ctx)
	if err != nil {
		return nil, fmt.Errorf("count albums: %w", err)
	}
	totalWords, err := s.songRepo.SumWords(ctx)
	if err != nil {
		return nil, fmt.Errorf("sum words: %w", err)
	}
	totalLines, err := s.songRepo.SumLines(ctx)
	if err != nil {
		return nil, fmt.Errorf("sum lines: %w", err)
	}
	platformDist, err := s.songRepo.PlatformDistribution(ctx)
	if err != nil {
		return nil, fmt.Errorf("platform distribution: %w", err)
	}
	lastSyncAt, _ := s.syncRepo.GetLastSyncedAt(ctx)

	return &StatsResponse{
		TotalSongs:           totalSongs,
		TotalArtists:         totalArtists,
		TotalAlbums:          totalAlbums,
		TotalWords:           totalWords,
		TotalLines:           totalLines,
		PlatformDistribution: platformDist,
		LastSyncAt:           lastSyncAt,
	}, nil
}
