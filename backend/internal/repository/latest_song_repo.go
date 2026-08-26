package repository

import (
	"context"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
)

// LatestSongRepo 最新收录歌曲数据访问
type LatestSongRepo struct {
	db *gorm.DB
}

func NewLatestSongRepo(db *gorm.DB) *LatestSongRepo {
	return &LatestSongRepo{db: db}
}

// ListAll 查询全部最新收录
func (r *LatestSongRepo) ListAll(ctx context.Context) ([]model.LatestSong, error) {
	var list []model.LatestSong
	err := r.db.WithContext(ctx).Order("sort_order ASC").Find(&list).Error
	return list, err
}
