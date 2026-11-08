package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
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

// maxGroupFetch 合并分组前一次性拉取的最大命中数
const maxGroupFetch = 100000

var searchGroupFields = []string{
	"id",
	"platformIds_ncm", "platformIds_qq", "platformIds_spotify", "platformIds_apple",
	"musicNames", "artists", "albums",
	"rawLyricFile", "wordCount", "lineCount", "commitTimestamp",
	"ttmlAuthorGithub", "ttmlAuthorGithubLogin",
}

// countFetchFields 统计命中数时只需要分组字段
var countFetchFields = []string{
	"platformIds_ncm", "platformIds_qq", "platformIds_spotify", "platformIds_apple",
	"musicNames", "artists", "rawLyricFile",
}

// Search 执行搜索
func (s *SearchService) Search(ctx context.Context, req SearchRequest) (*SearchResult, error) {
	if req.Query == "" {
		return &SearchResult{
			Hits:   []SearchHitResult{},
			Limit:  req.Limit,
			Offset: req.Offset,
		}, nil
	}

	index := s.client.Index(s.cfg.MeiliSearch.Index)

	// 全量拉取分组字段（不含歌词正文），组内合并后只保留最新版本
	hits, processingTimeMs, err := s.fetchAllHits(index, req, searchGroupFields)
	if err != nil {
		return nil, err
	}
	reps := groupHits(hits)

	// 分页在合并后的歌曲列表上进行，避免同一首歌的版本跨页重复
	start := req.Offset
	if start > len(reps) {
		start = len(reps)
	}
	end := start + req.Limit
	if end > len(reps) {
		end = len(reps)
	}
	pageHits := reps[start:end]

	// 只为当前页代表补齐歌词与高亮片段
	s.hydrateLyricSnippets(index, req, pageHits)

	return &SearchResult{
		Hits:             pageHits,
		TotalHits:        int64(len(reps)),
		Limit:            req.Limit,
		Offset:           req.Offset,
		ProcessingTimeMs: processingTimeMs,
	}, nil
}

// fetchAllHits 按指定字段全量拉取命中（offset=0），供应用层合并分组使用。
func (s *SearchService) fetchAllHits(
	index *meilisearch.Index,
	req SearchRequest,
	attributes []string,
) ([]SearchHitResult, int, error) {
	searchReq := buildMeiliSearchRequest(req)
	searchReq.AttributesToRetrieve = attributes
	return searchHits(index, searchReq)
}

// buildMeiliSearchRequest 构造通用搜索参数（query / field / id 精确过滤）
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
		Limit:                maxGroupFetch,
		Offset:               0,
	}

	// field=id：使用 filter 精确匹配所有平台 ID 字段和投稿者 ID
	if req.Field == "id" {
		searchReq.Query = ""
		searchReq.Filter = exactIDFilter(req.Query)
		searchReq.AttributesToSearchOn = nil
	}
	return searchReq
}

// searchHits 执行 MeiliSearch 查询并转换为命中结构
func searchHits(index *meilisearch.Index, searchReq meilisearch.SearchRequest) ([]SearchHitResult, int, error) {
	resp, err := index.Search(searchReq.Query, &searchReq)
	if err != nil {
		logrus.WithError(err).Warn("meilisearch search failed")
		return nil, 0, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	hits := make([]SearchHitResult, 0, len(resp.Hits))
	for _, raw := range resp.Hits {
		hits = append(hits, convertHit(raw))
	}
	return hits, int(resp.ProcessingTimeMs), nil
}

// hydrateLyricSnippets 为当前页的代表歌曲补齐歌词正文与高亮片段
func (s *SearchService) hydrateLyricSnippets(
	index *meilisearch.Index,
	req SearchRequest,
	hits []SearchHitResult,
) {
	if len(hits) == 0 {
		return
	}
	filter := platformIDFilter(hits)
	if filter == "" {
		return
	}

	searchReq := buildMeiliSearchRequest(req)
	baseFilter, _ := searchReq.Filter.(string)
	if baseFilter != "" {
		searchReq.Filter = "(" + baseFilter + ") AND (" + filter + ")"
	} else {
		searchReq.Filter = filter
	}
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

// meiliPlatformFields 平台名 -> MeiliSearch 平台 ID 字段
var meiliPlatformFields = map[string]string{
	"ncm":     "platformIds_ncm",
	"qq":      "platformIds_qq",
	"spotify": "platformIds_spotify",
	"apple":   "platformIds_apple",
}

// platformIDFilter 用给定命中的全部「平台+平台ID」构造 OR 过滤表达式
func platformIDFilter(hits []SearchHitResult) string {
	clauses := make([]string, 0, len(hits))
	seen := make(map[string]struct{})
	for _, h := range hits {
		for platform, ids := range h.PlatformIds {
			field, ok := meiliPlatformFields[platform]
			if !ok {
				continue
			}
			for _, id := range ids {
				if id == "" {
					continue
				}
				key := field + "\x00" + id
				if _, ok := seen[key]; ok {
					continue
				}
				seen[key] = struct{}{}
				clauses = append(clauses, fmt.Sprintf(`%s = "%s"`, field, meiliEscape(id)))
			}
		}
	}
	if len(clauses) == 0 {
		return ""
	}
	return "(" + strings.Join(clauses, " OR ") + ")"
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

// groupHits 把「平台+平台ID」相交的命中合并为一组
func groupHits(hits []SearchHitResult) []SearchHitResult {
	if len(hits) <= 1 {
		return hits
	}

	// 并查集：记录每条命中所属的组
	parent := make([]int, len(hits))
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	union := func(a, b int) {
		ra, rb := find(a), find(b)
		if ra != rb {
			parent[rb] = ra
		}
	}

	// 第一次遍历：任意一个「平台+平台ID」相交即合并
	idOwner := make(map[string]int)
	nameOwner := make(map[string]int)
	for i, h := range hits {
		hasID := false
		for platform, ids := range h.PlatformIds {
			for _, id := range ids {
				if id == "" {
					continue
				}
				hasID = true
				key := platform + "\x00" + id
				if owner, ok := idOwner[key]; ok {
					union(i, owner)
				} else {
					idOwner[key] = i
				}
			}
		}
		if !hasID {
			key := hitNameKey(h)
			if owner, ok := nameOwner[key]; ok {
				union(i, owner)
			} else {
				nameOwner[key] = i
			}
		}
	}

	// 第二次遍历：按最终根节点分组，记录首次出现位置与最新版本
	type group struct {
		first int
		rep   int
	}
	groups := make(map[int]*group)
	for i := range hits {
		root := find(i)
		g, ok := groups[root]
		if !ok {
			groups[root] = &group{first: i, rep: i}
			continue
		}
		if commitTimestampNewer(hits[i], hits[g.rep]) {
			g.rep = i
		}
	}

	roots := make([]int, 0, len(groups))
	for root := range groups {
		roots = append(roots, root)
	}
	sort.Slice(roots, func(i, j int) bool {
		return groups[roots[i]].first < groups[roots[j]].first
	})

	out := make([]SearchHitResult, 0, len(roots))
	for _, root := range roots {
		out = append(out, hits[groups[root].rep])
	}
	return out
}

// hitNameKey 无平台 ID 时的兜底分组键：歌名 + 歌手
func hitNameKey(h SearchHitResult) string {
	name := ""
	if len(h.MusicNames) > 0 {
		name = strings.ToLower(strings.TrimSpace(h.MusicNames[0]))
	}
	if name == "" {
		return "file:" + h.RawLyricFile
	}
	return "name:" + name + "|" + strings.ToLower(strings.Join(h.Artists, "/"))
}

// commitTimestampNewer 判断 a 是否比 b 更新；nil 视为最旧，相等时保留先出现的
func commitTimestampNewer(a, b SearchHitResult) bool {
	if a.CommitTimestamp == nil {
		return false
	}
	if b.CommitTimestamp == nil {
		return true
	}
	return *a.CommitTimestamp > *b.CommitTimestamp
}

// countFields 需要统计命中数的字段（与前端搜索结果页的 Tab 一一对应）
var countFields = []string{"all", "song", "artist", "album", "lyric", "id", "author"}

// searchCountsCacheTTL 搜索 Tab 命中数缓存时间，与前端 counts 查询的 staleTime 对齐
const searchCountsCacheTTL = 60 * time.Second

// CountByFields 并发统计各字段的命中数，供搜索页 Tab 的数字徽章使用。
// 计数口径与搜索列表一致
// 每路只拉取分组必需的少量字段，并用 Redis 缓存同一关键词的结果
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
				hits, _, err := s.fetchAllHits(index, SearchRequest{Query: query, Field: field}, countFetchFields)
				mu.Lock()
				defer mu.Unlock()
				if err != nil {
					if firstErr == nil {
						firstErr = err
					}
					return
				}
				// 命中数按合并后的歌曲数统计，与搜索结果列表口径一致
				totals[field] = int64(len(groupHits(hits)))
			})
		}()
	}
	wg.Wait()

	if firstErr != nil {
		return nil, firstErr
	}

	if s.redis != nil {
		if data, err := json.Marshal(totals); err == nil {
			_ = s.redis.Set(ctx, cacheKey, data, searchCountsCacheTTL).Err()
		}
	}
	return totals, nil
}
