package repository

import (
	"context"
	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
)

type ReviewerRecruitmentRepo struct{ DB *gorm.DB }

func NewReviewerRecruitmentRepo(db *gorm.DB) *ReviewerRecruitmentRepo {
	return &ReviewerRecruitmentRepo{DB: db}
}

// Lock serializes enrolment, voting, withdrawal and closure across server instances.
// Call before taking submission row locks to keep lock ordering consistent.
func (r *ReviewerRecruitmentRepo) Lock(tx *gorm.DB) error {
	return tx.Exec("SELECT pg_advisory_xact_lock(731906240)").Error
}
func (r *ReviewerRecruitmentRepo) Transaction(ctx context.Context, fn func(*gorm.DB) error) error {
	return r.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := r.Lock(tx); err != nil {
			return err
		}
		return fn(tx)
	})
}
func (r *ReviewerRecruitmentRepo) Active(tx *gorm.DB) (*model.ReviewerRecruitment, error) {
	var plan model.ReviewerRecruitment
	if err := tx.Where("status = ?", "active").First(&plan).Error; err != nil {
		return nil, err
	}
	return &plan, nil
}
