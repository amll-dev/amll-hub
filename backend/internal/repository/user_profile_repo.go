package repository

import (
	"context"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// UserProfileRepo 用户主页扩展资料数据访问层
type UserProfileRepo struct {
	db *gorm.DB
}

func NewUserProfileRepo(db *gorm.DB) *UserProfileRepo {
	return &UserProfileRepo{db: db}
}

// Get 查询用户主页资料，不存在时返回 gorm.ErrRecordNotFound
func (r *UserProfileRepo) Get(ctx context.Context, username string) (*model.UserProfile, error) {
	var p model.UserProfile
	if err := r.db.WithContext(ctx).First(&p, "username = ?", username).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

// Upsert 写入展示字段。刻意不碰 banner_key——背景图只能走上传接口，
// 避免普通表单保存时把已上传的图覆盖成空串。
func (r *UserProfileRepo) Upsert(ctx context.Context, p *model.UserProfile) error {
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "username"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"bio", "birthday", "gender",
		}),
	}).Create(p).Error
}

// ListByUsernames 批量查询主页资料，返回 username → profile 的映射
func (r *UserProfileRepo) ListByUsernames(ctx context.Context, usernames []string) (map[string]*model.UserProfile, error) {
	out := make(map[string]*model.UserProfile, len(usernames))
	if len(usernames) == 0 {
		return out, nil
	}
	var rows []model.UserProfile
	if err := r.db.WithContext(ctx).
		Where("username IN ?", usernames).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		out[rows[i].Username] = &rows[i]
	}
	return out, nil
}

// UpdateBanner 单独更新背景图 key。
//
// 用原生 upsert 而非 GORM Create：新建行时只提供 username+banner_key，
// 其余字段交给表默认值，避免零值把 gender 写成空串（违反 CHECK 约束）。
func (r *UserProfileRepo) UpdateBanner(ctx context.Context, username, bannerKey string) error {
	return r.db.WithContext(ctx).Exec(`
		INSERT INTO user_profiles (username, banner_key) VALUES (?, ?)
		ON CONFLICT (username) DO UPDATE SET banner_key = EXCLUDED.banner_key
	`, username, bannerKey).Error
}
