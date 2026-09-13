package repository

import (
	"context"
	"errors"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
)

// 分页边界：面板与 /messages 页都固定 20 条，上限 100 防止被刷
const (
	notificationDefaultLimit = 20
	notificationMaxLimit     = 100
)

// NotificationRepo 站内消息数据访问
type NotificationRepo struct {
	db *gorm.DB
}

// NewNotificationRepo 创建 NotificationRepo
func NewNotificationRepo(db *gorm.DB) *NotificationRepo {
	return &NotificationRepo{db: db}
}

// NotificationListQuery 列表查询条件
// Type 为空或 "all" 表示不过滤类型
type NotificationListQuery struct {
	Username string
	Type     string
	Page     int
	Limit    int
}

// NotificationListResult 列表结果
// Unread 是该用户全部未读数，不受分页与类型过滤影响
type NotificationListResult struct {
	Total  int64
	Items  []model.Notification
	Unread int64
}

func normalizeNotificationPage(page, limit int) (int, int) {
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = notificationDefaultLimit
	}
	if limit > notificationMaxLimit {
		limit = notificationMaxLimit
	}
	return page, limit
}

// List 分页查询某人的消息（按创建时间倒序），同时返回全量未读数
func (r *NotificationRepo) List(ctx context.Context, q NotificationListQuery) (*NotificationListResult, error) {
	page, limit := normalizeNotificationPage(q.Page, q.Limit)

	base := r.db.WithContext(ctx).Model(&model.Notification{}).Where("username = ?", q.Username)
	if q.Type != "" && q.Type != "all" {
		base = base.Where("type = ?", q.Type)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, err
	}

	var items []model.Notification
	if total > 0 {
		err := base.Order("created_at DESC, id DESC").
			Offset((page - 1) * limit).Limit(limit).
			Find(&items).Error
		if err != nil {
			return nil, err
		}
	}

	unread, err := r.CountUnread(ctx, q.Username)
	if err != nil {
		return nil, err
	}

	return &NotificationListResult{Total: total, Items: items, Unread: unread}, nil
}

// Create 写入一条消息（回填 ID 与 CreatedAt）
func (r *NotificationRepo) Create(ctx context.Context, n *model.Notification) error {
	if n == nil {
		return errors.New("notification is nil")
	}
	return r.db.WithContext(ctx).Create(n).Error
}

// CreateBatch 批量写入（单条 INSERT，供群发审核员/系统公告）
func (r *NotificationRepo) CreateBatch(ctx context.Context, ns []model.Notification) error {
	if len(ns) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).Create(&ns).Error
}

// GetByID 查询单条（含 username，供越权校验）
func (r *NotificationRepo) GetByID(ctx context.Context, id int64) (*model.Notification, error) {
	var n model.Notification
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&n).Error
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// MarkRead 标记单条已读，返回是否命中。
// 带 is_read = false 条件保证幂等：重复调用不会覆盖 read_at，也不会误改他人数据
func (r *NotificationRepo) MarkRead(ctx context.Context, username string, id int64) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.Notification{}).
		Where("username = ? AND id = ? AND is_read = false", username, id).
		Updates(map[string]any{"is_read": true, "read_at": time.Now()})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// MarkAllRead 全部标记已读，返回影响行数
func (r *NotificationRepo) MarkAllRead(ctx context.Context, username string) (int64, error) {
	res := r.db.WithContext(ctx).Model(&model.Notification{}).
		Where("username = ? AND is_read = false", username).
		Updates(map[string]any{"is_read": true, "read_at": time.Now()})
	return res.RowsAffected, res.Error
}

// Delete 删除单条，返回是否命中
func (r *NotificationRepo) Delete(ctx context.Context, username string, id int64) (bool, error) {
	res := r.db.WithContext(ctx).
		Where("username = ? AND id = ?", username, id).
		Delete(&model.Notification{})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// CountUnread 未读总数
func (r *NotificationRepo) CountUnread(ctx context.Context, username string) (int64, error) {
	var cnt int64
	err := r.db.WithContext(ctx).Model(&model.Notification{}).
		Where("username = ? AND is_read = false", username).
		Count(&cnt).Error
	return cnt, err
}

// DeleteOlderThan 清理指定时间之前的消息，返回删除行数
func (r *NotificationRepo) DeleteOlderThan(ctx context.Context, before time.Time) (int64, error) {
	res := r.db.WithContext(ctx).
		Where("created_at < ?", before).
		Delete(&model.Notification{})
	return res.RowsAffected, res.Error
}

// ListAllKnownUsers 收集全站已知用户名
func (r *NotificationRepo) ListAllKnownUsers(ctx context.Context) ([]string, error) {
	seen := make(map[string]struct{})
	var out []string

	var submitters []string
	if err := r.db.WithContext(ctx).Model(&model.Submission{}).
		Where("submitter <> ''").Distinct().Pluck("submitter", &submitters).Error; err != nil {
		return nil, err
	}
	var reviewers []string
	if err := r.db.WithContext(ctx).Model(&model.Reviewer{}).
		Where("username <> ''").Distinct().Pluck("username", &reviewers).Error; err != nil {
		return nil, err
	}

	for _, list := range [][]string{submitters, reviewers} {
		for _, name := range list {
			if name == "" {
				continue
			}
			if _, ok := seen[name]; ok {
				continue
			}
			seen[name] = struct{}{}
			out = append(out, name)
		}
	}
	return out, nil
}
