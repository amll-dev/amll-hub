package model

import (
	"database/sql/driver"
	"time"
)

// DateOnly 自定义日期类型，JSON 序列化为 YYYY-MM-DD 格式
type DateOnly time.Time

// MarshalJSON 输出 YYYY-MM-DD 格式
func (d DateOnly) MarshalJSON() ([]byte, error) {
	t := time.Time(d)
	if t.IsZero() {
		return []byte(`""`), nil
	}
	return []byte(`"` + t.Format("2006-01-02") + `"`), nil
}

// UnmarshalJSON 解析 YYYY-MM-DD 格式
func (d *DateOnly) UnmarshalJSON(data []byte) error {
	s := string(data)
	if len(s) < 2 || s[0] != '"' || s[len(s)-1] != '"' {
		return nil
	}
	t, err := time.Parse(`"2006-01-02"`, s)
	if err != nil {
		return err
	}
	*d = DateOnly(t)
	return nil
}

// Value 实现 driver.Valuer，返回 time.Time 让 pgx 能正确编码 date 列
func (d DateOnly) Value() (driver.Value, error) {
	return time.Time(d), nil
}

// Scan 实现 sql.Scanner，从数据库读取 date 值
func (d *DateOnly) Scan(value any) error {
	if value == nil {
		*d = DateOnly(time.Time{})
		return nil
	}
	switch v := value.(type) {
	case time.Time:
		*d = DateOnly(v)
		return nil
	case string:
		t, err := time.Parse("2006-01-02", v)
		if err != nil {
			return err
		}
		*d = DateOnly(t)
		return nil
	}
	return nil
}

// DailyRecommendation 每日推荐
type DailyRecommendation struct {
	ID            int64      `gorm:"primaryKey;autoIncrement" json:"id"`
	Date          DateOnly   `gorm:"type:date;not null;uniqueIndex" json:"date"`
	SongName      string     `gorm:"column:song_name;type:varchar(200);not null;default:''" json:"songName"`
	Artist        string     `gorm:"type:varchar(200);not null;default:''" json:"artist"`
	CoverKey      string     `gorm:"column:cover_key;type:varchar(500);not null;default:''" json:"coverKey"`
	NcmID         string     `gorm:"column:ncm_id;type:varchar(50);not null;default:''" json:"ncmId"`
	Comment       string     `gorm:"type:text;not null;default:''" json:"comment"`
	Submitter     string     `gorm:"type:varchar(100);not null" json:"submitter"`
	SubmitterInfo JSONObject `gorm:"type:jsonb;default:'{}'" json:"submitterInfo"`
	Status        string     `gorm:"type:varchar(20);default:'approved'" json:"status"`
	LikeCount     int        `gorm:"column:like_count;type:int;not null;default:0" json:"likeCount"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

func (DailyRecommendation) TableName() string { return "daily_recommendations" }

// DailyRecommendationLike 每日推荐点赞记录
type DailyRecommendationLike struct {
	ID               int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	RecommendationID int64     `gorm:"column:recommendation_id;not null;uniqueIndex:uq_daily_rec_like" json:"recommendationId"`
	Username         string    `gorm:"type:varchar(100);not null;uniqueIndex:uq_daily_rec_like" json:"username"`
	CreatedAt        time.Time `json:"createdAt"`
}

func (DailyRecommendationLike) TableName() string { return "daily_recommendation_likes" }
