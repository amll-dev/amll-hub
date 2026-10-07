package repository

import (
	"context"
	"errors"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
)

// GithubBindingRepo GitHub 绑定表数据访问
type GithubBindingRepo struct {
	db *gorm.DB
}

// NewGithubBindingRepo 创建 GithubBindingRepo
func NewGithubBindingRepo(db *gorm.DB) *GithubBindingRepo {
	return &GithubBindingRepo{db: db}
}

// GetByUsername 按站点用户名查询绑定，未找到返回 (nil, nil)
func (r *GithubBindingRepo) GetByUsername(ctx context.Context, username string) (*model.UserGithubBinding, error) {
	var b model.UserGithubBinding
	err := r.db.WithContext(ctx).Where("username = ?", username).First(&b).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// GetByGithubID 按 GitHub 数字 ID 查询绑定，未找到返回 (nil, nil)
func (r *GithubBindingRepo) GetByGithubID(ctx context.Context, githubID int64) (*model.UserGithubBinding, error) {
	var b model.UserGithubBinding
	err := r.db.WithContext(ctx).Where("github_id = ?", githubID).First(&b).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// Create 写入绑定记录
func (r *GithubBindingRepo) Create(ctx context.Context, b *model.UserGithubBinding) error {
	return r.db.WithContext(ctx).Create(b).Error
}

// DeleteByUsername 解绑
func (r *GithubBindingRepo) DeleteByUsername(ctx context.Context, username string) error {
	return r.db.WithContext(ctx).
		Where("username = ?", username).
		Delete(&model.UserGithubBinding{}).Error
}
