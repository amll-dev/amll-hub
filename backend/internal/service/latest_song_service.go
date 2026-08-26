package service

import (
	"context"

	"github.com/amll-dev/amll-hub/backend/internal/repository"
)

// LatestSongService 最新收录歌曲查询服务
type LatestSongService struct {
	latestRepo *repository.LatestSongRepo
}

// NewLatestSongService 创建服务
func NewLatestSongService(latestRepo *repository.LatestSongRepo) *LatestSongService {
	return &LatestSongService{
		latestRepo: latestRepo,
	}
}

// LatestSongItem 列表返回项
type LatestSongItem struct {
	ID       int64  `json:"id"`
	SongID   int64  `json:"songId"`
	NcmID    string `json:"ncmId"`
	Title    string `json:"title"`
	Artist   string `json:"artist"`
	CoverURL string `json:"coverUrl"`
}

// List 查询最新收录列表
func (s *LatestSongService) List(ctx context.Context) ([]LatestSongItem, error) {
	list, err := s.latestRepo.ListAll(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]LatestSongItem, 0, len(list))
	for _, l := range list {
		items = append(items, LatestSongItem{
			ID:       l.ID,
			SongID:   l.SongID,
			NcmID:    l.NcmID,
			Title:    l.Title,
			Artist:   l.Artist,
			CoverURL: l.CoverURL,
		})
	}
	return items, nil
}
