package service

import (
	"context"
	"fmt"
	"net/http"
	"time"

	musicapi "github.com/xiaowumin-mark/AMLX-MUSIC-API"

	_ "github.com/xiaowumin-mark/AMLX-MUSIC-API/kugou"
	_ "github.com/xiaowumin-mark/AMLX-MUSIC-API/netease"
	_ "github.com/xiaowumin-mark/AMLX-MUSIC-API/qqmusic"

	"github.com/amll-dev/amll-hub/backend/internal/config"
	logrus "github.com/sirupsen/logrus"
)

// OnlineSearchHit 在线搜索单条结果
type OnlineSearchHit struct {
	SongName   string   `json:"songName"`
	Artists    []string `json:"artists"`
	AlbumName  string   `json:"albumName"`
	Platform   string   `json:"platform"`   // ncm / qq / kugou
	PlatformID string   `json:"platformId"` // 平台歌曲 ID
	Duration   int      `json:"duration"`   // 时长（秒）
	CoverURL   string   `json:"coverUrl"`   // 封面 URL
}

// OnlineSearchResult 在线搜索结果
type OnlineSearchResult struct {
	Hits  []OnlineSearchHit `json:"hits"`
	Total int               `json:"total"` // 总数，-1 表示未知
}

// OnlineSongDetail 歌曲详情
type OnlineSongDetail struct {
	SongName      string         `json:"songName"`
	Artists       []string       `json:"artists"`
	AlbumName     string         `json:"albumName"`
	AlbumID       string         `json:"albumId"`
	Platform      string         `json:"platform"`
	PlatformID    string         `json:"platformId"`
	Duration      int            `json:"duration"` // 秒
	CoverURL      string         `json:"coverUrl"`
	PayStatus     string         `json:"payStatus"`     // free/vip/only
	PlatformExtra map[string]any `json:"platformExtra"` // 平台扩展字段
}

// OnlineLyricLine 歌词行
type OnlineLyricLine struct {
	Time      int64            `json:"time"`     // 毫秒
	Duration  int64            `json:"duration"` // 毫秒
	Text      string           `json:"text"`
	Syllables []OnlineSyllable `json:"syllables,omitempty"` // 逐字时间轴（QRC/KRC）
}

// OnlineSyllable 逐字歌词段
type OnlineSyllable struct {
	Time     int64  `json:"time"`               // 毫秒（绝对时间）
	Duration int64  `json:"duration,omitempty"` // 毫秒
	Text     string `json:"text"`
}

// OnlineLyric 歌词结果
type OnlineLyric struct {
	Raw          string            `json:"raw"`          // 原始歌词文本
	Lines        []OnlineLyricLine `json:"lines"`        // 主歌词
	Translation  []OnlineLyricLine `json:"translation"`  // 翻译
	Romanization []OnlineLyricLine `json:"romanization"` // 罗马音
}

// OnlineSearchService 在线搜索服务
type OnlineSearchService struct {
	cfg       *config.Config
	providers map[string]musicapi.MusicProvider // key: ncm/qq/kugou
}

func NewOnlineSearchService(cfg *config.Config) *OnlineSearchService {
	httpClient := &http.Client{
		Timeout: time.Duration(cfg.OnlineSearch.TimeoutSec) * time.Second,
	}

	providers := make(map[string]musicapi.MusicProvider)

	if p, err := musicapi.Get("netease", musicapi.WithHTTPClient(httpClient)); err == nil {
		providers["ncm"] = p
	} else {
		logrus.Warnf("init netease provider failed: %v", err)
	}
	if p, err := musicapi.Get("qq", musicapi.WithHTTPClient(httpClient)); err == nil {
		providers["qq"] = p
	} else {
		logrus.Warnf("init qq provider failed: %v", err)
	}
	if p, err := musicapi.Get("kugou", musicapi.WithHTTPClient(httpClient)); err == nil {
		providers["kugou"] = p
	} else {
		logrus.Warnf("init kugou provider failed: %v", err)
	}

	return &OnlineSearchService{cfg: cfg, providers: providers}
}

// Search 执行在线搜索，platform 三选一：ncm / qq / kugou
func (s *OnlineSearchService) Search(ctx context.Context, query string, platform string, limit int) (*OnlineSearchResult, error) {
	provider, ok := s.providers[platform]
	if !ok {
		return nil, fmt.Errorf("%w: 不支持的平台 %s", ErrInvalidInput, platform)
	}

	result, err := provider.Search(ctx, query, musicapi.SearchTypeSong, 1, limit)
	if err != nil {
		logrus.WithError(err).WithField("platform", platform).Warn("online search failed")
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	hits := make([]OnlineSearchHit, 0, len(result.Songs))
	for _, song := range result.Songs {
		hit := OnlineSearchHit{
			SongName:   song.Name,
			PlatformID: song.ID,
			Platform:   platform,
			Duration:   song.Duration,
			CoverURL:   song.CoverURL,
		}

		for _, a := range song.Artists {
			hit.Artists = append(hit.Artists, a.Name)
		}

		if song.Album != nil {
			hit.AlbumName = song.Album.Name
		}

		hits = append(hits, hit)
	}

	return &OnlineSearchResult{
		Hits:  hits,
		Total: result.Total,
	}, nil
}

// GetSong 获取歌曲详情
func (s *OnlineSearchService) GetSong(ctx context.Context, platform string, songID string) (*OnlineSongDetail, error) {
	provider, ok := s.providers[platform]
	if !ok {
		return nil, fmt.Errorf("%w: 不支持的平台 %s", ErrInvalidInput, platform)
	}

	song, err := provider.GetSong(ctx, songID)
	if err != nil {
		logrus.WithError(err).WithField("platform", platform).WithField("song_id", songID).Warn("online get song failed")
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	detail := &OnlineSongDetail{
		SongName:      song.Name,
		PlatformID:    song.ID,
		Platform:      platform,
		Duration:      song.Duration,
		CoverURL:      song.CoverURL,
		PayStatus:     song.PayStatus,
		PlatformExtra: song.PlatformExtra,
	}

	for _, a := range song.Artists {
		detail.Artists = append(detail.Artists, a.Name)
	}

	if song.Album != nil {
		detail.AlbumName = song.Album.Name
		detail.AlbumID = song.Album.ID
	}

	return detail, nil
}

// GetLyric 获取歌词
func (s *OnlineSearchService) GetLyric(ctx context.Context, platform string, songID string) (*OnlineLyric, error) {
	provider, ok := s.providers[platform]
	if !ok {
		return nil, fmt.Errorf("%w: 不支持的平台 %s", ErrInvalidInput, platform)
	}

	lyric, err := provider.GetLyric(ctx, songID)
	if err != nil {
		logrus.WithError(err).WithField("platform", platform).WithField("song_id", songID).Warn("online get lyric failed")
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	result := &OnlineLyric{
		Raw: lyric.Raw,
	}

	// 转换 Lines
	for _, line := range lyric.Lines {
		out := OnlineLyricLine{
			Time:     line.Time,
			Duration: line.Duration,
			Text:     line.Text,
		}
		for _, syl := range line.Syllables {
			out.Syllables = append(out.Syllables, OnlineSyllable{
				Time:     syl.Time,
				Duration: syl.Duration,
				Text:     syl.Text,
			})
		}
		result.Lines = append(result.Lines, out)
	}

	// 转换 Translation
	for _, line := range lyric.Translation {
		result.Translation = append(result.Translation, OnlineLyricLine{
			Time:     line.Time,
			Duration: line.Duration,
			Text:     line.Text,
		})
	}

	// 转换 Romanization
	for _, line := range lyric.Romanization {
		result.Romanization = append(result.Romanization, OnlineLyricLine{
			Time:     line.Time,
			Duration: line.Duration,
			Text:     line.Text,
		})
	}

	return result, nil
}
