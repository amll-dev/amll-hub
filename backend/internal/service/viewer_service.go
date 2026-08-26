package service

import (
	"context"
	"fmt"

	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/amll-dev/amll-hub/backend/internal/ws"
)

// ViewerService 观众列表与状态变更广播服务
type ViewerService struct {
	hub     *ws.Hub
	subRepo *repository.SubmissionRepo
}

// NewViewerService 创建 viewer 服务
func NewViewerService(hub *ws.Hub, subRepo *repository.SubmissionRepo) *ViewerService {
	return &ViewerService{hub: hub, subRepo: subRepo}
}

// SetHub 注入 Hub
func (s *ViewerService) SetHub(hub *ws.Hub) {
	s.hub = hub
}

// NotifyViewers 通知指定投稿的观众列表更新
func (s *ViewerService) NotifyViewers(ctx context.Context, submissionID int64) error {
	if submissionID <= 0 {
		return nil
	}
	viewers := s.hub.CollectViewers(submissionID)
	return s.hub.PublishViewers(ctx, submissionID, viewers)
}

// NotifySubmissionChanged 投稿状态变更通知
func (s *ViewerService) NotifySubmissionChanged(ctx context.Context, submissionID int64) error {
	if submissionID <= 0 {
		return nil
	}
	// 加载投稿当前状态
	sub, err := s.subRepo.GetByID(ctx, submissionID)
	if err != nil {
		return fmt.Errorf("load submission for notify: %w", err)
	}
	return s.hub.PublishChanged(ctx, submissionID, map[string]any{
		"id":        sub.ID,
		"status":    sub.Status,
		"title":     sub.Title,
		"submitter": sub.Submitter,
		"reviewer":  sub.Reviewer,
		"updatedAt": sub.UpdatedAt,
	})
}
