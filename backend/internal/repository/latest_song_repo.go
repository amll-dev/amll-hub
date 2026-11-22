package repository

import (
	"context"

	"gorm.io/gorm"
)

// LatestSongRepo 最新收录歌曲数据访问
type LatestSongRepo struct {
	db *gorm.DB
}

func NewLatestSongRepo(db *gorm.DB) *LatestSongRepo {
	return &LatestSongRepo{db: db}
}

// LatestSongRow 最新收录列表行，附带歌曲库里的歌词文件名
type LatestSongRow struct {
	ID           int64  `json:"id"`
	SongID       int64  `json:"songId"`
	NcmID        string `json:"ncmId"`
	Title        string `json:"title"`
	Artist       string `json:"artist"`
	CoverURL     string `json:"coverUrl"`
	RawLyricFile string `json:"rawLyricFile"`
}

// ListAll 查询全部最新收录，并关联 songs 表取 raw_lyric_file
func (r *LatestSongRepo) ListAll(ctx context.Context) ([]LatestSongRow, error) {
	var list []LatestSongRow
	err := r.db.WithContext(ctx).
		Table("latest_songs").
		Select(`latest_songs.id, latest_songs.song_id, latest_songs.ncm_id,
			latest_songs.title, latest_songs.artist, latest_songs.cover_url,
			COALESCE(songs.raw_lyric_file, '') AS raw_lyric_file`).
		Joins("LEFT JOIN songs ON songs.id = latest_songs.song_id").
		Order("latest_songs.sort_order ASC").
		Scan(&list).Error
	return list, err
}
