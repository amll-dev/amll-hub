package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/mail"
	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	logrus "github.com/sirupsen/logrus"
	"gorm.io/gorm"
)

// ErrPetitionLinkNotFound 关联不存在
var ErrPetitionLinkNotFound = errors.New("petition link not found")

// maxLinksPerSubmission 单个投稿最多关联的请愿数
const maxLinksPerSubmission = 10

// PetitionLinkItem 投稿详情里展示的关联请愿
type PetitionLinkItem struct {
	RequestID int64     `json:"requestId"`
	SongName  string    `json:"songName"`
	Artist    string    `json:"artist"`
	Status    string    `json:"status"`
	LinkedAt  time.Time `json:"linkedAt"`
}

// PetitionLinkService 投稿 ↔ 歌词请愿关联
type PetitionLinkService struct {
	links *repository.PetitionLinkRepo
	reqs  *repository.LyricRequestRepo
	subs  *repository.SubmissionRepo

	sender  *mail.Sender
	emails  *mail.Resolver
	siteURL string
}

// NewPetitionLinkService 创建 PetitionLinkService
func NewPetitionLinkService(
	links *repository.PetitionLinkRepo,
	reqs *repository.LyricRequestRepo,
	subs *repository.SubmissionRepo,
) *PetitionLinkService {
	return &PetitionLinkService{links: links, reqs: reqs, subs: subs}
}

// SetMailer 注入邮件发送能力
func (s *PetitionLinkService) SetMailer(sender *mail.Sender, emails *mail.Resolver, siteURL string) {
	s.sender = sender
	s.emails = emails
	s.siteURL = strings.TrimRight(siteURL, "/")
}

// platformColumns 把前端传来的平台 ID 映射成数据库列
func platformColumns(ids map[string][]string) map[string][]string {
	out := make(map[string][]string, 4)
	mapping := map[string]string{
		"ncm":     "ncm_id",
		"qq":      "qq_id",
		"spotify": "spotify_id",
		"apple":   "apple_music_id",
	}
	for key, col := range mapping {
		if len(ids[key]) > 0 {
			out[col] = ids[key]
		}
	}
	return out
}

// Match 按平台 ID 匹配仍待处理的请愿
func (s *PetitionLinkService) Match(
	ctx context.Context, platformIDs map[string][]string,
) ([]model.LyricRequest, error) {
	return s.reqs.ListByPlatformIDs(ctx, platformColumns(platformIDs))
}

// Bind 建立关联，并对新增的关联异步发送通知邮件。
// 仅投稿者本人可操作，且请求 ID 必须存在、仍待处理并与投稿平台 ID 匹配，
// 避免客户端伪造关联导致请愿状态被错误同步或通知邮件被滥用。
func (s *PetitionLinkService) Bind(
	ctx context.Context, submissionID int64, requestIDs []int64, actor string,
) error {
	if submissionID <= 0 || len(requestIDs) == 0 {
		return nil
	}
	sub, err := s.subs.GetByID(ctx, submissionID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrSubmissionNotFound
		}
		return fmt.Errorf("查询投稿失败: %w", err)
	}
	if sub.Submitter != actor {
		return ErrForbidden
	}

	matched, err := s.Match(ctx, submissionPlatformIDs(sub))
	if err != nil {
		return fmt.Errorf("校验请愿关联失败: %w", err)
	}
	allowed := make(map[int64]struct{}, len(matched))
	for _, req := range matched {
		allowed[req.ID] = struct{}{}
	}

	// 去重、丢弃非法/不匹配值、限量
	seen := make(map[int64]bool, len(requestIDs))
	ids := make([]int64, 0, len(requestIDs))
	for _, id := range requestIDs {
		if id <= 0 || seen[id] {
			continue
		}
		if _, ok := allowed[id]; !ok {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
		if len(ids) >= maxLinksPerSubmission {
			break
		}
	}
	if len(ids) == 0 {
		return nil
	}

	inserted, err := s.links.BindMany(ctx, submissionID, ids, actor)
	if err != nil {
		return fmt.Errorf("关联请愿失败: %w", err)
	}
	if len(inserted) > 0 {
		s.sendLinkEmailsAsync(ctx, submissionID, inserted)
	}
	return nil
}

// submissionPlatformIDs 汇总投稿的四个平台 ID，用于校验请愿是否匹配。
// 优先取 TTML 元数据中的多值 ID，并兼容旧数据中仅写入单值的列。
func submissionPlatformIDs(sub *model.Submission) map[string][]string {
	meta := map[string]any(sub.Metadata)
	out := make(map[string][]string)
	add := func(kind, metaKey, columnID string) {
		values := extractPlatformIDs(meta, metaKey)
		if v := strings.TrimSpace(columnID); v != "" {
			values = append(values, v)
		}
		seen := make(map[string]struct{}, len(values))
		clean := make([]string, 0, len(values))
		for _, v := range values {
			v = strings.TrimSpace(v)
			if v == "" || v == "0" {
				continue
			}
			if _, ok := seen[v]; ok {
				continue
			}
			seen[v] = struct{}{}
			clean = append(clean, v)
		}
		if len(clean) > 0 {
			out[kind] = clean
		}
	}
	add("ncm", "ncm_music_id", sub.NcmID)
	add("qq", "qq_music_id", sub.QqID)
	add("spotify", "spotify_id", sub.SpotifyID)
	add("apple", "apple_music_id", sub.AmID)
	return out
}

// Unbind 解除关联；投稿者本人或审核员/管理员可操作
func (s *PetitionLinkService) Unbind(
	ctx context.Context, submissionID, requestID int64, actor string, canManage bool,
) error {
	sub, err := s.subs.GetByID(ctx, submissionID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrSubmissionNotFound
		}
		return err
	}
	if !canManage && sub.Submitter != actor {
		return ErrForbidden
	}

	ok, err := s.links.Delete(ctx, submissionID, requestID)
	if err != nil {
		return fmt.Errorf("解除关联失败: %w", err)
	}
	if !ok {
		return ErrPetitionLinkNotFound
	}

	// 若这条投稿原本把请愿标记为完成，且没有其它已通过投稿再关联它 → 回退为待处理
	if sub.Status == model.StatusApproved {
		hasOther, err := s.links.HasApprovedSubmission(ctx, requestID, submissionID)
		if err == nil && !hasOther {
			if err := s.reqs.SetStatusByIDs(ctx, []int64{requestID}, model.LyricRequestPending); err != nil {
				logrus.WithError(err).Warn("revert petition status after unbind failed")
			}
		}
	}
	return nil
}

// ListBySubmission 投稿详情展示用：关联的请愿 + 当前状态
func (s *PetitionLinkService) ListBySubmission(
	ctx context.Context, submissionID int64,
) ([]PetitionLinkItem, error) {
	links, err := s.links.ListBySubmission(ctx, submissionID)
	if err != nil {
		return nil, err
	}
	out := make([]PetitionLinkItem, 0, len(links))
	if len(links) == 0 {
		return out, nil
	}
	ids := make([]int64, 0, len(links))
	for _, l := range links {
		ids = append(ids, l.RequestID)
	}
	reqs, err := s.reqs.ListByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	byID := make(map[int64]model.LyricRequest, len(reqs))
	for _, r := range reqs {
		byID[r.ID] = r
	}
	for _, l := range links {
		req, ok := byID[l.RequestID]
		if !ok {
			continue
		}
		out = append(out, PetitionLinkItem{
			RequestID: req.ID,
			SongName:  req.SongName,
			Artist:    req.Artist,
			Status:    req.Status,
			LinkedAt:  l.CreatedAt,
		})
	}
	return out, nil
}

// SyncBySubmission 按投稿当前审核状态同步关联请愿
func (s *PetitionLinkService) SyncBySubmission(ctx context.Context, submissionID int64) error {
	sub, err := s.subs.GetByID(ctx, submissionID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	links, err := s.links.ListBySubmission(ctx, submissionID)
	if err != nil || len(links) == 0 {
		return err
	}

	ids := make([]int64, 0, len(links))
	notifyIDs := make([]int64, 0, len(links))
	for _, l := range links {
		ids = append(ids, l.RequestID)
		if !l.CompleteNotified {
			notifyIDs = append(notifyIDs, l.RequestID)
		}
	}

	target := model.LyricRequestPending
	if sub.Status == model.StatusApproved {
		target = model.LyricRequestCompleted
	}
	if err := s.reqs.SetStatusByIDs(ctx, ids, target); err != nil {
		return fmt.Errorf("同步请愿状态失败: %w", err)
	}

	if target == model.LyricRequestCompleted && len(notifyIDs) > 0 {
		s.sendCompleteEmailsAsync(ctx, sub, notifyIDs)
	}
	return nil
}

// ===== 邮件 =====

func (s *PetitionLinkService) mailReady() bool {
	return s != nil && s.sender != nil && s.sender.Enabled() && s.emails != nil
}

// recipients 收集收件人：请愿发起人 + 全部支持者
func (s *PetitionLinkService) recipients(
	ctx context.Context, reqIDs []int64, extra []string,
) ([]string, map[string]string) {
	names := make([]string, 0, 16)
	display := make(map[string]string)
	seen := make(map[string]bool)

	add := func(username, displayName string) {
		if username == "" || seen[username] {
			return
		}
		seen[username] = true
		names = append(names, username)
		if displayName != "" {
			display[username] = displayName
		}
	}

	reqs, err := s.reqs.ListByIDs(ctx, reqIDs)
	if err != nil {
		logrus.WithError(err).Warn("load petitions for mail failed")
		return nil, display
	}
	for _, r := range reqs {
		add(r.RequesterName, jsonString(r.RequesterInfo, "displayName", ""))
	}
	supports, err := s.reqs.ListAllSupports(ctx, reqIDs)
	if err != nil {
		logrus.WithError(err).Warn("load petition supporters for mail failed")
	}
	for _, sp := range supports {
		add(sp.UserName, jsonString(sp.UserInfo, "displayName", ""))
	}
	for _, name := range extra {
		add(name, "")
	}
	return names, display
}

// sendLinkEmailsAsync 关联成功通知：发起人 + 支持者
func (s *PetitionLinkService) sendLinkEmailsAsync(
	ctx context.Context, submissionID int64, requestIDs []int64,
) {
	if !s.mailReady() {
		return
	}
	pkg.GoSafe("petition-link-mail", func() {
		timeout := s.sender.Timeout() + 10*time.Second
		c, cancel := pkg.DetachedTimeout(ctx, timeout*3)
		defer cancel()

		sub, err := s.subs.GetByID(c, submissionID)
		if err != nil {
			return
		}
		// 每条请愿单独发，邮件里的歌曲信息才对得上
		for _, requestID := range requestIDs {
			names, display := s.recipients(c, []int64{requestID}, nil)
			s.sendPetitionMail(c, "linked", sub, requestID, names, display)
		}
		if err := s.links.MarkLinkNotified(c, submissionID, requestIDs); err != nil {
			logrus.WithError(err).Warn("mark petition link notified failed")
		}
	})
}

// sendCompleteEmailsAsync 审核通过通知：发起人 + 支持者 + 投稿者
func (s *PetitionLinkService) sendCompleteEmailsAsync(
	ctx context.Context, sub *model.Submission, requestIDs []int64,
) {
	if !s.mailReady() {
		return
	}
	pkg.GoSafe("petition-complete-mail", func() {
		timeout := s.sender.Timeout() + 10*time.Second
		c, cancel := pkg.DetachedTimeout(ctx, timeout*3)
		defer cancel()

		for _, requestID := range requestIDs {
			names, display := s.recipients(c, []int64{requestID}, []string{sub.Submitter})
			if dn := sub.SubmitterInfo.DisplayName; dn != "" {
				display[sub.Submitter] = dn
			}
			s.sendPetitionMail(c, "completed", sub, requestID, names, display)
		}
		if err := s.links.MarkCompleteNotified(c, sub.ID, requestIDs); err != nil {
			logrus.WithError(err).Warn("mark petition complete notified failed")
		}
	})
}

// sendPetitionMail 逐收件人渲染并发送（失败只记日志，不影响主流程）
func (s *PetitionLinkService) sendPetitionMail(
	ctx context.Context,
	kind string,
	sub *model.Submission,
	requestID int64,
	usernames []string,
	display map[string]string,
) {
	if len(usernames) == 0 {
		return
	}
	reqs, err := s.reqs.ListByIDs(ctx, []int64{requestID})
	if err != nil || len(reqs) == 0 {
		return
	}
	req := reqs[0]
	detailURL := fmt.Sprintf("%s/creator/requests/%d", s.siteURL, req.ID)

	for _, username := range usernames {
		email, err := s.emails.Resolve(ctx, username)
		if err != nil || email == "" {
			continue
		}
		subject, html, text, err := s.sender.RenderPetition(mail.PetitionParams{
			Kind:        kind,
			DisplayName: display[username],
			Username:    username,
			SongName:    req.SongName,
			Artist:      req.Artist,
			DetailURL:   detailURL,
			SiteURL:     s.siteURL,
		})
		if err != nil {
			logrus.WithError(err).Warn("render petition mail failed")
			return
		}
		if err := s.sender.Send(ctx, email, subject, html, text); err != nil {
			logrus.WithError(err).WithField("username", username).Warn("send petition mail failed")
		}
	}
}
