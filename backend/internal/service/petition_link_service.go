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

// maxMailRecipients 单条请愿通知邮件的收件人上限，避免热门请愿收件人过多
// 导致整体超时后「头部少数人反复收到、尾部永远收不到」
const maxMailRecipients = 200

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
// 第二个返回值是本次因超出单投稿上限而被忽略的请愿数，
// 让调用方能在响应里告诉用户「超出部分已忽略」，而不是静默丢弃。
func (s *PetitionLinkService) Bind(
	ctx context.Context, submissionID int64, requestIDs []int64, actor string,
) (int, error) {
	if submissionID <= 0 || len(requestIDs) == 0 {
		return 0, nil
	}
	sub, err := s.subs.GetByID(ctx, submissionID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, ErrSubmissionNotFound
		}
		return 0, fmt.Errorf("查询投稿失败: %w", err)
	}
	if sub.Submitter != actor {
		return 0, ErrForbidden
	}

	matched, err := s.Match(ctx, submissionPlatformIDs(sub))
	if err != nil {
		return 0, fmt.Errorf("校验请愿关联失败: %w", err)
	}
	allowed := make(map[int64]struct{}, len(matched))
	for _, req := range matched {
		allowed[req.ID] = struct{}{}
	}

	// 去重、丢弃非法/不匹配值。上限统一交给 BindMany 按「已有关联 + 本次」
	// 的累计量判断：在这里提前 break 会让「被截掉的条数」统计不准，也挡不住分批发。
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
	}
	if len(ids) == 0 {
		return 0, nil
	}

	inserted, skipped, err := s.links.BindMany(ctx, submissionID, ids, actor, maxLinksPerSubmission)
	if err != nil {
		return 0, fmt.Errorf("关联请愿失败: %w", err)
	}
	if skipped > 0 {
		// 累计上限在仓库层按「已有行数 + 本次新增」判断，这里留痕并由调用方回给前端。
		logrus.WithFields(logrus.Fields{
			"submission_id": submissionID,
			"skipped":       skipped,
			"limit":         maxLinksPerSubmission,
		}).Warn("petition links truncated by per-submission limit")
	}
	if len(inserted) > 0 {
		s.sendLinkEmailsAsync(ctx, submissionID, inserted)
	}
	return skipped, nil
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
		if err := s.revertIfOrphaned(ctx, []int64{requestID}, submissionID); err != nil {
			logrus.WithError(err).Warn("revert petition status after unbind failed")
		}
	}
	return nil
}

// revertIfOrphaned 把「没有其它已通过投稿支撑」的请愿回退为待处理。
// excludeSubmissionID 为本次变更的投稿（不应把自身的旧状态算作支撑）。
// Unbind 与 SyncBySubmission 共用，避免状态覆盖把已完成的请愿打回待处理。
func (s *PetitionLinkService) revertIfOrphaned(
	ctx context.Context, requestIDs []int64, excludeSubmissionID int64,
) error {
	orphaned := make([]int64, 0, len(requestIDs))
	for _, rid := range requestIDs {
		hasOther, err := s.links.HasApprovedSubmission(ctx, rid, excludeSubmissionID)
		if err != nil {
			return fmt.Errorf("检查请愿已通过投稿失败: %w", err)
		}
		if !hasOther {
			orphaned = append(orphaned, rid)
		}
	}
	if len(orphaned) == 0 {
		return nil
	}
	return s.reqs.SetStatusByIDs(ctx, orphaned, model.LyricRequestPending)
}

// ListBySubmission 投稿详情展示用：关联的请愿 + 当前状态。
// 可见范围 = 投稿者本人 + 审核员/管理员；越权返回 ErrSubmissionNotFound
// （对外 404，不泄露投稿是否存在），而不是 403。
func (s *PetitionLinkService) ListBySubmission(
	ctx context.Context, submissionID int64, viewer string, isReviewer bool,
) ([]PetitionLinkItem, error) {
	sub, err := s.subs.GetByID(ctx, submissionID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSubmissionNotFound
		}
		return nil, err
	}
	if sub.Submitter != viewer && !isReviewer {
		return nil, ErrSubmissionNotFound
	}

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
	if target == model.LyricRequestCompleted {
		if err := s.reqs.SetStatusByIDs(ctx, ids, target); err != nil {
			return fmt.Errorf("同步请愿状态失败: %w", err)
		}
	} else {
		// 回退为 pending 前必须排除「已有其它通过投稿」的请愿，否则一条被拒的
		// 新投稿会把早已由其它通过投稿完成的请愿重新打回待处理。
		if err := s.revertIfOrphaned(ctx, ids, submissionID); err != nil {
			return fmt.Errorf("回退请愿状态失败: %w", err)
		}
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

// recipients 收集收件人：请愿发起人 + 全部支持者。
// 超过 maxMailRecipients 的部分会被丢弃，并通过第二个返回值告知调用方丢弃了多少人，
// 便于补发一封汇总邮件，而不是只在日志里留痕。
func (s *PetitionLinkService) recipients(
	ctx context.Context, reqIDs []int64, extra []string,
) ([]string, map[string]string, int) {
	names := make([]string, 0, 16)
	display := make(map[string]string)
	seen := make(map[string]bool)
	truncated := 0

	add := func(username, displayName string) {
		if username == "" || seen[username] {
			return
		}
		if len(names) >= maxMailRecipients {
			// 记录去重后的超限人数：seen 里已有人不算重复计入
			seen[username] = true
			truncated++
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
		return nil, display, truncated
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
	if truncated > 0 {
		logrus.WithFields(logrus.Fields{
			"request_ids": reqIDs,
			"truncated":   truncated,
			"limit":       maxMailRecipients,
		}).Warn("petition mail recipients truncated by limit")
	}
	return names, display, truncated
}

// sendLinkEmailsAsync 关联成功通知：发起人 + 支持者
func (s *PetitionLinkService) sendLinkEmailsAsync(
	ctx context.Context, submissionID int64, requestIDs []int64,
) {
	if !s.mailReady() {
		return
	}
	pkg.GoSafe("petition-link-mail", func() {
		// 不设整体超时：热门请愿收件人多时，整体 ctx 过期会让尾部全部失败，
		// 且共用的过期 ctx 会让后面的标记必然失败，触发下次事件重发前几封。
		// 每封邮件在 sendPetitionMail 内单独控制超时。
		mailCtx := context.WithoutCancel(ctx)

		sub, err := s.subs.GetByID(mailCtx, submissionID)
		if err != nil {
			return
		}
		// 每条请愿单独发，邮件里的歌曲信息才对得上
		for _, requestID := range requestIDs {
			names, display, truncated := s.recipients(mailCtx, []int64{requestID}, nil)
			s.sendPetitionMail(mailCtx, "linked", sub, requestID, names, display)
			s.sendOverflowNotice(mailCtx, sub, requestID, truncated)
		}
		// 标记用独立短 ctx，与发信结果/超时解耦，避免下次审核事件重复发信。
		markCtx, cancel := pkg.DetachedTimeout(ctx, 5*time.Second)
		defer cancel()
		if err := s.links.MarkLinkNotified(markCtx, submissionID, requestIDs); err != nil {
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
		// 同 sendLinkEmailsAsync：不设整体超时，单封自控；标记用独立短 ctx。
		mailCtx := context.WithoutCancel(ctx)

		for _, requestID := range requestIDs {
			names, display, truncated := s.recipients(mailCtx, []int64{requestID}, []string{sub.Submitter})
			if dn := sub.SubmitterInfo.DisplayName; dn != "" {
				display[sub.Submitter] = dn
			}
			s.sendPetitionMail(mailCtx, "completed", sub, requestID, names, display)
			s.sendOverflowNotice(mailCtx, sub, requestID, truncated)
		}
		// 独立短 ctx：即便发信超时或失败也完成标记，防止超时后每次重试都重发前几封。
		markCtx, cancel := pkg.DetachedTimeout(ctx, 5*time.Second)
		defer cancel()
		if err := s.links.MarkCompleteNotified(markCtx, sub.ID, requestIDs); err != nil {
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
	// 每封独立超时：单封卡住/失败只影响本人，不拖累后续收件人。
	perMailTimeout := s.sender.Timeout() + 10*time.Second

	for _, username := range usernames {
		perCtx, cancel := context.WithTimeout(ctx, perMailTimeout)
		email, err := s.emails.Resolve(perCtx, username)
		if err != nil || email == "" {
			cancel()
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
			cancel()
			logrus.WithError(err).Warn("render petition mail failed")
			return
		}
		if err := s.sender.Send(perCtx, email, subject, html, text); err != nil {
			logrus.WithError(err).WithField("username", username).Warn("send petition mail failed")
		}
		cancel()
	}
}

// petitionMailSubjectPrefix 与 mail 包模板的主题前缀保持一致
const petitionMailSubjectPrefix = "【AMLL Hub】"

// sendOverflowNotice 收件人超过 maxMailRecipients 时，给请愿发起人补发一封纯文本汇总，
// 避免「热门请愿的支持者被静默丢弃、只留一条日志」。
// 收件人沿用 recipients 里已有的发起人信息（历史数据缺失时回退到投稿者），
// 不引入新的权限模型，也不额外查管理员名单。
func (s *PetitionLinkService) sendOverflowNotice(
	ctx context.Context, sub *model.Submission, requestID int64, truncated int,
) {
	if truncated <= 0 {
		return
	}
	reqs, err := s.reqs.ListByIDs(ctx, []int64{requestID})
	if err != nil || len(reqs) == 0 {
		logrus.WithError(err).WithField("request_id", requestID).
			Warn("load petition for overflow notice failed")
		return
	}
	req := reqs[0]

	username := req.RequesterName
	displayName := jsonString(req.RequesterInfo, "displayName", "")
	if username == "" && sub != nil {
		username = sub.Submitter
		displayName = sub.SubmitterInfo.DisplayName
	}
	if username == "" {
		return
	}
	if displayName == "" {
		displayName = username
	}

	var body strings.Builder
	body.WriteString(displayName + "，你好：\n\n")
	fmt.Fprintf(&body,
		"本次请愿《%s》（%s）的通知邮件有 %d 位收件人超出单次发送上限（%d 位），未被发送。\n",
		req.SongName, req.Artist, truncated, maxMailRecipients)
	body.WriteString("其余收件人已正常发送，请愿状态与投稿流程不受影响。\n\n")
	fmt.Fprintf(&body, "请愿详情：%s/creator/requests/%d\n", s.siteURL, req.ID)
	body.WriteString("\n此邮件由系统自动发送，请勿直接回复。\n")

	subject := fmt.Sprintf("%s请愿《%s》有 %d 位收件人超出通知上限",
		petitionMailSubjectPrefix, req.SongName, truncated)

	perCtx, cancel := context.WithTimeout(ctx, s.sender.Timeout()+10*time.Second)
	defer cancel()
	email, err := s.emails.Resolve(perCtx, username)
	if err != nil {
		logrus.WithError(err).WithField("username", username).
			Warn("resolve overflow notice recipient failed")
		return
	}
	if email == "" {
		return
	}
	if err := s.sender.SendPlain(perCtx, email, subject, body.String()); err != nil {
		logrus.WithError(err).WithField("username", username).
			Warn("send petition overflow notice failed")
	}
}
