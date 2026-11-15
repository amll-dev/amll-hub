package repository

import (
	"context"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
)

// PetitionLinkRepo 投稿-请愿关联数据访问
type PetitionLinkRepo struct {
	db *gorm.DB
}

// NewPetitionLinkRepo 创建 PetitionLinkRepo
func NewPetitionLinkRepo(db *gorm.DB) *PetitionLinkRepo {
	return &PetitionLinkRepo{db: db}
}

// ExistingRequestIDs 返回该投稿已关联的请愿 ID 集合
func (r *PetitionLinkRepo) ExistingRequestIDs(
	ctx context.Context, submissionID int64,
) (map[int64]bool, error) {
	out := make(map[int64]bool)
	var ids []int64
	err := r.db.WithContext(ctx).
		Model(&model.PetitionLink{}).
		Where("submission_id = ?", submissionID).
		Pluck("request_id", &ids).Error
	if err != nil {
		return out, err
	}
	for _, id := range ids {
		out[id] = true
	}
	return out, nil
}

// BindMany 批量关联，返回本次新增的请愿 ID 与被忽略（超出单投稿上限）的数量。
// limit 是「单投稿最多关联数」的累计上限：调用方只截本次入参会被分批发绕过，
// 所以这里按已有行数算出剩余额度，超出部分直接丢弃并回传数量供上层提示。
func (r *PetitionLinkRepo) BindMany(
	ctx context.Context, submissionID int64, requestIDs []int64, actor string, limit int,
) ([]int64, int, error) {
	if len(requestIDs) == 0 {
		return nil, 0, nil
	}
	existing, err := r.ExistingRequestIDs(ctx, submissionID)
	if err != nil {
		return nil, 0, err
	}
	remaining := limit - len(existing)
	if remaining < 0 {
		remaining = 0
	}

	links := make([]model.PetitionLink, 0, len(requestIDs))
	inserted := make([]int64, 0, len(requestIDs))
	skipped := 0
	for _, id := range requestIDs {
		if existing[id] {
			continue
		}
		if len(links) >= remaining {
			skipped++
			continue
		}
		existing[id] = true
		inserted = append(inserted, id)
		links = append(links, model.PetitionLink{
			SubmissionID: submissionID,
			RequestID:    id,
			LinkedBy:     actor,
		})
	}
	if len(links) == 0 {
		return nil, skipped, nil
	}
	if err := r.db.WithContext(ctx).Create(&links).Error; err != nil {
		return nil, 0, err
	}
	return inserted, skipped, nil
}

// ListBySubmission 查询某投稿的全部关联
func (r *PetitionLinkRepo) ListBySubmission(
	ctx context.Context, submissionID int64,
) ([]model.PetitionLink, error) {
	var links []model.PetitionLink
	err := r.db.WithContext(ctx).
		Where("submission_id = ?", submissionID).
		Order("created_at ASC").
		Find(&links).Error
	return links, err
}

// Delete 解除一条关联
func (r *PetitionLinkRepo) Delete(
	ctx context.Context, submissionID, requestID int64,
) (bool, error) {
	res := r.db.WithContext(ctx).
		Where("submission_id = ? AND request_id = ?", submissionID, requestID).
		Delete(&model.PetitionLink{})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// MarkLinkNotified 标记关联邮件已发送
func (r *PetitionLinkRepo) MarkLinkNotified(
	ctx context.Context, submissionID int64, requestIDs []int64,
) error {
	if len(requestIDs) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).
		Model(&model.PetitionLink{}).
		Where("submission_id = ? AND request_id IN ?", submissionID, requestIDs).
		Update("link_notified", true).Error
}

// MarkCompleteNotified 标记完成邮件已发送
func (r *PetitionLinkRepo) MarkCompleteNotified(
	ctx context.Context, submissionID int64, requestIDs []int64,
) error {
	if len(requestIDs) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).
		Model(&model.PetitionLink{}).
		Where("submission_id = ? AND request_id IN ?", submissionID, requestIDs).
		Update("complete_notified", true).Error
}

// HasApprovedSubmission 该请愿是否还关联着其它已通过的投稿（解绑后判断是否需要回退状态）
func (r *PetitionLinkRepo) HasApprovedSubmission(
	ctx context.Context, requestID, excludeSubmissionID int64,
) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Table("submission_petition_links AS l").
		Joins("JOIN submissions AS s ON s.id = l.submission_id").
		Where("l.request_id = ? AND l.submission_id <> ? AND s.status = ?",
			requestID, excludeSubmissionID, "approved").
		Count(&count).Error
	return count > 0, err
}
