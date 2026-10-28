package model

import "time"

// 性别取值（user_profiles.gender，与迁移里的 CHECK 约束一致）
const (
	GenderMale    = "male"
	GenderFemale  = "female"
	GenderOther   = "other"
	GenderUnknown = "unknown"
)

// UserProfile 用户公开主页的本地扩展资料。
//
// 用户身份主键是 Casdoor 的 username（JWT claims.name），这里不做外键，
// 只存 Casdoor 里没有的展示字段：签名 / 背景图 / 地区 / 生日 / 性别。
type UserProfile struct {
	Username  string     `gorm:"column:username;primaryKey;type:varchar(100)" json:"username"`
	Bio       string     `gorm:"column:bio;type:varchar(200);not null;default:''" json:"bio"`
	BannerKey string     `gorm:"column:banner_key;type:varchar(500);not null;default:''" json:"bannerKey"`
	Birthday  *time.Time `gorm:"column:birthday;type:date" json:"birthday"`
	Gender    string     `gorm:"column:gender;type:varchar(16);not null;default:'unknown'" json:"gender"`
	CreatedAt time.Time  `gorm:"column:created_at" json:"createdAt"`
	UpdatedAt time.Time  `gorm:"column:updated_at" json:"updatedAt"`
}

// TableName 表名
func (UserProfile) TableName() string { return "user_profiles" }
