package model

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"time"
)

// DailyRequests 按日统计的 IP 列表
// JSONB 字段：{"2026-07-01": ["1.2.3.4", "5.6.7.8"]}
type DailyRequests map[string][]string

func (d *DailyRequests) Scan(value any) error {
	if value == nil {
		*d = nil
		return nil
	}
	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return errors.New("failed to scan DailyRequests")
	}
	return json.Unmarshal(bytes, d)
}

func (d DailyRequests) Value() (driver.Value, error) {
	if d == nil {
		return "{}", nil
	}
	return json.Marshal(d)
}

func (d DailyRequests) GormDataType() string {
	return "jsonb"
}

// NotFoundRequest 无歌词记录
type NotFoundRequest struct {
	ID             int64         `gorm:"primaryKey;autoIncrement" json:"id"`
	Platform       string        `gorm:"type:varchar(20);not null;uniqueIndex:idx_nf_platform_id,priority:1" json:"platform"`
	PlatformID     string        `gorm:"column:platform_id;type:varchar(100);not null;uniqueIndex:idx_nf_platform_id,priority:2" json:"platformId"`
	SongName       string        `gorm:"type:varchar(255)" json:"songName"`
	Artists        string        `gorm:"type:varchar(500)" json:"artists"` // 歌手名
	Cover          string        `gorm:"type:varchar(500)" json:"cover"`   // 封面 URL
	Album          string        `gorm:"type:varchar(255)" json:"album"`   // 专辑名
	RequestCount   int           `gorm:"not null;default:1" json:"requestCount"`
	FirstSeenAt    time.Time     `gorm:"not null;default:CURRENT_TIMESTAMP" json:"firstSeenAt"`
	LastSeenAt     time.Time     `gorm:"not null;default:CURRENT_TIMESTAMP" json:"lastSeenAt"`
	DailyRequests  DailyRequests `gorm:"type:jsonb;not null;default:'{}'::jsonb" json:"dailyRequests"`
	FirstRequestIP string        `gorm:"type:varchar(50)" json:"firstRequestIp"`
	Category       string        `gorm:"type:varchar(20);not null;default:'unknown'" json:"category"`
	CreatedAt      time.Time     `gorm:"not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
	UpdatedAt      time.Time     `gorm:"not null;default:CURRENT_TIMESTAMP" json:"updatedAt"`
}

func (NotFoundRequest) TableName() string { return "not_found_requests" }

// 分类常量
const (
	CategoryNotFound   = "not_found"
	CategoryPureMusic  = "pure_music"
	CategoryCloudMusic = "cloud_music"
	CategoryAPIFailed  = "api_failed"
	CategoryUnknown    = "unknown"
)

// PureMusicWhitelist 纯音乐白名单（永久保留）
type PureMusicWhitelist struct {
	ID         int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	Platform   string    `gorm:"type:varchar(20);not null;uniqueIndex:idx_pmw_platform_id,priority:1" json:"platform"`
	PlatformID string    `gorm:"column:platform_id;type:varchar(100);not null;uniqueIndex:idx_pmw_platform_id,priority:2" json:"platformId"`
	SongName   string    `gorm:"type:varchar(255)" json:"songName"`
	Reason     string    `gorm:"type:varchar(255)" json:"reason"`
	DetectedAt time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"detectedAt"`
	DetectedBy string    `gorm:"type:varchar(50)" json:"detectedBy"`
	CreatedAt  time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
}

func (PureMusicWhitelist) TableName() string { return "pure_music_whitelist" }

// CloudMusicWhitelist 云盘音乐白名单（永久保留）
type CloudMusicWhitelist struct {
	ID         int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	Platform   string    `gorm:"type:varchar(20);not null;uniqueIndex:idx_cmw_platform_id,priority:1" json:"platform"`
	PlatformID string    `gorm:"column:platform_id;type:varchar(100);not null;uniqueIndex:idx_cmw_platform_id,priority:2" json:"platformId"`
	SongName   string    `gorm:"type:varchar(255)" json:"songName"`
	Reason     string    `gorm:"type:varchar(255)" json:"reason"`
	DetectedAt time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"detectedAt"`
	DetectedBy string    `gorm:"type:varchar(50)" json:"detectedBy"`
	CreatedAt  time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
}

func (CloudMusicWhitelist) TableName() string { return "cloud_music_whitelist" }
