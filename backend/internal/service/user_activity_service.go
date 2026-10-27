package service

import (
	"context"
	"time"

	"gorm.io/gorm"
)

// 活动类型
const (
	ActivityLyric    = "lyric"     // 投稿歌词
	ActivityDaily    = "daily"     // 投稿每日推荐
	ActivitySearchIP = "search_ip" // 歌词IP显示投稿
	ActivityReview   = "review"    // 审核歌词
)

// UserActivityDay 单日活动明细
type UserActivityDay struct {
	Date   string         `json:"date"` // YYYY-MM-DD
	Count  int            `json:"count"`
	ByType map[string]int `json:"byType"`
}

// UserActivity 某一年的活动聚合
type UserActivity struct {
	Year   int               `json:"year"`
	Years  []int             `json:"years"` // 有记录的年份（供前端切换）
	Days   []UserActivityDay `json:"days"`
	Total  int               `json:"total"`
	ByType map[string]int    `json:"byType"`
}

// UserActivityService 个人活动统计
type UserActivityService struct {
	db *gorm.DB
}

// NewUserActivityService 创建服务
func NewUserActivityService(db *gorm.DB) *UserActivityService {
	return &UserActivityService{db: db}
}

// activityScope 活动统计的可见范围
type activityScope int

const (
	// activitySelf 本人视角：除草稿外的全部投稿 + 审核行为
	activitySelf activityScope = iota
	// activityPublic 访客视角：只统计已通过投稿，且不含审核行为
	activityPublic
)

// activitySourcesSelf 四类活动的统一查询：归属人字段 + 时间字段 + 表名
const activitySourcesSelf = `
	SELECT created_at AS day, 'lyric' AS type FROM submissions
		WHERE submitter = ? AND status <> 'draft'
	UNION ALL
	SELECT created_at, 'daily' FROM daily_recommendations WHERE submitter = ?
	UNION ALL
	SELECT created_at, 'search_ip' FROM search_ip_submissions WHERE submitter = ?
	UNION ALL
	SELECT reviewed_at, 'review' FROM submission_review_history WHERE reviewer = ?
`

// activitySourcesPublic 访客视角：三张投稿表且仅 approved（审核不属于公开贡献）
const activitySourcesPublic = `
	SELECT created_at AS day, 'lyric' AS type FROM submissions
		WHERE submitter = ? AND status = 'approved'
	UNION ALL
	SELECT created_at, 'daily' FROM daily_recommendations WHERE submitter = ? AND status = 'approved'
	UNION ALL
	SELECT created_at, 'search_ip' FROM search_ip_submissions WHERE submitter = ? AND status = 'approved'
`

// activitySources 按范围返回 UNION 查询体
func activitySources(scope activityScope) string {
	if scope == activityPublic {
		return activitySourcesPublic
	}
	return activitySourcesSelf
}

// activitySourcesArgs 返回 UNION 查询体对应的用户名占位参数
func activitySourcesArgs(scope activityScope, username string) []any {
	args := []any{username, username, username}
	if scope == activitySelf {
		args = append(args, username)
	}
	return args
}

// earliestActivitySQL 各表最早时间查询体（供前端切换年份）
func earliestActivitySQL(scope activityScope) string {
	if scope == activityPublic {
		return `
			SELECT MIN(t) FROM (
				SELECT MIN(created_at) AS t FROM submissions WHERE submitter = ? AND status = 'approved'
				UNION ALL SELECT MIN(created_at) FROM daily_recommendations WHERE submitter = ? AND status = 'approved'
				UNION ALL SELECT MIN(created_at) FROM search_ip_submissions WHERE submitter = ? AND status = 'approved'
			)`
	}
	return `
			SELECT MIN(t) FROM (
				SELECT MIN(created_at) AS t FROM submissions WHERE submitter = ?
				UNION ALL SELECT MIN(created_at) FROM daily_recommendations WHERE submitter = ?
				UNION ALL SELECT MIN(created_at) FROM search_ip_submissions WHERE submitter = ?
				UNION ALL SELECT MIN(reviewed_at) FROM submission_review_history WHERE reviewer = ?
			)`
}

// GetActivity 聚合用户在指定年份的活动，按天分组。
// year <= 0 表示当前年份。
func (s *UserActivityService) GetActivity(ctx context.Context, username string, year int) (*UserActivity, error) {
	return s.getActivity(ctx, username, year, activitySelf)
}

// GetPublicActivity 访客视角的活动统计：只统计已通过投稿，不含审核行为。
func (s *UserActivityService) GetPublicActivity(ctx context.Context, username string, year int) (*UserActivity, error) {
	return s.getActivity(ctx, username, year, activityPublic)
}

func (s *UserActivityService) getActivity(ctx context.Context, username string, year int, scope activityScope) (*UserActivity, error) {
	if year <= 0 {
		year = time.Now().Year()
	}
	start := time.Date(year, 1, 1, 0, 0, 0, 0, time.Local)
	end := start.AddDate(1, 0, 0)

	// 有记录的年份列表（供前端切换）：各表最早时间 → 当前年
	var earliest *time.Time
	if err := s.db.WithContext(ctx).
		Raw(earliestActivitySQL(scope), activitySourcesArgs(scope, username)...).
		Scan(&earliest).Error; err != nil {
		return nil, err
	}
	years := []int{}
	if earliest != nil {
		for y := earliest.Year(); y <= time.Now().Year(); y++ {
			years = append(years, y)
		}
	}

	// 按天 × 类型聚合
	type row struct {
		Day  time.Time `gorm:"column:day"`
		Type string    `gorm:"column:type"`
		Cnt  int       `gorm:"column:cnt"`
	}
	var rows []row
	args := append(activitySourcesArgs(scope, username), start, end)
	if err := s.db.WithContext(ctx).Raw(`
		SELECT day::date AS day, type, COUNT(*) AS cnt FROM (
			`+activitySources(scope)+`
		) t
		WHERE day >= ? AND day < ?
		GROUP BY 1, 2`,
		args...,
	).Scan(&rows).Error; err != nil {
		return nil, err
	}

	dayMap := make(map[string]*UserActivityDay)
	byType := make(map[string]int)
	total := 0
	for _, r := range rows {
		date := r.Day.Format("2006-01-02")
		d, ok := dayMap[date]
		if !ok {
			d = &UserActivityDay{Date: date, ByType: make(map[string]int)}
			dayMap[date] = d
		}
		d.Count += r.Cnt
		d.ByType[r.Type] += r.Cnt
		byType[r.Type] += r.Cnt
		total += r.Cnt
	}

	days := make([]UserActivityDay, 0, len(dayMap))
	for _, d := range dayMap {
		days = append(days, *d)
	}

	return &UserActivity{
		Year:   year,
		Years:  years,
		Days:   days,
		Total:  total,
		ByType: byType,
	}, nil
}
