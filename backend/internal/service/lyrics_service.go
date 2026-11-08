package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sort"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/config"
	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/minio/minio-go/v7"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

// LyricsService 歌词获取服务
type LyricsService struct {
	cfg      *config.Config
	songRepo *repository.SongRepo
	minio    *minio.Client
	redis    *redis.Client
}

func NewLyricsService(
	cfg *config.Config,
	songRepo *repository.SongRepo,
	minioClient *minio.Client,
	redisClient *redis.Client,
) *LyricsService {
	return &LyricsService{
		cfg:      cfg,
		songRepo: songRepo,
		minio:    minioClient,
		redis:    redisClient,
	}
}

// LyricResult 歌词获取结果
type LyricResult struct {
	// MinioPath 用于从 MinIO 取对象
	MinioPath string
	// Size 文件总大小（字节）
	Size int64
	// ETag 对象 ETag
	ETag string
}

// ResolveLyric 解析 folder+filename -> MinioPath
// 优先从 Redis 缓存读取，未命中则查 PG
func (s *LyricsService) ResolveLyric(ctx context.Context, folder, filename string) (*LyricResult, error) {
	// 1. Redis 缓存
	cacheKey := lyricCacheKey(folder, filename)
	if s.redis != nil {
		if cached, err := s.redis.Get(ctx, cacheKey).Result(); err == nil && cached != "" {
			// 同时获取对象 stat 信息
			objInfo, err := s.minio.StatObject(ctx, s.cfg.MinIO.Bucket, cached, minio.StatObjectOptions{})
			if err == nil {
				return &LyricResult{
					MinioPath: cached,
					Size:      objInfo.Size,
					ETag:      objInfo.ETag,
				}, nil
			}
			// 对象可能已被删除，清缓存继续查 PG
			_ = s.redis.Del(ctx, cacheKey).Err()
		}
	}

	// 2. 查 PG
	song, err := s.songRepo.GetByPlatform(ctx, folder, filename)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLyricNotFound
		}
		return nil, fmt.Errorf("query song: %w", err)
	}

	// 3. Stat 对象
	objInfo, err := s.minio.StatObject(ctx, s.cfg.MinIO.Bucket, song.MinioPath, minio.StatObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("stat minio object: %w", err)
	}

	// 4. 回写缓存（TTL 1 小时）
	if s.redis != nil {
		_ = s.redis.Set(ctx, cacheKey, song.MinioPath, time.Hour).Err()
	}

	return &LyricResult{
		MinioPath: song.MinioPath,
		Size:      objInfo.Size,
		ETag:      objInfo.ETag,
	}, nil
}

// StreamLyric 流式返回 TTML 内容
// onWrite 在拿到 reader 时调用，由调用方决定如何写出
func (s *LyricsService) StreamLyric(
	ctx context.Context,
	minioPath string,
	onWrite func(reader io.Reader) error,
) error {
	obj, err := s.minio.GetObject(ctx, s.cfg.MinIO.Bucket, minioPath, minio.GetObjectOptions{})
	if err != nil {
		return fmt.Errorf("get object: %w", err)
	}
	defer func() {
		_ = obj.Close()
	}()

	if err := onWrite(obj); err != nil {
		return err
	}
	return nil
}

// lyricCacheKey Redis 缓存键
func lyricCacheKey(folder, filename string) string {
	return "lyric:" + folder + ":" + filename
}

// maxVersionHops 版本关联的最大传递层数，防止异常数据造成无限扩散
const maxVersionHops = 10

// LyricVersionItem 歌词历史版本项
type LyricVersionItem struct {
	ID                    int64               `json:"id"`
	RawLyricFile          string              `json:"rawLyricFile"`
	MusicNames            []string            `json:"musicNames"`
	Artists               []string            `json:"artists"`
	Albums                []string            `json:"albums"`
	PlatformIds           map[string][]string `json:"platformIds"`
	WordCount             int                 `json:"wordCount"`
	LineCount             int                 `json:"lineCount"`
	CommitTimestamp       *int64              `json:"commitTimestamp,omitempty"`
	CommitTime            *time.Time          `json:"commitTime,omitempty"`
	TtmlAuthorGithub      string              `json:"ttmlAuthorGithub,omitempty"`
	TtmlAuthorGithubLogin string              `json:"ttmlAuthorGithubLogin,omitempty"`
	CreatedAt             time.Time           `json:"createdAt"`
	IsLatest              bool                `json:"isLatest"`
}

// LyricVersionsResult 某首歌词的全部历史版本
type LyricVersionsResult struct {
	RawLyricFile string             `json:"rawLyricFile"`
	MusicNames   []string           `json:"musicNames"`
	Artists      []string           `json:"artists"`
	Versions     []LyricVersionItem `json:"versions"`
}

// ListVersions 查询与指定歌词共享任意「平台+平台ID」的全部历史版本
// 按提交时间倒序返回，最新版本标记 IsLatest。
func (s *LyricsService) ListVersions(ctx context.Context, rawFile string) (*LyricVersionsResult, error) {
	root, err := s.songRepo.GetByRawLyricFile(ctx, rawFile)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLyricNotFound
		}
		return nil, fmt.Errorf("query song: %w", err)
	}

	// BFS：从目标歌曲的平台 ID 出发，逐层找出共享任意 (platform, platform_id) 的歌曲
	visited := map[int64]struct{}{root.ID: {}}
	queue := []int64{root.ID}
	seenPairs := make(map[repository.PlatformPair]struct{})
	for hop := 0; hop < maxVersionHops && len(queue) > 0; hop++ {
		mappingsBySong, err := s.songRepo.GetPlatformMappingsBySongIDs(ctx, queue)
		if err != nil {
			return nil, err
		}

		newPairs := make([]repository.PlatformPair, 0)
		for _, id := range queue {
			for _, pm := range mappingsBySong[id] {
				if pm.PlatformID == "" {
					continue
				}
				pair := repository.PlatformPair{Platform: pm.Platform, PlatformID: pm.PlatformID}
				if _, ok := seenPairs[pair]; ok {
					continue
				}
				seenPairs[pair] = struct{}{}
				newPairs = append(newPairs, pair)
			}
		}
		if len(newPairs) == 0 {
			break
		}

		linked, err := s.songRepo.FindSongIDsByPlatformPairs(ctx, newPairs)
		if err != nil {
			return nil, err
		}
		queue = queue[:0]
		for _, id := range linked {
			if _, ok := visited[id]; ok {
				continue
			}
			visited[id] = struct{}{}
			queue = append(queue, id)
		}
	}

	ids := make([]int64, 0, len(visited))
	for id := range visited {
		ids = append(ids, id)
	}
	songs, err := s.songRepo.GetSongsByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	songIDs := make([]int64, 0, len(songs))
	for _, song := range songs {
		songIDs = append(songIDs, song.ID)
	}
	mappings, err := s.songRepo.GetPlatformMappingsBySongIDs(ctx, songIDs)
	if err != nil {
		return nil, err
	}
	artists, err := s.songRepo.GetArtistsBySongIDs(ctx, songIDs)
	if err != nil {
		return nil, err
	}

	versions := make([]LyricVersionItem, 0, len(songs))
	for _, song := range songs {
		platformIDs := make(map[string][]string)
		for _, pm := range mappings[song.ID] {
			platformIDs[pm.Platform] = append(platformIDs[pm.Platform], pm.PlatformID)
		}
		versions = append(versions, LyricVersionItem{
			ID:                    song.ID,
			RawLyricFile:          song.RawLyricFile,
			MusicNames:            jsonStringArray(song.MusicName),
			Artists:               artistNames(artists[song.ID]),
			Albums:                jsonStringArray(song.Album),
			PlatformIds:           platformIDs,
			WordCount:             song.WordCount,
			LineCount:             song.LineCount,
			CommitTimestamp:       song.CommitTimestamp,
			CommitTime:            song.CommitTime,
			TtmlAuthorGithub:      song.TtmlAuthorGithub,
			TtmlAuthorGithubLogin: song.TtmlAuthorGithubLogin,
			CreatedAt:             song.CreatedAt,
		})
	}

	// 最新版本排最前：commit_timestamp 降序（null 视为最旧），再按 ID 降序保证稳定
	sort.SliceStable(versions, func(i, j int) bool {
		ci, cj := int64(-1), int64(-1)
		if versions[i].CommitTimestamp != nil {
			ci = *versions[i].CommitTimestamp
		}
		if versions[j].CommitTimestamp != nil {
			cj = *versions[j].CommitTimestamp
		}
		if ci != cj {
			return ci > cj
		}
		return versions[i].ID > versions[j].ID
	})
	if len(versions) > 0 {
		versions[0].IsLatest = true
	}

	return &LyricVersionsResult{
		RawLyricFile: root.RawLyricFile,
		MusicNames:   jsonStringArray(root.MusicName),
		Artists:      artistNames(artists[root.ID]),
		Versions:     versions,
	}, nil
}

// jsonStringArray 把 JSONB 字符串数组转为普通切片（nil 转为空数组，避免前端拿到 null）
func jsonStringArray(v model.JSONStringArray) []string {
	if v == nil {
		return []string{}
	}
	return []string(v)
}

// artistNames 把艺术家模型转换为名称列表
func artistNames(list []model.Artist) []string {
	names := make([]string, 0, len(list))
	for _, a := range list {
		names = append(names, a.Name)
	}
	return names
}
