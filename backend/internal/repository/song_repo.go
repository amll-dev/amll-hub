package repository

import (
	"context"
	"errors"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"gorm.io/gorm"
)

// SongRepo 歌曲数据访问层
type SongRepo struct {
	db *gorm.DB
}

func NewSongRepo(db *gorm.DB) *SongRepo {
	return &SongRepo{db: db}
}

// GetByPlatform 通过 folder+filename 查找歌曲
// folder 可能是 raw-lyrics / ncm-lyrics / qq-lyrics / spotify-lyrics / am-lyrics
// - raw-lyrics：直接以 raw_lyric_file 匹配 filename
// - 平台：通过 platform_mappings 查询
func (r *SongRepo) GetByPlatform(ctx context.Context, folder, filename string) (*model.Song, error) {
	switch folder {
	case "raw-lyrics":
		var song model.Song
		if err := r.db.WithContext(ctx).
			Where("raw_lyric_file = ?", filename).
			First(&song).Error; err != nil {
			return nil, err
		}
		return &song, nil
	case "ncm-lyrics", "qq-lyrics", "spotify-lyrics", "am-lyrics":
		platform := pkg.FolderToPlatform(folder)
		var song model.Song
		err := r.db.WithContext(ctx).
			Joins("JOIN platform_mappings ON platform_mappings.song_id = songs.id").
			Where("platform_mappings.platform = ? AND platform_mappings.platform_id = ?", platform, filename).
			// 新旧判定唯一标准：commit_timestamp 降序（从文件名解析的提交时间戳）
			// NULLS LAST 兼容历史数据；无时间戳的旧记录排最后
			Order("songs.commit_timestamp DESC NULLS LAST").
			First(&song).Error
		if err != nil {
			return nil, err
		}
		return &song, nil
	}
	return nil, gorm.ErrRecordNotFound
}

// GetByRawLyricFile 通过 raw_lyric_file 查找歌曲
func (r *SongRepo) GetByRawLyricFile(ctx context.Context, rawFile string) (*model.Song, error) {
	var song model.Song
	if err := r.db.WithContext(ctx).Where("raw_lyric_file = ?", rawFile).First(&song).Error; err != nil {
		return nil, err
	}
	return &song, nil
}

// BatchGetByPlatform 批量查询：返回 platform_id -> Song
func (r *SongRepo) BatchGetByPlatform(ctx context.Context, platform string, ids []string) (map[string]*model.Song, error) {
	if len(ids) == 0 {
		return map[string]*model.Song{}, nil
	}
	type row struct {
		PlatformID string
		model.Song
	}
	var rows []row
	err := r.db.WithContext(ctx).
		Table("songs").
		Select("platform_mappings.platform_id AS platform_id, songs.*").
		Joins("JOIN platform_mappings ON platform_mappings.song_id = songs.id").
		Where("platform_mappings.platform = ? AND platform_mappings.platform_id IN ?", platform, ids).
		// 新旧判定唯一标准：commit_timestamp 降序
		Order("songs.commit_timestamp DESC NULLS LAST").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	// 每个 platform_id 仅保留最新一条（已按时间倒序排列，第一条即为最新版本）
	result := make(map[string]*model.Song, len(rows))
	for i := range rows {
		if _, exists := result[rows[i].PlatformID]; !exists {
			s := rows[i].Song
			result[rows[i].PlatformID] = &s
		}
	}
	return result, nil
}

// GetArtistsBySongID 查询歌曲的艺术家列表
func (r *SongRepo) GetArtistsBySongID(ctx context.Context, songID int64) ([]model.Artist, error) {
	var artists []model.Artist
	err := r.db.WithContext(ctx).
		Joins("JOIN song_artists ON song_artists.artist_id = artists.id").
		Where("song_artists.song_id = ?", songID).
		Find(&artists).Error
	return artists, err
}

// GetPlatformMappingsBySongID 查询歌曲的平台映射
func (r *SongRepo) GetPlatformMappingsBySongID(ctx context.Context, songID int64) ([]model.PlatformMapping, error) {
	var pms []model.PlatformMapping
	err := r.db.WithContext(ctx).Where("song_id = ?", songID).Find(&pms).Error
	return pms, err
}

// GetArtistsBySongIDs 批量查询多首歌曲的艺术家列表，返回 songID -> artists 映射
func (r *SongRepo) GetArtistsBySongIDs(ctx context.Context, songIDs []int64) (map[int64][]model.Artist, error) {
	if len(songIDs) == 0 {
		return map[int64][]model.Artist{}, nil
	}
	type row struct {
		SongID int64
		model.Artist
	}
	var rows []row
	err := r.db.WithContext(ctx).
		Table("artists").
		Select("song_artists.song_id AS song_id, artists.*").
		Joins("JOIN song_artists ON song_artists.artist_id = artists.id").
		Where("song_artists.song_id IN ?", songIDs).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make(map[int64][]model.Artist, len(songIDs))
	for i := range rows {
		result[rows[i].SongID] = append(result[rows[i].SongID], rows[i].Artist)
	}
	return result, nil
}

// GetPlatformMappingsBySongIDs 批量查询多首歌曲的平台映射，返回 songID -> platform_mappings 映射
func (r *SongRepo) GetPlatformMappingsBySongIDs(ctx context.Context, songIDs []int64) (map[int64][]model.PlatformMapping, error) {
	if len(songIDs) == 0 {
		return map[int64][]model.PlatformMapping{}, nil
	}
	var pms []model.PlatformMapping
	err := r.db.WithContext(ctx).Where("song_id IN ?", songIDs).Find(&pms).Error
	if err != nil {
		return nil, err
	}
	result := make(map[int64][]model.PlatformMapping, len(songIDs))
	for i := range pms {
		result[pms[i].SongID] = append(result[pms[i].SongID], pms[i])
	}
	return result, nil
}

// CountSongs 歌曲总数
func (r *SongRepo) CountSongs(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.Song{}).Count(&count).Error
	return count, err
}

// SumWords 总字数
func (r *SongRepo) SumWords(ctx context.Context) (int64, error) {
	var sum int64
	err := r.db.WithContext(ctx).
		Model(&model.Song{}).
		Select("COALESCE(SUM(word_count), 0)").
		Scan(&sum).Error
	return sum, err
}

// SumLines 总行数
func (r *SongRepo) SumLines(ctx context.Context) (int64, error) {
	var sum int64
	err := r.db.WithContext(ctx).
		Model(&model.Song{}).
		Select("COALESCE(SUM(line_count), 0)").
		Scan(&sum).Error
	return sum, err
}

// CountAlbums 相异专辑数（基于 JSONB 数组展开）
func (r *SongRepo) CountAlbums(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Raw(`SELECT COUNT(DISTINCT elem) FROM songs, jsonb_array_elements_text(album) AS elem WHERE elem <> ''`).
		Scan(&count).Error
	return count, err
}

// PlatformDistribution 各平台歌曲数
func (r *SongRepo) PlatformDistribution(ctx context.Context) (map[string]int64, error) {
	type row struct {
		Platform string
		Count    int64
	}
	var rows []row
	err := r.db.WithContext(ctx).
		Table("platform_mappings").
		Select("platform, COUNT(*) AS count").
		Group("platform").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	m := make(map[string]int64, len(rows))
	for i := range rows {
		m[rows[i].Platform] = rows[i].Count
	}
	return m, nil
}

// ErrSongNotFound 歌曲未找到
var ErrSongNotFound = errors.New("song not found")
