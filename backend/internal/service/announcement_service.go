package service

import (
	"context"
	"fmt"
	htmltemplate "html/template"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/sirupsen/logrus"

	"github.com/amll-dev/amll-hub/backend/internal/mail"
	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
)

// 公告字段上限
const (
	announcementTitleMax       = 200
	announcementContentMax     = 2000
	announcementActionLabelMax = 100
	// announcementMailProgressStep 每发多少封回写一次进度，避免每封都打库
	announcementMailProgressStep = 10
	// announcementMailMaxDuration 邮件任务总时长上限，防止异常时 goroutine 挂太久
	announcementMailMaxDuration = 30 * time.Minute
)

// InvalidAnnouncementError 公告入参校验失败，Msg 可直接展示给用户
type InvalidAnnouncementError struct {
	Msg string
}

func (e *InvalidAnnouncementError) Error() string { return e.Msg }

func invalidAnnouncement(format string, args ...any) error {
	return &InvalidAnnouncementError{Msg: fmt.Sprintf(format, args...)}
}

// PublishAnnouncementInput 发布公告入参
type PublishAnnouncementInput struct {
	Title       string
	Content     string
	ActionPath  string
	ActionLabel string
	SendMail    bool
	// Sender 发布人用户名（由 handler 从 JWT 取）
	Sender string
}

// AnnouncementService 系统公告发布与历史查询
type AnnouncementService struct {
	repo   *repository.AnnouncementRepo
	users  *repository.NotificationRepo
	notif  *NotificationService
	sender *mail.Sender
	emails *mail.Resolver
	site   string
}

// NewAnnouncementService 创建公告服务
func NewAnnouncementService(
	repo *repository.AnnouncementRepo,
	users *repository.NotificationRepo,
	notif *NotificationService,
	sender *mail.Sender,
	emails *mail.Resolver,
	siteURL string,
) *AnnouncementService {
	return &AnnouncementService{
		repo:   repo,
		users:  users,
		notif:  notif,
		sender: sender,
		emails: emails,
		site:   strings.TrimSuffix(siteURL, "/"),
	}
}

// MailAvailable 邮件通道是否可用
func (s *AnnouncementService) MailAvailable() bool {
	return s.sender.Enabled() && s.emails != nil
}

// AudienceCount 预计收件人数
func (s *AnnouncementService) AudienceCount(ctx context.Context) (int, error) {
	users, err := s.users.ListAllKnownUsers(ctx)
	if err != nil {
		return 0, err
	}
	return len(users), nil
}

// Publish 发布公告
func (s *AnnouncementService) Publish(
	ctx context.Context, in PublishAnnouncementInput,
) (*model.Announcement, error) {
	title := strings.TrimSpace(in.Title)
	content := strings.TrimSpace(in.Content)
	if title == "" {
		return nil, invalidAnnouncement("公告标题不能为空")
	}
	if content == "" {
		return nil, invalidAnnouncement("公告内容不能为空")
	}
	if utf8.RuneCountInString(title) > announcementTitleMax {
		return nil, invalidAnnouncement("公告标题不能超过 %d 字", announcementTitleMax)
	}
	if utf8.RuneCountInString(content) > announcementContentMax {
		return nil, invalidAnnouncement("公告内容不能超过 %d 字", announcementContentMax)
	}

	actionPath := strings.TrimSpace(in.ActionPath)
	if actionPath != "" && !validActionPath(actionPath) {
		return nil, invalidAnnouncement("跳转路径必须以 / 开头")
	}
	actionLabel := strings.TrimSpace(in.ActionLabel)
	if actionLabel != "" && utf8.RuneCountInString(actionLabel) > announcementActionLabelMax {
		return nil, invalidAnnouncement("按钮文案不能超过 %d 字", announcementActionLabelMax)
	}
	if actionPath != "" && actionLabel == "" {
		actionLabel = "查看详情"
	}
	if actionPath == "" {
		actionLabel = ""
	}

	// 正文按 Markdown 渲染：邮件发 HTML，站内信只放纯文本
	bodyHTML := renderAnnouncementHTML(content)
	bodyText := announcementPlainText(content)
	if bodyText == "" {
		bodyText = content
	}

	users, err := s.users.ListAllKnownUsers(ctx)
	if err != nil {
		return nil, err
	}

	// 邮件开关双重约束
	mailOn := in.SendMail && s.MailAvailable()

	a := &model.Announcement{
		Title:         title,
		Content:       content,
		ActionPath:    actionPath,
		ActionLabel:   actionLabel,
		Sender:        in.Sender,
		MailEnabled:   mailOn,
		AudienceCount: len(users),
		MailStatus:    model.AnnouncementMailNone,
	}
	if mailOn {
		a.MailStatus = model.AnnouncementMailSending
	}
	if err := s.repo.Create(ctx, a); err != nil {
		return nil, err
	}

	if len(users) > 0 {
		if err := s.notif.NotifyMany(ctx, users, NotifyInput{
			Type:        model.NotifyTypeSystem,
			Title:       title,
			Content:     bodyText,
			ActionPath:  actionPath,
			ActionLabel: actionLabel,
		}); err != nil {
			// 站内信失败：收尾邮件状态，避免记录永远停在 sending
			if mailOn {
				s.writeProgress(ctx, a.ID, 0, 0, 0, true)
			}
			return nil, err
		}
	}

	if mailOn {
		go s.sendMails(a.ID, title, bodyHTML, bodyText, actionPath, actionLabel, in.Sender, users)
	}
	return a, nil
}

// List 公告历史（分页）
func (s *AnnouncementService) List(ctx context.Context, page, limit int) ([]model.Announcement, int64, error) {
	return s.repo.List(ctx, page, limit)
}

// Get 单条公告（用于前端轮询邮件进度）
func (s *AnnouncementService) Get(ctx context.Context, id int64) (*model.Announcement, error) {
	a, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if a == nil {
		return nil, ErrAnnouncementNotFound
	}
	return a, nil
}

// sendMails 后台逐封发送公告邮件
func (s *AnnouncementService) sendMails(
	id int64, title, bodyHTML, bodyText, actionPath, actionLabel, sender string, users []string,
) {
	defer func() {
		if r := recover(); r != nil {
			logrus.Errorf("announcement mail panic: %v", r)
			s.writeProgress(context.Background(), id, 0, 0, 0, true)
		}
	}()

	detailURL := ""
	if actionPath != "" && s.site != "" {
		detailURL = s.site + actionPath
	}
	subject, htmlBody, textBody, err := s.sender.RenderAnnouncement(mail.AnnouncementParams{
		Title:       title,
		BodyHTML:    htmltemplate.HTML(bodyHTML), // 已在 renderAnnouncementHTML 里清洗
		BodyText:    bodyText,
		Sender:      sender,
		PublishedAt: time.Now().Format("2006-01-02 15:04"),
		ActionURL:   detailURL,
		ActionLabel: actionLabel,
		SiteURL:     s.site,
	})
	if err != nil {
		logrus.WithError(err).WithField("announcement_id", id).Error("render announcement mail failed")
		s.writeProgress(context.Background(), id, 0, 0, 0, true)
		return
	}

	// 总时长按人数估算，并设上限
	total := time.Duration(len(users)) * (s.sender.Timeout() + time.Second)
	if total > announcementMailMaxDuration || total <= 0 {
		total = announcementMailMaxDuration
	}
	ctx, cancel := context.WithTimeout(context.Background(), total)
	defer cancel()

	sent, failed, skipped := 0, 0, 0
	fields := logrus.Fields{"announcement_id": id}

	for i, username := range users {
		email, err := s.emails.Resolve(ctx, username)
		if err != nil {
			// 查询邮箱失败按跳过处理：不阻断整批发送
			skipped++
			logrus.WithError(err).WithFields(fields).WithField("username", username).
				Warn("resolve user email failed, skip announcement mail")
		} else if email == "" {
			skipped++
		} else if err := s.sender.Send(ctx, email, subject, htmlBody, textBody); err != nil {
			failed++
			logrus.WithError(err).WithFields(fields).WithField("username", username).
				Warn("send announcement mail failed")
		} else {
			sent++
		}

		if (i+1)%announcementMailProgressStep == 0 {
			s.writeProgress(ctx, id, sent, failed, skipped, false)
		}
	}

	s.writeProgress(context.Background(), id, sent, failed, skipped, true)
	logrus.WithFields(fields).
		WithField("sent", sent).WithField("failed", failed).WithField("skipped", skipped).
		Info("announcement mail done")
}

// writeProgress 回写邮件进度（finish=true 时一并写完成时间与 done 状态）
func (s *AnnouncementService) writeProgress(
	ctx context.Context, id int64, sent, failed, skipped int, finish bool,
) {
	status := model.AnnouncementMailSending
	if finish {
		status = model.AnnouncementMailDone
	}
	// 独立超时：调用方 ctx 可能已取消
	c, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := s.repo.UpdateMailProgress(c, id, sent, failed, skipped, status, finish); err != nil {
		logrus.WithError(err).WithField("announcement_id", id).Warn("update announcement mail progress failed")
	}
}
