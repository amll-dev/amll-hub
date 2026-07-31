package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"

	"github.com/amll-dev/amll-hub/backend/internal/config"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/meilisearch/meilisearch-go"
	logrus "github.com/sirupsen/logrus"
)

// SearchService 搜索服务
type SearchService struct {
	cfg    *config.Config
	client *meilisearch.Client
}

func NewSearchService(cfg *config.Config, client *meilisearch.Client) *SearchService {
	return &SearchService{cfg: cfg, client: client}
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

	// field=id：使用 filter 精确匹配
	if req.Field == "id" {
		return s.searchByExactID(ctx, index, req)
	}

	// field=all 时不传 AttributesToSearchOn，让 MeiliSearch 搜所有 searchableAttributes
	// 指定 field 时才限定搜索字段
	var searchOn []string
	if req.Field != "" && req.Field != "all" {
		searchOn = searchOnFields(req.Field)
	}
	req2 := meilisearch.SearchRequest{
		Query:                req.Query,
		ShowRankingScore:     false,
		AttributesToSearchOn: searchOn,
		AttributesToRetrieve: []string{"*"},
		Limit:                int64(req.Limit),
		Offset:               int64(req.Offset),
		// 歌词片段裁剪：返回匹配位置的上下文
		AttributesToCrop: []string{"lyricText"},
		CropLength:       60,
		CropMarker:       "...",
		// 高亮匹配词
		HighlightPreTag:  "<mark>",
		HighlightPostTag: "</mark>",
	}

	resp, err := index.Search(req2.Query, &req2)
	if err != nil {
		logrus.WithError(err).Warn("meilisearch search failed")
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	hits := make([]SearchHitResult, 0, len(resp.Hits))
	for _, raw := range resp.Hits {
		hits = append(hits, convertHit(raw))
	}

	// 应用层重排：同一歌曲（相同歌名+相同平台ID）的多版本按 commitTimestamp:desc 排在一起
	// 不同歌曲间保持 MeiliSearch 的相关性顺序
	hits = reorderHitsByGroup(hits)

	return &SearchResult{
		Hits:             hits,
		TotalHits:        resp.EstimatedTotalHits,
		Limit:            req.Limit,
		Offset:           req.Offset,
		ProcessingTimeMs: int(resp.ProcessingTimeMs),
	}, nil
}

// searchByExactID 使用 filter 精确匹配所有平台 ID 字段和投稿者 ID
func (s *SearchService) searchByExactID(ctx context.Context, index *meilisearch.Index, req SearchRequest) (*SearchResult, error) {
	escaped := meiliEscape(req.Query)
	filter := fmt.Sprintf(
		`platformIds_ncm = "%s" OR platformIds_qq = "%s" OR platformIds_spotify = "%s" OR platformIds_apple = "%s" OR ttmlAuthorGithub = "%s" OR ttmlAuthorGithubLogin = "%s"`,
		escaped, escaped, escaped, escaped, escaped, escaped,
	)
	req2 := meilisearch.SearchRequest{
		Query:                "",
		Filter:               filter,
		AttributesToRetrieve: []string{"*"},
		Limit:                int64(req.Limit),
		Offset:               int64(req.Offset),
	}

	resp, err := index.Search(req2.Query, &req2)
	if err != nil {
		logrus.WithError(err).Warn("meilisearch search by id failed")
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	hits := make([]SearchHitResult, 0, len(resp.Hits))
	for _, raw := range resp.Hits {
		hits = append(hits, convertHit(raw))
	}
	// 按 ID 搜索时，同一 ID 的多版本按 commitTimestamp:desc 排序
	hits = reorderHitsByGroup(hits)
	return &SearchResult{
		Hits:             hits,
		TotalHits:        resp.EstimatedTotalHits,
		Limit:            req.Limit,
		Offset:           req.Offset,
		ProcessingTimeMs: int(resp.ProcessingTimeMs),
	}, nil
}

// searchOnFields 根据字段返回 attributesToSearchOn 列表
func searchOnFields(field string) []string {
	switch field {
	case "song":
		return []string{"musicNames", "musicNamesPinyin"}
	case "artist":
		return []string{"artists", "artistsPinyin"}
	case "album":
		return []string{"albums", "albumsPinyin"}
	case "lyric":
		return []string{"lyricText"}
	case "author":
		return []string{"ttmlAuthorGithub", "ttmlAuthorGithubLogin"}
	case "", "all":
		return []string{
			"musicNames", "musicNamesPinyin",
			"artists", "artistsPinyin",
			"albums", "albumsPinyin",
			"lyricText",
			"platformIds_ncm", "platformIds_qq", "platformIds_spotify", "platformIds_apple",
		}
	}
	return []string{"*"}
}

// convertHit 把 map[string]interface{} 转换为 SearchHitResult
func convertHit(raw interface{}) SearchHitResult {
	m, ok := raw.(map[string]interface{})
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
	if v := toStringSlice(m["platformIds_ncm"]); len(v) > 0 {
		hit.PlatformIds["ncm"] = v
	}
	if v := toStringSlice(m["platformIds_qq"]); len(v) > 0 {
		hit.PlatformIds["qq"] = v
	}
	if v := toStringSlice(m["platformIds_spotify"]); len(v) > 0 {
		hit.PlatformIds["spotify"] = v
	}
	if v := toStringSlice(m["platformIds_apple"]); len(v) > 0 {
		hit.PlatformIds["apple"] = v
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
	// 提取歌词片段（来自 _formatted.lyricText）
	if formatted, ok := m["_formatted"].(map[string]interface{}); ok {
		if v, ok := formatted["lyricText"].(string); ok && v != "" {
			hit.LyricSnippet = v
		}
	}
	return hit
}

func toStringSlice(v interface{}) []string {
	if v == nil {
		return nil
	}
	arr, ok := v.([]interface{})
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, e := range arr {
		if s, ok := e.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func toFloat(v interface{}) (float64, bool) {
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

// hitGroupKey 返回搜索命中的分组 key：歌名 + 平台ID
// 同一 key 的命中视为同一歌曲的不同版本
func hitGroupKey(h SearchHitResult) string {
	songName := ""
	if len(h.MusicNames) > 0 {
		songName = h.MusicNames[0]
	}
	platformId := ""
	for _, k := range []string{"ncm", "qq", "spotify", "apple"} {
		if ids, ok := h.PlatformIds[k]; ok && len(ids) > 0 && ids[0] != "" {
			platformId = k + ":" + ids[0]
			break
		}
	}
	return songName + "|" + platformId
}

// reorderHitsByGroup 对搜索结果做应用层重排
func reorderHitsByGroup(hits []SearchHitResult) []SearchHitResult {
	if len(hits) <= 1 {
		return hits
	}

	type group struct {
		firstIndex int
		items      []SearchHitResult
	}
	groups := make(map[string]*group)
	order := make([]string, 0, len(hits))

	for i, h := range hits {
		key := hitGroupKey(h)
		if g, ok := groups[key]; ok {
			g.items = append(g.items, h)
		} else {
			groups[key] = &group{firstIndex: i, items: []SearchHitResult{h}}
			order = append(order, key)
		}
	}

	// 每组内按 commitTimestamp:desc（null 排最后）
	for _, g := range groups {
		sort.SliceStable(g.items, func(i, j int) bool {
			ci, cj := int64(0), int64(0)
			if g.items[i].CommitTimestamp != nil {
				ci = *g.items[i].CommitTimestamp
			}
			if g.items[j].CommitTimestamp != nil {
				cj = *g.items[j].CommitTimestamp
			}
			return ci > cj
		})
	}

	// 组间按首次出现位置排序（保持 MeiliSearch 相关性顺序）
	sort.SliceStable(order, func(i, j int) bool {
		return groups[order[i]].firstIndex < groups[order[j]].firstIndex
	})

	result := make([]SearchHitResult, 0, len(hits))
	for _, key := range order {
		result = append(result, groups[key].items...)
	}
	return result
}

// _ 防 errors unused
var _ = errors.New
var _ = pkg.IsValidPlatform
