package repository

import (
	"context"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
)

// PluginRatingRepo 插件评分数据访问层
type PluginRatingRepo struct {
	db *gorm.DB
}

func NewPluginRatingRepo(db *gorm.DB) *PluginRatingRepo { return &PluginRatingRepo{db: db} }

// PluginRatingSummaryRow 单插件评分聚合行
type PluginRatingSummaryRow struct {
	PluginKey string `gorm:"column:plugin_key"`
	Total     int64  `gorm:"column:total"`
	Sum       int64  `gorm:"column:sum"`
	Score1    int64  `gorm:"column:score_1"`
	Score2    int64  `gorm:"column:score_2"`
	Score3    int64  `gorm:"column:score_3"`
	Score4    int64  `gorm:"column:score_4"`
	Score5    int64  `gorm:"column:score_5"`
}

// Upsert 写入或更新用户评分
func (r *PluginRatingRepo) Upsert(ctx context.Context, pluginKey, username string, score int) error {
	return r.db.WithContext(ctx).Exec(`
		INSERT INTO plugin_ratings (plugin_key, username, score, created_at, updated_at)
		VALUES (?, ?, ?, NOW(), NOW())
		ON CONFLICT (plugin_key, username)
		DO UPDATE SET score = EXCLUDED.score, updated_at = NOW()
	`, pluginKey, username, score).Error
}

// GetUserScore 查询用户对插件的评分；未评分返回 0
func (r *PluginRatingRepo) GetUserScore(ctx context.Context, pluginKey, username string) (int, error) {
	if username == "" {
		return 0, nil
	}
	var score int
	err := r.db.WithContext(ctx).Model(&model.PluginRating{}).
		Where("plugin_key = ? AND username = ?", pluginKey, username).
		Pluck("score", &score).Error
	if err != nil {
		return 0, err
	}
	return score, nil
}

// Summaries 批量聚合评分（平均分、人数、1-5 星分布）
func (r *PluginRatingRepo) Summaries(ctx context.Context, pluginKeys []string) (map[string]PluginRatingSummaryRow, error) {
	out := make(map[string]PluginRatingSummaryRow, len(pluginKeys))
	if len(pluginKeys) == 0 {
		return out, nil
	}
	var rows []PluginRatingSummaryRow
	err := r.db.WithContext(ctx).Model(&model.PluginRating{}).
		Select(`plugin_key,
			COUNT(*) AS total,
			SUM(score) AS sum,
			COUNT(*) FILTER (WHERE score = 1) AS score_1,
			COUNT(*) FILTER (WHERE score = 2) AS score_2,
			COUNT(*) FILTER (WHERE score = 3) AS score_3,
			COUNT(*) FILTER (WHERE score = 4) AS score_4,
			COUNT(*) FILTER (WHERE score = 5) AS score_5`).
		Where("plugin_key IN ?", pluginKeys).
		Group("plugin_key").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[row.PluginKey] = row
	}
	return out, nil
}
