package service

import (
	"context"
	"fmt"
	"strconv"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
)

// BatchService 批量查询服务
type BatchService struct {
	songRepo *repository.SongRepo
}

func NewBatchService(songRepo *repository.SongRepo) *BatchService {
	return &BatchService{songRepo: songRepo}
}

// BatchItem 批量查询返回项（service 层 DTO）
type BatchItem struct {
	ID           string            `json:"id"`
	MusicNames   []string          `json:"musicNames"`
	Artists      []string          `json:"artists"`
	Albums       []string          `json:"albums"`
	PlatformIDs  map[string]string `json:"platformIds"`
	RawLyricFile string            `json:"rawLyricFile"`
	MinioPath    string            `json:"minioPath"`
}

// BatchGetByPlatform 按 platform + ids 批量查询歌曲
// 结果顺序与请求 ids 一致，未命中的跳过
func (s *BatchService) BatchGetByPlatform(ctx context.Context, platform string, ids []string) ([]BatchItem, error) {
	songMap, err := s.songRepo.BatchGetByPlatform(ctx, platform, ids)
	if err != nil {
		return nil, fmt.Errorf("batch get songs: %w", err)
	}

	// 收集命中的 songID，批量查询关联数据避免 N+1
	songIDs := make([]int64, 0, len(songMap))
	for _, song := range songMap {
		songIDs = append(songIDs, song.ID)
	}
	artistsMap, err := s.songRepo.GetArtistsBySongIDs(ctx, songIDs)
	if err != nil {
		return nil, fmt.Errorf("batch get artists: %w", err)
	}
	pmsMap, err := s.songRepo.GetPlatformMappingsBySongIDs(ctx, songIDs)
	if err != nil {
		return nil, fmt.Errorf("batch get platform mappings: %w", err)
	}

	items := make([]BatchItem, 0, len(songMap))
	for _, id := range ids {
		song, ok := songMap[id]
		if !ok {
			continue
		}
		artists := artistsMap[song.ID]
		artistNames := make([]string, 0, len(artists))
		for _, a := range artists {
			artistNames = append(artistNames, a.Name)
		}
		pms := pmsMap[song.ID]
		platformIDs := map[string]string{}
		for _, pm := range pms {
			platformIDs[pm.Platform] = pm.PlatformID
		}

		items = append(items, BatchItem{
			ID:           batchSongID(song.ID),
			MusicNames:   ensureStringSlice(song.MusicName),
			Artists:      artistNames,
			Albums:       ensureStringSlice(song.Album),
			PlatformIDs:  platformIDs,
			RawLyricFile: song.RawLyricFile,
			MinioPath:    song.MinioPath,
		})
	}
	return items, nil
}

// batchSongID 生成前端可识别的 song id
func batchSongID(id int64) string {
	return "song_" + strconv.FormatInt(id, 10)
}

// ensureStringSlice 将 model.JSONStringArray 转 []string，nil 时返回空切片
// 避免 JSON 序列化时 nil 切片输出 null
func ensureStringSlice(arr model.JSONStringArray) []string {
	if arr == nil {
		return []string{}
	}
	return []string(arr)
}
