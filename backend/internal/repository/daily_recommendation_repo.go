package repository

import (
	"context"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
)

// DailyRecommendationRepo 每日推荐数据访问
type DailyRecommendationRepo struct {
	db *gorm.DB
}

// NewDailyRecommendationRepo 创建 DailyRecommendationRepo
func NewDailyRecommendationRepo(db *gorm.DB) *DailyRecommendationRepo {
	return &DailyRecommendationRepo{db: db}
}

// Create 创建每日推荐
func (r *DailyRecommendationRepo) Create(ctx context.Context, rec *model.DailyRecommendation) error {
	return r.db.WithContext(ctx).Create(rec).Error
}

// ListApproved 查询所有已通过的推荐（按日期倒序）
func (r *DailyRecommendationRepo) ListApproved(ctx context.Context) ([]model.DailyRecommendation, error) {
	var recs []model.DailyRecommendation
	err := r.db.WithContext(ctx).Where("status = ?", "approved").Order("date DESC").Find(&recs).Error
	return recs, err
}

// GetByDate 按日期查询单条推荐
func (r *DailyRecommendationRepo) GetByDate(ctx context.Context, date string) (*model.DailyRecommendation, error) {
	var rec model.DailyRecommendation
	err := r.db.WithContext(ctx).Where("date = ? AND status = ?", date, "approved").First(&rec).Error
	return &rec, err
}

// GetToday 查询今天的推荐
func (r *DailyRecommendationRepo) GetToday(ctx context.Context) (*model.DailyRecommendation, error) {
	today := time.Now().Format("2006-01-02")
	return r.GetByDate(ctx, today)
}

// GetLatestApproved 查询已批准的最新一期（date <= today，按日期倒序取首条）
func (r *DailyRecommendationRepo) GetLatestApproved(ctx context.Context) (*model.DailyRecommendation, error) {
	today := time.Now().Format("2006-01-02")
	var rec model.DailyRecommendation
	err := r.db.WithContext(ctx).Where("status = ? AND date <= ?", "approved", today).
		Order("date DESC").First(&rec).Error
	return &rec, err
}

// CheckDate 检查日期是否已被占用（返回 true 表示已存在）
func (r *DailyRecommendationRepo) CheckDate(ctx context.Context, date string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.DailyRecommendation{}).
		Where("date = ? AND status = ?", date, "approved").
		Count(&count).Error
	return count > 0, err
}

// ListBySubmitter 按提交人查询列表
func (r *DailyRecommendationRepo) ListBySubmitter(ctx context.Context, submitter string) ([]model.DailyRecommendation, error) {
	var recs []model.DailyRecommendation
	err := r.db.WithContext(ctx).Where("submitter = ?", submitter).Order("created_at DESC").Find(&recs).Error
	return recs, err
}

// GetByID 按 ID 查询详情
func (r *DailyRecommendationRepo) GetByID(ctx context.Context, id int64) (*model.DailyRecommendation, error) {
	var rec model.DailyRecommendation
	err := r.db.WithContext(ctx).First(&rec, id).Error
	return &rec, err
}

// GetLikeStatus 查询用户是否已点赞
func (r *DailyRecommendationRepo) GetLikeStatus(ctx context.Context, recID int64, username string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.DailyRecommendationLike{}).
		Where("recommendation_id = ? AND username = ?", recID, username).
		Count(&count).Error
	return count > 0, err
}

// ToggleLike 切换点赞：已赞则取消、未赞则添加，返回切换后的状态。
func (r *DailyRecommendationRepo) ToggleLike(ctx context.Context, recID int64, username string) (bool, int, error) {
	var liked bool
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 确认推荐存在
		var rec model.DailyRecommendation
		if err := tx.First(&rec, recID).Error; err != nil {
			return err
		}

		var count int64
		if err := tx.Model(&model.DailyRecommendationLike{}).
			Where("recommendation_id = ? AND username = ?", recID, username).
			Count(&count).Error; err != nil {
			return err
		}

		if count > 0 {
			// 已赞 → 取消
			if err := tx.Where("recommendation_id = ? AND username = ?", recID, username).
				Delete(&model.DailyRecommendationLike{}).Error; err != nil {
				return err
			}
			liked = false
		} else {
			// 未赞 → 添加
			if err := tx.Create(&model.DailyRecommendationLike{
				RecommendationID: recID,
				Username:         username,
			}).Error; err != nil {
				return err
			}
			liked = true
		}

		// 按点赞表实际数量回写 like_count
		var total int64
		if err := tx.Model(&model.DailyRecommendationLike{}).
			Where("recommendation_id = ?", recID).
			Count(&total).Error; err != nil {
			return err
		}
		return tx.Model(&model.DailyRecommendation{}).
			Where("id = ?", recID).
			Update("like_count", int(total)).Error
	})
	if err != nil {
		return false, 0, err
	}

	var rec model.DailyRecommendation
	if err := r.db.WithContext(ctx).Select("like_count").First(&rec, recID).Error; err != nil {
		return liked, 0, err
	}
	return liked, rec.LikeCount, nil
}
