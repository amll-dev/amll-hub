package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/sirupsen/logrus"

	"github.com/amll-dev/amll-hub/backend/internal/mail"
	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/amll-dev/amll-hub/backend/internal/ws"
)

// 通知文案长度上限（与表结构一致）
const (
	notificationTitleMax = 200
	notificationMax      = 2000
)

// NotificationAction 跳转动作
type NotificationAction struct {
	Path  string `json:"path"`
	Label string `json:"label"`
}

// NotificationDTO 站内消息对外结构（= 前端 Message）
type NotificationDTO struct {
	ID   int64  `json:"id"`
	Type string `json:"type"`
	// Result 审核结果细分（仅 type=review 有值：approved/rejected/need_revision/missing_audio/closed）
	Result    string              `json:"result,omitempty"`
	Title     string              `json:"title"`
	Content   string              `json:"content"`
	Read      bool                `json:"read"`
	CreatedAt time.Time           `json:"createdAt"`
	Action    *NotificationAction `json:"action,omitempty"`
}

// NotificationListDTO 列表结果（= 前端 NotificationListResult）
type NotificationListDTO struct {
	Items  []NotificationDTO `json:"items"`
	Total  int64             `json:"total"`
	Unread int64             `json:"unread"`
}

// NotifyInput 创建通知入参
type NotifyInput struct {
	Username    string
	Type        string
	Result      string
	Title       string
	Content     string
	ActionPath  string
	ActionLabel string
}

// NotificationService 站内消息服务
type NotificationService struct {
	repo   *repository.NotificationRepo
	hub    *ws.Hub
	sender *mail.Sender   // 邮件发送器（nil = 未启用邮件）
	emails *mail.Resolver // 用户名→邮箱（nil = 未启用邮件）
	site   string         // 站点地址，拼邮件里的详情链接
}

// NewNotificationService 创建通知服务（hub 与邮件组件由 main 在装配阶段注入）
func NewNotificationService(repo *repository.NotificationRepo) *NotificationService {
	return &NotificationService{repo: repo}
}

// SetEmail 注入邮件组件（siteURL 用于拼接稿件详情链接）
func (s *NotificationService) SetEmail(sender *mail.Sender, emails *mail.Resolver, siteURL string) {
	s.sender = sender
	s.emails = emails
	s.site = strings.TrimSuffix(siteURL, "/")
}

// SetHub 注入 Hub（两阶段注入，与 ViewerService.SetHub 同构）
func (s *NotificationService) SetHub(hub *ws.Hub) {
	s.hub = hub
}

// ---- 查询侧 ----

// List 分页查询某人的消息
func (s *NotificationService) List(ctx context.Context, username string, page, limit int, typ string) (*NotificationListDTO, error) {
	res, err := s.repo.List(ctx, repository.NotificationListQuery{
		Username: username,
		Type:     typ,
		Page:     page,
		Limit:    limit,
	})
	if err != nil {
		return nil, err
	}
	items := make([]NotificationDTO, len(res.Items))
	for i := range res.Items {
		items[i] = toNotificationDTO(&res.Items[i])
	}
	return &NotificationListDTO{Items: items, Total: res.Total, Unread: res.Unread}, nil
}

// CountUnread 未读总数
func (s *NotificationService) CountUnread(ctx context.Context, username string) (int64, error) {
	return s.repo.CountUnread(ctx, username)
}

// MarkRead 标记单条已读（不存在时返回 ErrNotificationNotFound）
func (s *NotificationService) MarkRead(ctx context.Context, username string, id int64) error {
	ok, err := s.repo.MarkRead(ctx, username, id)
	if err != nil {
		return err
	}
	if !ok {
		// 幂等：已读重复标记视为成功，仅「不存在/非本人」才 404
		n, err := s.repo.GetByID(ctx, id)
		if err != nil || n.Username != username {
			return ErrNotificationNotFound
		}
	}
	return nil
}

// MarkAllRead 全部已读，返回影响行数
func (s *NotificationService) MarkAllRead(ctx context.Context, username string) (int64, error) {
	return s.repo.MarkAllRead(ctx, username)
}

// Delete 删除单条
func (s *NotificationService) Delete(ctx context.Context, username string, id int64) error {
	ok, err := s.repo.Delete(ctx, username, id)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotificationNotFound
	}
	return nil
}

// ---- 触发侧 ----

// Notify 写入一条消息并尝试 WS 推送（先落库，推送失败只记日志不影响业务）
func (s *NotificationService) Notify(ctx context.Context, in NotifyInput) error {
	if in.ActionPath != "" && !validActionPath(in.ActionPath) {
		return fmt.Errorf("invalid action path: %s", in.ActionPath)
	}
	n := &model.Notification{
		Username:    in.Username,
		Type:        in.Type,
		Result:      in.Result,
		Title:       truncateRunes(in.Title, notificationTitleMax),
		Content:     truncateRunes(in.Content, notificationMax),
		ActionPath:  in.ActionPath,
		ActionLabel: truncateRunes(in.ActionLabel, 100),
	}
	if err := s.repo.Create(ctx, n); err != nil {
		return err
	}
	s.publish(ctx, n)
	return nil
}

// NotifyMany 群发同一内容给多个用户（批量落库，逐个推送）
func (s *NotificationService) NotifyMany(ctx context.Context, usernames []string, in NotifyInput) error {
	if in.ActionPath != "" && !validActionPath(in.ActionPath) {
		return fmt.Errorf("invalid action path: %s", in.ActionPath)
	}
	if len(usernames) == 0 {
		return nil
	}
	ns := make([]model.Notification, len(usernames))
	for i, u := range usernames {
		ns[i] = model.Notification{
			Username:    u,
			Type:        in.Type,
			Result:      in.Result,
			Title:       truncateRunes(in.Title, notificationTitleMax),
			Content:     truncateRunes(in.Content, notificationMax),
			ActionPath:  in.ActionPath,
			ActionLabel: truncateRunes(in.ActionLabel, 100),
		}
	}
	if err := s.repo.CreateBatch(ctx, ns); err != nil {
		return err
	}
	for i := range ns {
		s.publish(ctx, &ns[i])
	}
	return nil
}

// NotifyReviewResult T1：审核结果通知投稿人（按 sub.Status 组装文案）
func (s *NotificationService) NotifyReviewResult(ctx context.Context, sub *model.Submission, comment string) error {
	var title, content, label, result string
	switch sub.Status {
	case model.StatusApproved:
		title, content, label, result = "投稿已通过", fmt.Sprintf("《%s》已通过审核并收录", sub.Title), "查看投稿", model.NotifyResultApproved
	case model.StatusRejected:
		title, content, label, result = "投稿未通过", fmt.Sprintf("《%s》未通过审核。%s", sub.Title, comment), "查看投稿", model.NotifyResultRejected
	case model.StatusNeedRevision:
		title, content, label, result = "投稿需修改", fmt.Sprintf("《%s》需要修改。%s", sub.Title, comment), "前往修改", model.NotifyResultNeedRevision
	case model.StatusMissingAudio:
		title, content, label, result = "投稿缺音频", fmt.Sprintf("《%s》缺少音频文件", sub.Title), "前往补充", model.NotifyResultMissingAudio
	case model.StatusRevised:
		title, content, label, result = "审核已完成修订",
			fmt.Sprintf("《%s》的审核员已提交修订版歌词，请确认是否采用。%s", sub.Title, comment),
			"确认修订", model.NotifyResultRevised
	default:
		return nil
	}
	err := s.Notify(ctx, NotifyInput{
		Username:    sub.Submitter,
		Type:        model.NotifyTypeReview,
		Result:      result,
		Title:       title,
		Content:     content,
		ActionPath:  fmt.Sprintf("/creator/lyrics/detail?id=%d", sub.ID),
		ActionLabel: label,
	})
	s.sendResultEmailAsync(ctx, sub, result, comment)
	return err
}

// sendResultEmailAsync 异步发送审核结果邮件。
// 失败只记日志：邮件是站内消息的补充，不该影响审核流程本身。
func (s *NotificationService) sendResultEmailAsync(
	ctx context.Context,
	sub *model.Submission,
	result string,
	comment string,
) {
	if !s.sender.Enabled() {
		return
	}
	// 脱离请求生命周期：审核接口可能已返回，不能被原 ctx 的取消打断
	go func() {
		c, cancel := context.WithTimeout(context.WithoutCancel(ctx), s.sender.Timeout()+10*time.Second)
		defer cancel()

		fields := logrus.Fields{"submission_id": sub.ID, "username": sub.Submitter, "result": result}

		email, err := s.emails.Resolve(c, sub.Submitter)
		if err != nil {
			logrus.WithError(err).WithFields(fields).Warn("resolve user email failed, skip mail")
			return
		}
		if email == "" {
			logrus.WithFields(fields).Warn("user has no email, skip review result mail")
			return
		}

		subject, htmlBody, textBody, err := s.sender.RenderReviewResult(mail.ReviewResultParams{
			DisplayName:  sub.SubmitterInfo.DisplayName,
			Username:     sub.Submitter,
			Title:        sub.Title,
			Artist:       sub.Artist,
			SubmissionID: sub.ID,
			Result:       result,
			Comment:      comment,
			ReviewedAt:   time.Now().Format("2006-01-02 15:04"),
			DetailURL:    fmt.Sprintf("%s/creator/lyrics/detail?id=%d", s.site, sub.ID),
			SiteURL:      s.site,
		})
		if err != nil {
			logrus.WithError(err).WithFields(fields).Warn("render review result mail failed")
			return
		}
		if err := s.sender.Send(c, email, subject, htmlBody, textBody); err != nil {
			logrus.WithError(err).WithFields(fields).Warn("send review result email failed")
			return
		}
		logrus.WithFields(fields).Info("review result email sent")
	}()
}

// NotifyNewComment T3：投稿收到他人评论时通知投稿人
func (s *NotificationService) NotifyNewComment(ctx context.Context, sub *model.Submission, commenter string) error {
	if sub.Submitter == "" || sub.Submitter == commenter {
		return nil
	}
	return s.Notify(ctx, NotifyInput{
		Username:    sub.Submitter,
		Type:        model.NotifyTypeComment,
		Title:       "投稿收到新评论",
		Content:     fmt.Sprintf("%s 评论了《%s》", commenter, sub.Title),
		ActionPath:  fmt.Sprintf("/creator/lyrics/detail?id=%d", sub.ID),
		ActionLabel: "查看评论",
	})
}

// NotifyAutoRejected T4：超时自动拒绝通知投稿人
func (s *NotificationService) NotifyAutoRejected(ctx context.Context, sub *model.Submission) error {
	err := s.Notify(ctx, NotifyInput{
		Username:    sub.Submitter,
		Type:        model.NotifyTypeReview,
		Result:      model.NotifyResultClosed,
		Title:       "投稿已超时关闭",
		Content:     fmt.Sprintf("《%s》超过处理时限，已自动关闭", sub.Title),
		ActionPath:  fmt.Sprintf("/creator/lyrics/detail?id=%d", sub.ID),
		ActionLabel: "查看投稿",
	})
	s.sendResultEmailAsync(ctx, sub, model.NotifyResultClosed, "")
	return err
}

// NotifyAnnouncement T5：系统公告群发给全体已知用户。
// title/content 来自管理员原始输入，此处做一次 HTML 转义 + 截断
func (s *NotificationService) NotifyAnnouncement(ctx context.Context, title, content, path, label string) error {
	users, err := s.repo.ListAllKnownUsers(ctx)
	if err != nil {
		return err
	}
	if len(users) == 0 {
		return nil
	}
	return s.NotifyMany(ctx, users, NotifyInput{
		Type:        model.NotifyTypeSystem,
		Title:       sanitize(title, notificationTitleMax),
		Content:     sanitize(content, notificationMax),
		ActionPath:  path,
		ActionLabel: sanitize(label, 100),
	})
}

// StartCleanupTask 启动 90 天历史消息清理任务（P8）
func (s *NotificationService) StartCleanupTask(ctx context.Context) {
	go func() {
		interval := 24 * time.Hour
		retention := 90 * 24 * time.Hour
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				deleted, err := s.repo.DeleteOlderThan(ctx, time.Now().Add(-retention))
				if err != nil {
					logrus.WithError(err).Warn("notification cleanup failed")
					continue
				}
				if deleted > 0 {
					logrus.WithField("deleted", deleted).Info("notification cleanup done")
				}
			}
		}
	}()
}

// publish WS 推送（失败只记日志；Redis Pub/Sub 是 at-most-once，前端有轮询兜底）
func (s *NotificationService) publish(ctx context.Context, n *model.Notification) {
	if s.hub == nil {
		return
	}
	if err := s.hub.PublishNotification(ctx, n.Username, toNotificationDTO(n)); err != nil {
		logrus.WithError(err).WithField("username", n.Username).Warn("publish notification failed")
	}
}

// toNotificationDTO model -> DTO
func toNotificationDTO(n *model.Notification) NotificationDTO {
	dto := NotificationDTO{
		ID:        n.ID,
		Type:      n.Type,
		Result:    n.Result,
		Title:     n.Title,
		Content:   n.Content,
		Read:      n.IsRead,
		CreatedAt: n.CreatedAt,
	}
	if n.ActionPath != "" {
		dto.Action = &NotificationAction{Path: n.ActionPath, Label: n.ActionLabel}
	}
	return dto
}

// validActionPath 跳转路径必须以 / 开头且不以 // 开头（防开放重定向）
func validActionPath(p string) bool {
	return strings.HasPrefix(p, "/") && !strings.HasPrefix(p, "//")
}

// truncateRunes 按 rune 截断（不转义：内容源多为 DB 中已 sanitize 过的文本，避免二次转义）
func truncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) > max {
		return string(r[:max])
	}
	return s
}
