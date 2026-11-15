package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/config"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/meilisearch/meilisearch-go"
	"github.com/redis/go-redis/v9"
	logrus "github.com/sirupsen/logrus"
)

// SearchService 搜索服务
type SearchService struct {
	cfg    *config.Config
	client *meilisearch.Client
	redis  *redis.Client
}

func NewSearchService(cfg *config.Config, client *meilisearch.Client, redisClient *redis.Client) *SearchService {
	return &SearchService{cfg: cfg, client: client, redis: redisClient}
}

// SearchRequest 搜索请求
type SearchRequest struct {
	Query  string
	Field  string // all, song, artist, album, id, lyric, author
	Limit  int
	Offset int
	// IncludeHistory 为 true 时不按组去重，返回组内所有版本。
	// 用于「歌词」Tab：用户搜某句词时，可能只有旧版本包含这句。
	// 仅索引层预分组路径（SEARCH_GROUP_FILTER = true）使用，降级路径保持旧行为。
	IncludeHistory bool
}

// SearchHitResult 单条命中
type SearchHitResult struct {
	ID                    string              `json:"id"`
	MusicNames            []string            `json:"musicNames"`
	Artists               []string            `json:"artists"`
	Albums                []string            `json:"albums"`
	PlatformIds           map[string][]string `json:"platformIds"`
	RawLyricFile          string              `json:"rawLyricFile"`
	WordCount             int                 `json:"wordCount"`
	LineCount             int                 `json:"lineCount"`
	CommitTimestamp       *int64              `json:"commitTimestamp,omitempty"`
	LyricSnippet          string              `json:"lyricSnippet,omitempty"` // 歌词匹配片段（高亮）
	TtmlAuthorGithub      string              `json:"ttmlAuthorGithub,omitempty"`
	TtmlAuthorGithubLogin string              `json:"ttmlAuthorGithubLogin,omitempty"`
}

// SearchResult 搜索结果
type SearchResult struct {
	Hits             []SearchHitResult `json:"hits"`
	TotalHits        int64             `json:"totalHits"`
	Limit            int               `json:"limit"`
	Offset           int               `json:"offset"`
	ProcessingTimeMs int               `json:"processingTimeMs"`
}

// searchGroupFields 搜索列表回捞的字段（不含歌词正文），两条路径共用。
var searchGroupFields = []string{
	"id",
	"platformIds_ncm", "platformIds_qq", "platformIds_spotify", "platformIds_apple",
	"musicNames", "artists", "albums",
	"rawLyricFile", "wordCount", "lineCount", "commitTimestamp",
	"ttmlAuthorGithub", "ttmlAuthorGithubLogin",
}

// shouldFilterHead 判断该搜索是否要「按组去重、只返回代表版本」
func shouldFilterHead(req SearchRequest) bool {
	if req.IncludeHistory {
		return false
	}
	// ID 精确查找是「定位某个具体文件」，不能因为它是旧版本就藏起来
	return req.Field != "id"
}

// headFilterOn 是否启用索引层预分组过滤（灰度开关，见 SEARCH_GROUP_FILTER）
func (s *SearchService) headFilterOn() bool {
	return s.cfg.Search.GroupFilter
}

// Search 执行搜索：索引层预分组，一次查询直出（方案 §7.3）。
// SEARCH_GROUP_FILTER 仅作降级开关，关闭时取消 isGroupHead 过滤，不切换实现。
func (s *SearchService) Search(ctx context.Context, req SearchRequest) (*SearchResult, error) {
	if req.Query == "" {
		return &SearchResult{
			Hits:   []SearchHitResult{},
			Limit:  req.Limit,
			Offset: req.Offset,
		}, nil
	}
	return s.searchByIndex(req)
}

// searchByIndex 索引层预分组路径（SEARCH_GROUP_FILTER = true）：
// 一次查询直出，Limit/Offset 正常分页 + isGroupHead = true 过滤，
// filter 在搜索阶段生效，故 EstimatedTotalHits 即歌曲数（精确）。
func (s *SearchService) searchByIndex(req SearchRequest) (*SearchResult, error) {
	index := s.client.Index(s.cfg.MeiliSearch.Index)

	searchReq := buildMeiliSearchRequest(req)
	searchReq.Limit = int64(req.Limit)
	searchReq.Offset = int64(req.Offset)
	searchReq.AttributesToRetrieve = searchGroupFields
	if s.headFilterOn() && shouldFilterHead(req) {
		searchReq.Filter = mergeFilter(searchReq.Filter, "isGroupHead = true")
	}

	resp, err := index.Search(searchReq.Query, &searchReq)
	if err != nil {
		logrus.WithError(err).Warn("meilisearch search failed")
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	hits := make([]SearchHitResult, 0, len(resp.Hits))
	for _, raw := range resp.Hits {
		hits = append(hits, convertHit(raw))
	}
	// 只为当前页命中补齐歌词正文与高亮片段
	s.hydrateLyricSnippets(index, req, hits)

	return &SearchResult{
		Hits:             hits,
		TotalHits:        resp.EstimatedTotalHits,
		Limit:            req.Limit,
		Offset:           req.Offset,
		ProcessingTimeMs: int(resp.ProcessingTimeMs),
	}, nil
}

// buildMeiliSearchRequest 构造通用搜索参数（query / field / id 精确过滤）。
// 索引层预分组路径专用：不硬编码 Limit/Offset，分页交由搜索引擎完成。
func buildMeiliSearchRequest(req SearchRequest) meilisearch.SearchRequest {
	// field=all 时不传 AttributesToSearchOn，让 MeiliSearch 搜所有 searchableAttributes
	// 指定 field 时才限定搜索字段
	var searchOn []string
	if req.Field != "" && req.Field != "all" && req.Field != "id" {
		searchOn = searchOnFields(req.Field)
	}

	searchReq := meilisearch.SearchRequest{
		Query:                req.Query,
		ShowRankingScore:     false,
		AttributesToSearchOn: searchOn,
	}

	// field=id：使用 filter 精确匹配所有平台 ID 字段和投稿者 ID
	if req.Field == "id" {
		searchReq.Query = ""
		searchReq.Filter = exactIDFilter(req.Query)
		searchReq.AttributesToSearchOn = nil
	}
	return searchReq
}

// mergeFilter 把额外的过滤条件与原条件用 AND 组合（索引层预分组路径使用）
func mergeFilter(base any, extra string) string {
	if s, ok := base.(string); ok && s != "" {
		return "(" + s + ") AND (" + extra + ")"
	}
	return extra
}

// hydrateLyricSnippets 为当前页命中补齐歌词正文与高亮片段（索引层预分组路径）。
// 只需按 id 精确回捞这几个文档（MeiliSearch 的 id 已加入 filterableAttributes），
// 不再用平台 ID 拉回整组所有版本；过滤口径与主查询保持一致。
func (s *SearchService) hydrateLyricSnippets(
	index *meilisearch.Index,
	req SearchRequest,
	hits []SearchHitResult,
) {
	if len(hits) == 0 {
		return
	}
	ids := make([]string, 0, len(hits))
	for _, h := range hits {
		if h.ID != "" {
			ids = append(ids, `"`+meiliEscape(h.ID)+`"`)
		}
	}
	if len(ids) == 0 {
		return
	}

	searchReq := buildMeiliSearchRequest(req)
	searchReq.Filter = mergeFilter(searchReq.Filter, "id IN ["+strings.Join(ids, ", ")+"]")
	if s.headFilterOn() && shouldFilterHead(req) {
		searchReq.Filter = mergeFilter(searchReq.Filter, "isGroupHead = true")
	}
	searchReq.Limit = int64(len(hits))
	searchReq.Offset = 0
	searchReq.AttributesToRetrieve = []string{"*"}
	searchReq.AttributesToCrop = []string{"lyricText"}
	searchReq.CropLength = 60
	searchReq.CropMarker = "..."
	searchReq.HighlightPreTag = "<mark>"
	searchReq.HighlightPostTag = "</mark>"

	resp, err := index.Search(searchReq.Query, &searchReq)
	if err != nil {
		logrus.WithError(err).Warn("hydrate lyric snippets failed")
		return
	}

	byID := make(map[string]SearchHitResult, len(resp.Hits))
	for _, raw := range resp.Hits {
		hit := convertHit(raw)
		if hit.ID != "" {
			byID[hit.ID] = hit
		}
	}
	for i := range hits {
		if full, ok := byID[hits[i].ID]; ok {
			hits[i] = full
		}
	}
}

// exactIDFilter 构造按平台 ID / 投稿者 ID 精确匹配的 filter 表达式
func exactIDFilter(query string) string {
	escaped := meiliEscape(query)
	return fmt.Sprintf(
		`platformIds_ncm = "%s" OR platformIds_qq = "%s" OR platformIds_spotify = "%s" OR platformIds_apple = "%s" OR ttmlAuthorGithub = "%s" OR ttmlAuthorGithubLogin = "%s"`,
		escaped, escaped, escaped, escaped, escaped, escaped,
	)
}

// searchOnFields 根据字段返回 attributesToSearchOn 列表
func searchOnFields(field string) []string {
	switch field {
	case "song":
		return []string{"musicNames", "musicNamesPinyin", "musicNamesInitials"}
	case "artist":
		return []string{"artists", "artistsPinyin", "artistsInitials"}
	case "album":
		return []string{"albums", "albumsPinyin", "albumsInitials"}
	case "lyric":
		return []string{"lyricText"}
	case "author":
		return []string{"ttmlAuthorGithub", "ttmlAuthorGithubLogin"}
	case "", "all":
		return []string{
			"musicNames", "musicNamesPinyin", "musicNamesInitials",
			"artists", "artistsPinyin", "artistsInitials",
			"albums", "albumsPinyin", "albumsInitials",
			"lyricText",
			"platformIds_ncm", "platformIds_qq", "platformIds_spotify", "platformIds_apple",
		}
	}
	return []string{"*"}
}

// convertHit 把 map[string]any 转换为 SearchHitResult
func convertHit(raw any) SearchHitResult {
	m, ok := raw.(map[string]any)
	if !ok {
		return SearchHitResult{}
	}
	hit := SearchHitResult{
		PlatformIds: map[string][]string{},
	}
	if v, ok := m["id"].(string); ok {
		hit.ID = v
	}
	hit.MusicNames = toStringSlice(m["musicNames"])
	hit.Artists = toStringSlice(m["artists"])
	hit.Albums = toStringSlice(m["albums"])
	if v, ok := m["rawLyricFile"].(string); ok {
		hit.RawLyricFile = v
	}
	if v, ok := m["ttmlAuthorGithub"].(string); ok {
		hit.TtmlAuthorGithub = v
	}
	if v, ok := m["ttmlAuthorGithubLogin"].(string); ok {
		hit.TtmlAuthorGithubLogin = v
	}
	for k, v := range m {
		const prefix = "platformIds_"
		if len(k) > len(prefix) && k[:len(prefix)] == prefix {
			platform := k[len(prefix):]
			if ids := toStringSlice(v); len(ids) > 0 {
				hit.PlatformIds[platform] = ids
			}
		}
	}
	if v, ok := toFloat(m["wordCount"]); ok {
		hit.WordCount = int(v)
	}
	if v, ok := toFloat(m["lineCount"]); ok {
		hit.LineCount = int(v)
	}
	if v, ok := toFloat(m["commitTimestamp"]); ok {
		ts := int64(v)
		hit.CommitTimestamp = &ts
	}
	// 提取歌词片段
	if formatted, ok := m["_formatted"].(map[string]any); ok {
		if v, ok := formatted["lyricText"].(string); ok && v != "" {
			hit.LyricSnippet = v
		}
	}
	return hit
}

func toStringSlice(v any) []string {
	if v == nil {
		return nil
	}
	if s, ok := v.(string); ok {
		if s == "" {
			return nil
		}
		return []string{s}
	}
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, e := range arr {
		if s, ok := e.(string); ok && s != "" {
			out = append(out, s)
		}
	}
	return out
}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	}
	return 0, false
}

// meiliEscape 转义 filter 字符串中的特殊字符（仅做基础双引号转义）
func meiliEscape(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if r == '"' || r == '\\' {
			out = append(out, '\\')
		}
		out = append(out, r)
	}
	return string(out)
}

// countFields 需要统计命中数的字段（与前端搜索结果页的 Tab 一一对应）
var countFields = []string{"all", "song", "artist", "album", "lyric", "id", "author"}

// searchCountsCacheTTL 搜索 Tab 命中数缓存时间，与前端 counts 查询的 staleTime 对齐
const searchCountsCacheTTL = 60 * time.Second

// CountByFields 并发统计各字段的命中数，供搜索页 Tab 的数字徽章使用。
// 每路只做一次 Limit:0 查询读 estimatedTotalHits（方案 §7.5）。
func (s *SearchService) CountByFields(ctx context.Context, query string) (map[string]int64, error) {
	totals := make(map[string]int64, len(countFields))
	if query == "" {
		for _, f := range countFields {
			totals[f] = 0
		}
		return totals, nil
	}

	cacheKey := "search:counts:" + query
	if s.redis != nil {
		if cached, err := s.redis.Get(ctx, cacheKey).Result(); err == nil && cached != "" {
			var cachedTotals map[string]int64
			if err := json.Unmarshal([]byte(cached), &cachedTotals); err == nil {
				return cachedTotals, nil
			}
		}
	}

	var statErr error
	totals, statErr = s.countByIndex(query)
	if statErr != nil {
		return nil, statErr
	}

	if s.redis != nil {
		if data, err := json.Marshal(totals); err == nil {
			_ = s.redis.Set(ctx, cacheKey, data, searchCountsCacheTTL).Err()
		}
	}
	return totals, nil
}

// countByIndex 每路只做一次 Limit:0 查询，直接读 estimatedTotalHits，不再拉取全量命中。
// 歌词 Tab 与 Search 口径保持一致（IncludeHistory 允许命中旧版本）；
// 方案 §7.5 的字面写法是 field != "id" 就加过滤，会让 lyric 徽章与列表条数不符。
func (s *SearchService) countByIndex(query string) (map[string]int64, error) {
	totals := make(map[string]int64, len(countFields))
	var (
		mu       sync.Mutex
		wg       sync.WaitGroup
		firstErr error
	)
	index := s.client.Index(s.cfg.MeiliSearch.Index)
	for _, field := range countFields {
		field := field
		wg.Add(1)
		go func() {
			defer wg.Done()
			pkg.RunSafe("search-count", func() {
				// 口径与 Search 保持一致：歌词 Tab 允许命中旧版本，id 精确查找不按组去重
				req := SearchRequest{Query: query, Field: field, IncludeHistory: field == "lyric"}
				searchReq := buildMeiliSearchRequest(req)
				searchReq.Limit = 0 // 只要计数，不要 hits（omitempty 下退化为默认 limit，
				// 但 estimatedTotalHits 仍是精确总数）；限制回捞字段进一步减小响应体
				searchReq.Offset = 0
				searchReq.AttributesToRetrieve = []string{"id"}
				if s.headFilterOn() && shouldFilterHead(req) {
					searchReq.Filter = mergeFilter(searchReq.Filter, "isGroupHead = true")
				}

				resp, err := index.Search(searchReq.Query, &searchReq)
				mu.Lock()
				defer mu.Unlock()
				if err != nil {
					if firstErr == nil {
						firstErr = fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
					}
					return
				}
				totals[field] = resp.EstimatedTotalHits
			})
		}()
	}
	wg.Wait()
	return totals, firstErr
}
