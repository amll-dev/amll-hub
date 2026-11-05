package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/config"
	"github.com/redis/go-redis/v9"
	logrus "github.com/sirupsen/logrus"

	"github.com/cybaka520/AMLLHub-Music-API/pkg/models"
	"github.com/cybaka520/AMLLHub-Music-API/pkg/qm"
)

const (
	qmSearchTTL   = 10 * time.Minute
	qmSongTTL     = 10 * time.Minute
	qmPlaylistTTL = 30 * time.Minute
)

// qmLevels 支持的音质档位
var qmLevels = map[string]struct{}{
	"hi-res":   {},
	"lossless": {},
	"hq":       {},
	"sq":       {},
	"lq":       {},
}

// QMMusicResult 单曲解析结果：qm 原始字段 + 结构化歌词
type QMMusicResult struct {
	*qm.MusicResponse
	// Lyrics 结构化歌词（QRC 逐字优先，退回 LRC）
	Lyrics *OnlineLyric `json:"lyrics,omitempty"`
}

// QMSongIDResult mid / 数字 id 互转结果
type QMSongIDResult struct {
	ID  int64  `json:"id"`
	Mid string `json:"mid"`
}

// QMMusicServicel
type QMMusicService struct {
	cfg    *config.Config
	redis  *redis.Client
	client *qm.Client
}

// NewQMMusicService 构造函数
func NewQMMusicService(cfg *config.Config, redisClient *redis.Client) *QMMusicService {
	cookie := strings.TrimSpace(cfg.QM.Cookie)
	store := newQMCookieStore(redisClient, cfg.QM.CookieKey, cookie)

	if cookie == "" {
		logrus.Warn("QM_COOKIE not set, qq music will run in anonymous mode (search only)")
	}

	return &QMMusicService{
		cfg:    cfg,
		redis:  redisClient,
		client: qm.NewClient(cookie, qm.WithCookieStore(store)),
	}
}

// Search 搜索歌曲，limit 收敛到 1..100
func (s *QMMusicService) Search(ctx context.Context, keywords string, limit int) (*qm.SearchResponse, error) {
	keywords = strings.TrimSpace(keywords)
	if keywords == "" {
		return nil, fmt.Errorf("%w: keywords 不能为空", ErrInvalidInput)
	}
	if limit < 1 {
		limit = 1
	} else if limit > 100 {
		limit = 100
	}

	cacheKey := fmt.Sprintf("qm:search:%s:%d", keywords, limit)
	if cached, ok := getCachedJSON[qm.SearchResponse](ctx, s.redis, cacheKey); ok {
		return &cached, nil
	}

	resp, err := s.client.Search(ctx, keywords, limit)
	if err != nil {
		return nil, s.wrapErr("search", err)
	}
	setCachedJSON(ctx, s.redis, cacheKey, resp, qmSearchTTL)
	return resp, nil
}

// GetSong 获取歌曲详情
func (s *QMMusicService) GetSong(ctx context.Context, idOrMid string) (*qm.Song, error) {
	idOrMid = strings.TrimSpace(idOrMid)
	if idOrMid == "" {
		return nil, fmt.Errorf("%w: id 不能为空", ErrInvalidInput)
	}

	cacheKey := "qm:song:" + idOrMid
	if cached, ok := getCachedJSON[qm.Song](ctx, s.redis, cacheKey); ok {
		return &cached, nil
	}

	song, err := s.client.GetSong(ctx, idOrMid)
	if err != nil {
		return nil, s.wrapErr("song", err)
	}
	setCachedJSON(ctx, s.redis, cacheKey, song, qmSongTTL)
	return song, nil
}

// ParseMusic 解析单曲直链与歌词
func (s *QMMusicService) ParseMusic(ctx context.Context, idOrMid, level string) (*QMMusicResult, error) {
	idOrMid = strings.TrimSpace(idOrMid)
	if idOrMid == "" {
		return nil, fmt.Errorf("%w: songId 不能为空", ErrInvalidInput)
	}
	level = strings.TrimSpace(level)
	if level == "" {
		level = "hq"
	}
	if _, ok := qmLevels[level]; !ok {
		return nil, fmt.Errorf("%w: 不支持的音质 %s", ErrInvalidInput, level)
	}

	music, err := s.client.ParseMusic(ctx, idOrMid, level)
	if err != nil {
		return nil, s.wrapErr("parse-music", err)
	}

	// 凭据无效时上游可能返回无法解密的二进制块，这里统一剔除
	music.Lyric = sanitizeLyricText(music.Lyric)
	music.QRC = sanitizeLyricText(music.QRC)
	music.Translation = sanitizeLyricText(music.Translation)
	music.Romaji = sanitizeLyricText(music.Romaji)

	return &QMMusicResult{
		MusicResponse: music,
		Lyrics:        BuildOnlineLyric(music.Lyric, music.QRC, music.Translation, music.Romaji),
	}, nil
}

// ParsePlaylist 解析歌单
func (s *QMMusicService) ParsePlaylist(ctx context.Context, playlistID string) (*qm.PlaylistResponse, error) {
	playlistID = strings.TrimSpace(playlistID)
	if playlistID == "" {
		return nil, fmt.Errorf("%w: playlistId 不能为空", ErrInvalidInput)
	}

	cacheKey := "qm:playlist:" + playlistID
	if cached, ok := getCachedJSON[qm.PlaylistResponse](ctx, s.redis, cacheKey); ok {
		return &cached, nil
	}

	resp, err := s.client.ParsePlaylist(ctx, playlistID)
	if err != nil {
		return nil, s.wrapErr("parse-playlist", err)
	}
	setCachedJSON(ctx, s.redis, cacheKey, resp, qmPlaylistTTL)
	return resp, nil
}

// Convert 在 mid 与数字 id 之间互转，输入支持链接
func (s *QMMusicService) Convert(ctx context.Context, idOrMid string) (*QMSongIDResult, error) {
	song, err := s.GetSong(ctx, idOrMid)
	if err != nil {
		return nil, err
	}
	return &QMSongIDResult{ID: song.ID, Mid: song.Mid}, nil
}

// wrapErr 把 qm 库错误归类为 service 层错误类型
func (s *QMMusicService) wrapErr(action string, err error) error {
	if err == nil {
		return nil
	}

	var apiErr *models.APIError
	if errors.As(err, &apiErr) {
		if apiErr.Code == 400 {
			return fmt.Errorf("%w: %s", ErrInvalidInput, apiErr.Message)
		}
		logrus.WithError(err).WithField("action", action).Warn("qm upstream api error")
		return fmt.Errorf("%w: %s", ErrUpstreamUnavailable, apiErr.Message)
	}

	switch {
	case errors.Is(err, qm.ErrNoPlayableURL):
		return ErrNoPlayableURL
	case errors.Is(err, qm.ErrCredentialExpired):
		logrus.WithError(err).WithField("action", action).Warn("qm credential expired")
		return ErrQMCredentialExpired
	case errors.Is(err, qm.ErrSongNotFound):
		return ErrNotFound
	}

	logrus.WithError(err).WithField("action", action).Warn("qm request failed")
	return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
}
