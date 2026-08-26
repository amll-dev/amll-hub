package model

import "time"

// LatestSong 最新收录歌曲快照
type LatestSong struct {
	ID            int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	SyncHistoryID int64     `gorm:"column:sync_history_id;not null;index" json:"syncHistoryId"`
	SongID        int64     `gorm:"column:song_id;not null" json:"songId"`
	NcmID         string    `gorm:"column:ncm_id;type:varchar(100)" json:"ncmId"`
	Title         string    `gorm:"type:varchar(500);not null;default:''" json:"title"`
	Artist        string    `gorm:"type:varchar(500);not null;default:''" json:"artist"`
	CoverURL      string    `gorm:"column:cover_url;type:varchar(1000);not null;default:''" json:"coverUrl"`
	SortOrder     int       `gorm:"column:sort_order;not null;default:0" json:"sortOrder"`
	CreatedAt     time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
}

func (LatestSong) TableName() string { return "latest_songs" }
