package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	logrus "github.com/sirupsen/logrus"
)

// 无歌词记录补齐任务：每 5 分钟拉一批「歌名或封面为空」的记录，
// 解析后回写分类与歌曲元数据，取代 Worker 侧的同名回填任务。
const (
	notFoundBackfillInterval     = 5 * time.Minute
	notFoundBackfillStartupDelay = time.Minute
	notFoundBackfillBatch        = 200
	notFoundBackfillLockKey      = "not_found:backfill:lock"
	notFoundBackfillLockTTL      = notFoundBackfillInterval + 2*time.Minute
	notFoundBackfillLockRenew    = 2 * time.Minute
	notFoundBackfillItemTimeout  = 40 * time.Second
)

// 纯音乐关键词，仅匹配 LRC 元数据标签行
var pureMusicKeywords = []string{
	"pure", "instrumental", "karaoke", "accompaniment", "纯音乐", "伴奏", "器乐", "无歌词",
}

// errNCMAPINotConfigured 后端未配置 NCM 代理地址，ncm 记录本轮跳过
var errNCMAPINotConfigured = errors.New("NCM_API_BASE 未配置")

// backfillParsedRecord 单条记录的解析结果
type backfillParsedRecord struct {
	category string
	songName string
	artists  []string
	cover    string
	album    string
}

// ncmSongDetailResponse 网易云歌曲详情响应
type ncmSongDetailResponse struct {
	Code  int            `json:"code"`
	Songs []ncmSongBrief `json:"songs"`
}

type ncmSongBrief struct {
	Type    *int          `json:"t"`
	Name    string        `json:"name"`
	Artists []ncmArtist   `json:"ar"`
	Album   ncmAlbumBrief `json:"al"`
}

type ncmArtist struct {
	Name string `json:"name"`
}

type ncmAlbumBrief struct {
	Name   string `json:"name"`
	PicURL string `json:"picUrl"`
}

// ncmLyricResponse 网易云歌词响应
type ncmLyricResponse struct {
	Code int `json:"code"`
	Lrc  struct {
		Lyric string `json:"lyric"`
	} `json:"lrc"`
}

var (
	backfillRenewLockScript   = redis.NewScript(`if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`)
	backfillReleaseLockScript = redis.NewScript(`if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`)
)

// StartBackfillTask 启动定时补齐任务
func (s *NotFoundService) StartBackfillTask(ctx context.Context) {
	pkg.GoSafe("not-found-backfill", func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(notFoundBackfillStartupDelay):
		}

		ticker := time.NewTicker(notFoundBackfillInterval)
		defer ticker.Stop()
		for {
			s.runBackfillOnce(ctx)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	})
	logrus.Infof("[not_found] backfill task scheduled, interval=%s", notFoundBackfillInterval)
}

// runBackfillOnce 执行一轮补齐：抢锁 → 取一批记录 → 逐条解析回写
func (s *NotFoundService) runBackfillOnce(ctx context.Context) {
	token, locked, err := s.acquireBackfillLock(ctx)
	if err != nil {
		logrus.WithError(err).Warn("[not_found] backfill acquire lock failed")
		return
	}
	if !locked {
		return
	}
	defer s.releaseBackfillLock(token)

	rows, err := s.repo.ListIncompleteRecords(ctx, notFoundBackfillBatch)
	if err != nil {
		logrus.WithError(err).Error("[not_found] backfill list incomplete records failed")
		return
	}
	if len(rows) == 0 {
		return
	}

	logrus.Infof("[not_found] backfill start: %d record(s)", len(rows))
	if strings.TrimSpace(s.ncmAPIBase) == "" {
		logrus.Warn("[not_found] backfill: NCM_API_BASE 未配置，本轮跳过 ncm 记录")
	}

	var resolved, skipped, changed int
	lastRenew := time.Now()
	for _, row := range rows {
		if ctx.Err() != nil {
			return
		}
		// 按时间续期而不是按条数：单条最坏耗时 40s，按条数可能跑过锁 TTL
		if time.Since(lastRenew) >= notFoundBackfillLockRenew {
			s.renewBackfillLock(ctx, token)
			lastRenew = time.Now()
		}

		itemCtx, cancel := context.WithTimeout(ctx, notFoundBackfillItemTimeout)
		res, parseErr := s.parseBackfillRecord(itemCtx, row.Platform, row.PlatformID)
		cancel()

		if parseErr != nil {
			skipped++
			if !errors.Is(parseErr, errNCMAPINotConfigured) {
				logrus.WithError(parseErr).WithFields(logrus.Fields{
					"platform":    row.Platform,
					"platform_id": row.PlatformID,
				}).Warn("[not_found] backfill parse failed")
			}
			s.touchBackfillRecord(ctx, row)
			continue
		}
		if res == nil || res.songName == "" {
			// 查不到有效歌曲信息：打上时间戳，避免同热度记录反复占位，下一轮继续尝试
			skipped++
			s.touchBackfillRecord(ctx, row)
			continue
		}

		if err := s.applyBackfillResult(ctx, row, res); err != nil {
			skipped++
			logrus.WithError(err).WithFields(logrus.Fields{
				"platform":    row.Platform,
				"platform_id": row.PlatformID,
			}).Warn("[not_found] backfill write metadata failed")
			s.touchBackfillRecord(ctx, row)
			continue
		}

		resolved++
		changed++
	}

	if changed > 0 {
		s.clearRankingCache(ctx)
	}
	logrus.Infof("[not_found] backfill finished: total=%d resolved=%d skipped=%d", len(rows), resolved, skipped)
}

// parseBackfillRecord 按平台解析单条记录
func (s *NotFoundService) parseBackfillRecord(ctx context.Context, platform, platformID string) (*backfillParsedRecord, error) {
	switch platform {
	case "ncm":
		return s.parseNCMRecord(ctx, platformID)
	case "qq":
		return s.parseQQRecord(ctx, platformID)
	default:
		return nil, fmt.Errorf("unsupported platform: %s", platform)
	}
}

// parseNCMRecord 网易云：详情定云盘，歌词元数据定纯音乐，其余归为无歌词
func (s *NotFoundService) parseNCMRecord(ctx context.Context, platformID string) (*backfillParsedRecord, error) {
	if strings.TrimSpace(s.ncmAPIBase) == "" {
		return nil, errNCMAPINotConfigured
	}

	var detail ncmSongDetailResponse
	if err := s.getNCMAPI(ctx, "/song/detail", url.Values{"ids": {platformID}}, &detail); err != nil {
		return nil, fmt.Errorf("fetch ncm song detail: %w", err)
	}
	if detail.Code != 200 {
		return nil, fmt.Errorf("ncm song detail code: %d", detail.Code)
	}
	if len(detail.Songs) == 0 {
		return nil, nil
	}

	song := detail.Songs[0]
	res := &backfillParsedRecord{
		category: model.CategoryNotFound,
		songName: song.Name,
		cover:    song.Album.PicURL,
		album:    song.Album.Name,
	}
	for _, a := range song.Artists {
		if a.Name != "" {
			res.artists = append(res.artists, a.Name)
		}
	}

	// t=1/2 为云盘音乐
	if song.Type != nil && (*song.Type == 1 || *song.Type == 2) {
		res.category = model.CategoryCloudMusic
		return res, nil
	}

	var lyric ncmLyricResponse
	if err := s.getNCMAPI(ctx, "/lyric", url.Values{"id": {platformID}}, &lyric); err != nil {
		return nil, fmt.Errorf("fetch ncm lyric: %w", err)
	}
	if lyric.Code != 200 {
		return nil, fmt.Errorf("ncm lyric code: %d", lyric.Code)
	}
	if lrcMetadataIndicatesPureMusic(lyric.Lrc.Lyric) {
		res.category = model.CategoryPureMusic
	}
	return res, nil
}

// parseQQRecord QQ 音乐：只补元数据，不做纯音乐/云盘判定
func (s *NotFoundService) parseQQRecord(ctx context.Context, platformID string) (*backfillParsedRecord, error) {
	if s.qmSvc == nil {
		return nil, fmt.Errorf("qm music service not initialized")
	}

	song, err := s.qmSvc.GetSong(ctx, platformID)
	if err != nil {
		return nil, fmt.Errorf("fetch qm song: %w", err)
	}

	res := &backfillParsedRecord{
		category: model.CategoryNotFound,
		songName: song.Name,
		cover:    song.Cover,
		album:    song.Album.Name,
	}
	if res.cover == "" {
		res.cover = song.Album.Cover
	}
	res.artists = splitArtistName(song.ArtistName)
	if len(res.artists) == 0 {
		for _, a := range song.Artists {
			if a.Name != "" {
				res.artists = append(res.artists, a.Name)
			}
		}
	}
	return res, nil
}

// applyBackfillResult 白名单登记 + 回写分类与元数据
func (s *NotFoundService) applyBackfillResult(ctx context.Context, row repository.IncompleteRecord, res *backfillParsedRecord) error {
	key := row.Platform + ":" + row.PlatformID

	switch res.category {
	case model.CategoryPureMusic:
		if s.redis != nil {
			if err := s.redis.SAdd(ctx, "not_found:pure_music:set", key).Err(); err != nil {
				logrus.WithError(err).Warn("[not_found] backfill add pure_music redis set failed")
			}
		}
		if err := s.repo.AddPureMusic(ctx, row.Platform, row.PlatformID, res.songName,
			"歌词解析发现纯音乐关键词", ""); err != nil {
			logrus.WithError(err).Warn("[not_found] backfill add pure_music whitelist failed")
		}
	case model.CategoryCloudMusic:
		if s.redis != nil {
			if err := s.redis.SAdd(ctx, "not_found:cloud_music:set", key).Err(); err != nil {
				logrus.WithError(err).Warn("[not_found] backfill add cloud_music redis set failed")
			}
		}
		if err := s.repo.AddCloudMusic(ctx, row.Platform, row.PlatformID, res.songName,
			"网易云 t=1/2 云盘音乐", ""); err != nil {
			logrus.WithError(err).Warn("[not_found] backfill add cloud_music whitelist failed")
		}
	}

	return s.repo.UpdateParsedMetadata(
		ctx, row.Platform, row.PlatformID, res.category,
		res.songName, strings.Join(res.artists, " / "), res.cover, res.album,
	)
}

// touchBackfillRecord 打上「本轮已尝试」标记，避免同一条记录反复占满批次
func (s *NotFoundService) touchBackfillRecord(ctx context.Context, row repository.IncompleteRecord) {
	if err := s.repo.TouchRecord(ctx, row.Platform, row.PlatformID); err != nil {
		logrus.WithError(err).WithFields(logrus.Fields{
			"platform":    row.Platform,
			"platform_id": row.PlatformID,
		}).Warn("[not_found] backfill touch record failed")
	}
}

// getNCMAPI 请求 NCM 代理接口并解析 JSON
func (s *NotFoundService) getNCMAPI(ctx context.Context, path string, query url.Values, out any) error {
	base := strings.TrimRight(strings.TrimSpace(s.ncmAPIBase), "/")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+path+"?"+query.Encode(), nil)
	if err != nil {
		return err
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// acquireBackfillLock 抢占分布式锁；Redis 不可用时退化为单实例执行
func (s *NotFoundService) acquireBackfillLock(ctx context.Context) (string, bool, error) {
	if s.redis == nil {
		return "", true, nil
	}
	token := uuid.NewString()
	ok, err := s.redis.SetNX(ctx, notFoundBackfillLockKey, token, notFoundBackfillLockTTL).Result()
	if err != nil {
		return "", false, err
	}
	return token, ok, nil
}

// renewBackfillLock 校验 owner 后给锁续期，避免一批记录跑过 TTL 后锁被抢走
func (s *NotFoundService) renewBackfillLock(ctx context.Context, token string) {
	if s.redis == nil || token == "" {
		return
	}
	if err := backfillRenewLockScript.Run(ctx, s.redis, []string{notFoundBackfillLockKey},
		token, notFoundBackfillLockTTL.Milliseconds()).Err(); err != nil {
		logrus.WithError(err).Warn("[not_found] backfill renew lock failed")
	}
}

// releaseBackfillLock 仅当锁仍属于本实例时释放
func (s *NotFoundService) releaseBackfillLock(token string) {
	if s.redis == nil || token == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := backfillReleaseLockScript.Run(ctx, s.redis, []string{notFoundBackfillLockKey}, token).Err(); err != nil {
		logrus.WithError(err).Warn("[not_found] backfill release lock failed")
	}
}

// splitArtistName 拆分 "A / B" 形式的歌手名
func splitArtistName(name string) []string {
	parts := strings.Split(name, "/")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// lrcMetadataIndicatesPureMusic 只检查 LRC 元数据标签行（[ti:] / [ar:] 等）
//
// 不能对整段歌词做 contains：正文唱到「伴奏」「纯音乐」会被误判为纯音乐，
// 写进白名单后这首歌会被永久跳过。正文时间戳行（[00:12.34]...）一律排除。
func lrcMetadataIndicatesPureMusic(lrc string) bool {
	for _, line := range strings.Split(lrc, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "[") {
			continue
		}
		rest := line[1:]
		end := strings.Index(rest, "]")
		if end < 0 {
			continue
		}
		tag := rest[:end]
		key := tag
		if i := strings.Index(tag, ":"); i >= 0 {
			key = tag[:i]
		}
		// 元数据标签的 key 是纯字母；正文时间戳以数字开头，必须排除
		if key == "" || !isASCIIAlphabetic(key) {
			continue
		}
		lower := strings.ToLower(tag)
		for _, kw := range pureMusicKeywords {
			if strings.Contains(lower, kw) {
				return true
			}
		}
	}
	return false
}

func isASCIIAlphabetic(s string) bool {
	for _, c := range s {
		if (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') {
			return false
		}
	}
	return true
}
