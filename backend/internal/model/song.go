package model

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
)

// JSONStringArray 自定义类型，对应 PostgreSQL JSONB 数组
type JSONStringArray []string

func (a *JSONStringArray) Scan(value interface{}) error {
	if value == nil {
		*a = nil
		return nil
	}
	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return errors.New("failed to scan JSONStringArray")
	}
	return json.Unmarshal(bytes, a)
}

func (a JSONStringArray) Value() (driver.Value, error) {
	if a == nil {
		return "[]", nil
	}
	return json.Marshal(a)
}

func (a JSONStringArray) GormDataType() string {
	return "jsonb"
}

// Song 歌曲主表
type Song struct {
	ID                    int64           `gorm:"primaryKey;autoIncrement" json:"id"`
	MusicName             JSONStringArray `gorm:"type:jsonb;not null;default:'[]'" json:"musicName"`
	Album                 JSONStringArray `gorm:"type:jsonb;not null;default:'[]'" json:"album"`
	ISRC                  string          `gorm:"column:isrc;type:text" json:"isrc"`
	RawLyricFile          string          `gorm:"type:varchar(255);not null;uniqueIndex" json:"rawLyricFile"`
	MinioPath             string          `gorm:"type:varchar(500);not null" json:"minioPath"`
	LyricText             string          `gorm:"type:text" json:"lyricText"`
	TtmlAuthorGithub      string          `gorm:"column:ttml_author_github;type:varchar(50)" json:"ttmlAuthorGithub"`
	TtmlAuthorGithubLogin string          `gorm:"column:ttml_author_github_login;type:varchar(100)" json:"ttmlAuthorGithubLogin"`
	WordCount             int             `gorm:"default:0" json:"wordCount"`
	LineCount             int             `gorm:"default:0" json:"lineCount"`
	CommitTimestamp       *int64          `gorm:"column:commit_timestamp;type:bigint" json:"commitTimestamp,omitempty"`
	CommitTime            *time.Time      `gorm:"column:commit_time;type:timestamptz" json:"commitTime,omitempty"`
	IsDeleted             bool            `gorm:"not null;default:false" json:"isDeleted"`
	DeletedAt             gorm.DeletedAt  `gorm:"column:deleted_at" json:"deletedAt,omitempty"`
	CreatedAt             time.Time       `gorm:"not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
	UpdatedAt             time.Time       `gorm:"not null;default:CURRENT_TIMESTAMP" json:"updatedAt"`

	Artists         []Artist          `gorm:"many2many:song_artists;" json:"artists,omitempty"`
	PlatformMapping []PlatformMapping `gorm:"foreignKey:SongID" json:"platformMappings,omitempty"`
}

func (Song) TableName() string { return "songs" }

// Artist 艺术家表
type Artist struct {
	ID        int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	Name      string    `gorm:"type:varchar(255);not null;uniqueIndex" json:"name"`
	CreatedAt time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
}

func (Artist) TableName() string { return "artists" }

// PlatformMapping 平台 ID 映射表
type PlatformMapping struct {
	ID         int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	SongID     int64     `gorm:"not null;index:idx_pm_song_platform,priority:1" json:"songId"`
	Platform   string    `gorm:"type:varchar(50);not null;index:idx_pm_song_platform,priority:2;index:idx_pm_platform_id,priority:1" json:"platform"`
	PlatformID string    `gorm:"column:platform_id;type:varchar(100);not null;index:idx_pm_platform_id,priority:2" json:"platformId"`
	CreatedAt  time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
}

func (PlatformMapping) TableName() string { return "platform_mappings" }

// SyncState 同步状态键值表
type SyncState struct {
	Key   string `gorm:"primaryKey;type:varchar(50)" json:"key"`
	Value string `gorm:"type:text;not null" json:"value"`
}

func (SyncState) TableName() string { return "sync_state" }
