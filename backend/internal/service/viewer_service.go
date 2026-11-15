package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"

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
	return s.NotifyRoom(ctx, ws.SubmissionRoom(submissionID))
}

// NotifyRoom 通知指定房间的观众列表更新
func (s *ViewerService) NotifyRoom(ctx context.Context, room string) error {
	if room == "" {
		return nil
	}
	var submissionID int64
	if strings.HasPrefix(room, "sub:") {
		submissionID, _ = strconv.ParseInt(strings.TrimPrefix(room, "sub:"), 10, 64)
	}
	viewers := s.hub.CollectViewers(room)
	return s.hub.PublishViewers(ctx, room, submissionID, viewers)
}

// IsSubmissionOwner 判断 username 是否为该投稿的投稿者。
//
// 用于 WS 握手：投稿者本人在自己的投稿详情页应该能看到谁在审，
// 但他看不到别人的投稿。查询失败一律按「不是本人」处理（走脱敏负载）。
func (s *ViewerService) IsSubmissionOwner(ctx context.Context, submissionID int64, username string) bool {
	if submissionID <= 0 || username == "" || s.subRepo == nil {
		return false
	}
	sub, err := s.subRepo.GetByID(ctx, submissionID)
	if err != nil {
		return false
	}
	return sub.Submitter == username
}

// NotifySubmissionChanged 投稿状态变更通知
//
// reviewer / reviewerInfo 只走 staffData，由 Hub 按连接角色分发：
// 任何持有 JWT 的用户都能连列表页，全量下发等于公开全站审核动态。
func (s *ViewerService) NotifySubmissionChanged(ctx context.Context, submissionID int64) error {
	if submissionID <= 0 {
		return nil
	}
	// 加载投稿当前状态
	sub, err := s.subRepo.GetByID(ctx, submissionID)
	if err != nil {
		return fmt.Errorf("load submission for notify: %w", err)
	}
	return s.hub.PublishChanged(ctx, submissionID,
		map[string]any{
			"id":        sub.ID,
			"status":    sub.Status,
			"title":     sub.Title,
			"submitter": sub.Submitter,
			"updatedAt": sub.UpdatedAt,
		},
		map[string]any{
			"reviewer":     sub.Reviewer,
			"reviewerInfo": sub.ReviewerInfo,
		},
	)
}
