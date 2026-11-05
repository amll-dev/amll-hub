package model

import "time"

// 歌词请愿状态
const (
	LyricRequestPending   = "pending"   // 待处理
	LyricRequestCompleted = "completed" // 已完成
)

// LyricRequest 歌词请愿
type LyricRequest struct {
	ID            int64      `gorm:"primaryKey;autoIncrement" json:"id"`
	SongName      string     `gorm:"column:song_name;type:varchar(255);not null" json:"songName"`
	Artist        string     `gorm:"type:varchar(255);not null" json:"artist"`
	Album         string     `gorm:"type:varchar(255);not null;default:''" json:"album"`
	NcmID         string     `gorm:"column:ncm_id;type:varchar(50);not null;default:'0'" json:"ncmId"`
	QQID          string     `gorm:"column:qq_id;type:varchar(50);not null;default:'0'" json:"qqId"`
	SpotifyID     string     `gorm:"column:spotify_id;type:varchar(100);not null;default:'0'" json:"spotifyId"`
	AppleMusicID  string     `gorm:"column:apple_music_id;type:varchar(100);not null;default:'0'" json:"appleMusicId"`
	HasAppleTTML  bool       `gorm:"column:has_apple_ttml;not null;default:false" json:"hasAppleTtml"`
	ExtraInfo     string     `gorm:"column:extra_info;type:text;not null;default:''" json:"extraInfo"`
	Note          string     `gorm:"type:text;not null;default:''" json:"note"`
	Status        string     `gorm:"type:varchar(20);not null;default:'pending'" json:"status"`
	RequesterName string     `gorm:"column:requester_name;type:varchar(100);not null" json:"requesterName"`
	RequesterInfo JSONObject `gorm:"column:requester_info;type:jsonb;not null;default:'{}'::jsonb" json:"requesterInfo"`
	SupportCount  int        `gorm:"column:support_count;not null;default:0" json:"supportCount"`
	RequestCount  int        `gorm:"column:request_count;not null;default:1" json:"requestCount"`
	CompletedAt   *time.Time `gorm:"column:completed_at" json:"completedAt"`
	CreatedAt     time.Time  `gorm:"not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
	UpdatedAt     time.Time  `gorm:"not null;default:CURRENT_TIMESTAMP" json:"updatedAt"`
}

func (LyricRequest) TableName() string { return "lyric_requests" }

// LyricRequestSupport 请愿支持记录
type LyricRequestSupport struct {
	ID        int64      `gorm:"primaryKey;autoIncrement" json:"id"`
	RequestID int64      `gorm:"column:request_id;not null;uniqueIndex:idx_lr_support_unique,priority:1" json:"requestId"`
	UserName  string     `gorm:"column:user_name;type:varchar(100);not null;uniqueIndex:idx_lr_support_unique,priority:2" json:"userName"`
	UserInfo  JSONObject `gorm:"column:user_info;type:jsonb;not null;default:'{}'::jsonb" json:"userInfo"`
	CreatedAt time.Time  `gorm:"not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
}

func (LyricRequestSupport) TableName() string { return "lyric_request_supports" }

// LyricRequestComment 请愿评论
type LyricRequestComment struct {
	ID        int64      `gorm:"primaryKey;autoIncrement" json:"id"`
	RequestID int64      `gorm:"column:request_id;not null" json:"requestId"`
	UserName  string     `gorm:"column:user_name;type:varchar(100);not null" json:"userName"`
	UserInfo  JSONObject `gorm:"column:user_info;type:jsonb;not null;default:'{}'::jsonb" json:"userInfo"`
	Content   string     `gorm:"type:text;not null" json:"content"`
	CreatedAt time.Time  `gorm:"not null;default:CURRENT_TIMESTAMP" json:"createdAt"`
}

func (LyricRequestComment) TableName() string { return "lyric_request_comments" }
