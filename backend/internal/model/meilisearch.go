package model

// MeiliSearch 索引文档结构（与 Rust Worker 写入保持一致）
type MeiliSongDocument struct {
	ID                    string   `json:"id"`
	MusicNames            []string `json:"musicNames"`
	MusicNamesPinyin      []string `json:"musicNamesPinyin"`
	Artists               []string `json:"artists"`
	ArtistsPinyin         []string `json:"artistsPinyin"`
	Albums                []string `json:"albums"`
	AlbumsPinyin          []string `json:"albumsPinyin"`
	LyricText             string   `json:"lyricText"`
	PlatformIdsNcm        []string `json:"platformIds_ncm,omitempty"`
	PlatformIdsQq         []string `json:"platformIds_qq,omitempty"`
	PlatformIdsSpotify    []string `json:"platformIds_spotify,omitempty"`
	PlatformIdsApple      []string `json:"platformIds_apple,omitempty"`
	RawLyricFile          string   `json:"rawLyricFile"`
	TtmlAuthorGithub      string   `json:"ttmlAuthorGithub,omitempty"`
	TtmlAuthorGithubLogin string   `json:"ttmlAuthorGithubLogin,omitempty"`
	WordCount             int      `json:"wordCount"`
	LineCount             int      `json:"lineCount"`
}

// SearchHit MeiliSearch 搜索响应中单条命中（仅 Go 端关心的字段）
type SearchHit struct {
	ID                 string         `json:"id"`
	MusicNames         []string       `json:"musicNames"`
	Artists            []string       `json:"artists"`
	Albums             []string       `json:"albums"`
	PlatformIdsNcm     []string       `json:"platformIds_ncm,omitempty"`
	PlatformIdsQq      []string       `json:"platformIds_qq,omitempty"`
	PlatformIdsSpotify []string       `json:"platformIds_spotify,omitempty"`
	PlatformIdsApple   []string       `json:"platformIds_apple,omitempty"`
	RawLyricFile       string         `json:"rawLyricFile"`
	WordCount          int            `json:"wordCount"`
	LineCount          int            `json:"lineCount"`
	Formatted          map[string]any `json:"_formatted,omitempty"`
}

// SearchResponse 搜索响应
type SearchResponse struct {
	Hits               []map[string]any `json:"hits"`
	EstimatedTotalHits int64            `json:"estimatedTotalHits"`
	Limit              int              `json:"limit"`
	Offset             int              `json:"offset"`
	ProcessingTimeMs   int              `json:"processingTimeMs"`
}
