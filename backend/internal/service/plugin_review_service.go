package service

import (
	"context"
	"errors"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/amll-dev/amll-hub/backend/internal/ws"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"
)

// 审核动作
const (
	PluginActionApprove = "approve"
	PluginActionReject  = "reject"
)

var (
	ErrPluginReviewForbidden = errors.New("reviewer cannot review their own plugin")
	ErrPluginReviewInvalid   = errors.New("invalid plugin review action")
)

// PluginReviewService 插件审核流程
type PluginReviewService struct {
	db       *gorm.DB
	plugins  *repository.PluginRepo
	versions *repository.PluginVersionRepo
	reviews  *repository.PluginReviewRepo
	catalog  *PluginCatalogService
	notifier PluginNotifier
	hub      *ws.Hub
}

func NewPluginReviewService(
	db *gorm.DB,
	plugins *repository.PluginRepo,
	versions *repository.PluginVersionRepo,
	reviews *repository.PluginReviewRepo,
	catalog *PluginCatalogService,
) *PluginReviewService {
	return &PluginReviewService{
		db:       db,
		plugins:  plugins,
		versions: versions,
		reviews:  reviews,
		catalog:  catalog,
	}
}

func (s *PluginReviewService) SetNotifier(n PluginNotifier) { s.notifier = n }

// SetHub 注入 WebSocket hub，用于插件审核状态的实时推送
func (s *PluginReviewService) SetHub(hub *ws.Hub) { s.hub = hub }

// PluginReviewQueueItem 审核队列项
type PluginReviewQueueItem struct {
	Version       model.PluginVersion `json:"version"`
	PluginKey     string              `json:"pluginKey"`
	PluginName    string              `json:"pluginName"`
	PluginSummary string              `json:"pluginSummary"`
}

// PluginReviewDetail 审核详情
type PluginReviewDetail struct {
	Plugin  model.Plugin                `json:"plugin"`
	Version model.PluginVersion         `json:"version"`
	History []model.PluginReviewHistory `json:"history"`
}

// Queue 待审核队列
func (s *PluginReviewService) Queue(ctx context.Context, q repository.PluginReviewQueueQuery) ([]PluginReviewQueueItem, int64, error) {
	items, total, err := s.versions.ListReviewQueue(ctx, q)
	if err != nil {
		return nil, 0, err
	}
	pluginIDs := make([]int64, 0, len(items))
	for i := range items {
		pluginIDs = append(pluginIDs, items[i].PluginID)
	}
	plugins, err := s.plugins.GetByIDs(ctx, pluginIDs)
	if err != nil {
		return nil, 0, err
	}
	byID := make(map[int64]model.Plugin, len(plugins))
	for _, p := range plugins {
		byID[p.ID] = p
	}
	out := make([]PluginReviewQueueItem, 0, len(items))
	for i := range items {
		p := byID[items[i].PluginID]
		out = append(out, PluginReviewQueueItem{
			Version:       items[i],
			PluginKey:     p.PluginKey,
			PluginName:    p.Name,
			PluginSummary: p.Summary,
		})
	}
	return out, total, nil
}

// Get 审核详情
func (s *PluginReviewService) Get(ctx context.Context, id int64) (*PluginReviewDetail, error) {
	v, plugin, err := s.load(ctx, id)
	if err != nil {
		return nil, err
	}
	history, err := s.reviews.ListByVersion(ctx, id)
	if err != nil {
		return nil, err
	}
	if history == nil {
		history = []model.PluginReviewHistory{}
	}
	return &PluginReviewDetail{Plugin: *plugin, Version: *v, History: history}, nil
}

// Decide 通过 / 拒绝
func (s *PluginReviewService) Decide(ctx context.Context, user *PluginUser, id int64, action, comment string) error {
	if action != PluginActionApprove && action != PluginActionReject {
		return ErrPluginReviewInvalid
	}
	v, plugin, err := s.load(ctx, id)
	if err != nil {
		return err
	}
	if plugin.OwnerUsername == user.Name {
		return ErrPluginReviewForbidden
	}
	if v.ReviewStatus != model.PluginReviewPending {
		return ErrPluginInvalidStatus
	}

	now := time.Now()
	updates := map[string]any{
		"reviewer":       user.Name,
		"reviewer_info":  user.Info(),
		"review_comment": truncateRunes(comment, 2000),
		"reviewed_at":    now,
	}
	if action == PluginActionApprove {
		updates["review_status"] = model.PluginReviewApproved
		updates["listing_status"] = model.PluginListingListed
		updates["listed_at"] = now
	} else {
		updates["review_status"] = model.PluginReviewRejected
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		ok, err := s.versions.Decide(ctx, tx, id,
			[]string{model.PluginReviewPending}, updates)
		if err != nil {
			return err
		}
		if !ok {
			return ErrPluginReviewConflict
		}
		return s.reviews.Insert(ctx, tx, &model.PluginReviewHistory{
			VersionID:    id,
			Reviewer:     user.Name,
			ReviewerInfo: user.Info(),
			Action:       action,
			Comment:      truncateRunes(comment, 2000),
			ReviewedAt:   now,
		})
	})
	if err != nil {
		return err
	}

	// 事务提交后失效目录缓存
	s.catalog.Invalidate(ctx)

	// 实时推送插件房间：发布者详情页可直接刷新状态
	if s.hub != nil {
		status := model.PluginReviewRejected
		listing := model.PluginListingUnlisted
		if action == PluginActionApprove {
			status = model.PluginReviewApproved
			listing = model.PluginListingListed
		}
		if err := s.hub.PublishPluginChanged(ctx, plugin.PluginKey, map[string]any{
			"pluginKey":     plugin.PluginKey,
			"versionId":     id,
			"version":       v.Version,
			"reviewStatus":  status,
			"listingStatus": listing,
			"reviewComment": truncateRunes(comment, 2000),
			"reviewedAt":    now,
		}); err != nil {
			logrus.WithError(err).Warn("publish plugin changed failed")
		}
	}

	// 通知发布者（失败不影响审核结果）
	if s.notifier != nil {
		if err := s.notifier.NotifyPluginReviewResult(ctx, v, plugin, action, comment); err != nil {
			logrus.WithError(err).Warn("notify plugin review result failed")
		}
	}
	return nil
}

func (s *PluginReviewService) load(ctx context.Context, id int64) (*model.PluginVersion, *model.Plugin, error) {
	v, err := s.versions.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrPluginVersionNotFound
		}
		return nil, nil, err
	}
	plugin, err := s.plugins.GetByID(ctx, v.PluginID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrPluginNotFound
		}
		return nil, nil, err
	}
	return v, plugin, nil
}
