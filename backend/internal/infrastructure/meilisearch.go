package infrastructure

import (
	"fmt"

	"github.com/amll-dev/amll-hub/backend/internal/config"
	"github.com/meilisearch/meilisearch-go"
)

// NewMeiliSearch 初始化 MeiliSearch 客户端
func NewMeiliSearch(cfg config.MeiliSearchConfig) (*meilisearch.Client, error) {
	client := meilisearch.NewClient(meilisearch.ClientConfig{
		Host:   cfg.Host,
		APIKey: cfg.APIKey,
	})

	// 探活
	_, err := client.Health()
	if err != nil {
		return nil, fmt.Errorf("meilisearch health check: %w", err)
	}

	return client, nil
}

// EnsureMeiliSearchIndex 确保索引存在并按规范配置
// 注：Rust Worker 启动时也应调用类似配置；这里在 Go 启动时幂等设置
func EnsureMeiliSearchIndex(client *meilisearch.Client, indexName string) error {
	index := client.Index(indexName)

	// 创建/获取索引，主键 id
	_, err := client.GetIndex(indexName)
	if err != nil {
		_, err = client.CreateIndex(&meilisearch.IndexConfig{
			Uid:        indexName,
			PrimaryKey: "id",
		})
		if err != nil {
			return fmt.Errorf("create index: %w", err)
		}
	}

	searchable := []string{
		"musicNames", "musicNamesPinyin", "musicNamesInitials",
		"artists", "artistsPinyin", "artistsInitials",
		"albums", "albumsPinyin", "albumsInitials",
		"lyricText",
		"platformIds_ncm", "platformIds_qq", "platformIds_spotify", "platformIds_apple",
		"ttmlAuthorGithub",
		"ttmlAuthorGithubLogin",
	}
	filterable := []string{
		"platformIds_ncm", "platformIds_qq", "platformIds_spotify", "platformIds_apple",
		"artists", "albums", "ttmlAuthorGithub", "ttmlAuthorGithubLogin",
	}
	sortable := []string{
		"commitTimestamp",
	}
	// rankingRules：纯相关性排序，不含 sort
	// 同一歌曲多版本的时间排序在应用层处理（按歌曲名+平台ID分组后组内排序）
	rankingRules := []string{
		"words", "typo", "proximity", "attribute", "exactness",
	}

	if _, err := index.UpdateSearchableAttributes(&searchable); err != nil {
		return fmt.Errorf("update searchable attributes: %w", err)
	}
	if _, err := index.UpdateFilterableAttributes(&filterable); err != nil {
		return fmt.Errorf("update filterable attributes: %w", err)
	}
	if _, err := index.UpdateSortableAttributes(&sortable); err != nil {
		return fmt.Errorf("update sortable attributes: %w", err)
	}
	if _, err := index.UpdateRankingRules(&rankingRules); err != nil {
		return fmt.Errorf("update ranking rules: %w", err)
	}
	// 提高 pagination 上限（MeiliSearch 默认 maxTotalHits=1000）
	// all=true 时返回全部命中
	settings := meilisearch.Settings{
		Pagination: &meilisearch.Pagination{
			MaxTotalHits: 100000,
		},
	}
	if _, err := index.UpdateSettings(&settings); err != nil {
		return fmt.Errorf("update pagination settings: %w", err)
	}

	return nil
}
