package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/amll-dev/amll-hub/backend/internal/ws"
	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type RecruitmentConditions struct {
	ValidSubmissions       int `json:"validSubmissions"`
	ApprovalsPerSubmission int `json:"approvalsPerSubmission"`
	RevisionsPerSubmission int `json:"revisionsPerSubmission"`
	SubmissionsPerLanguage int `json:"submissionsPerLanguage"`
	MaxAttempts            int `json:"maxAttempts"`
}
type RecruitmentInput struct {
	ID            string                `json:"id"`
	Announcement  string                `json:"announcement"`
	Languages     []string              `json:"languages"`
	Conditions    RecruitmentConditions `json:"conditions"`
	EndsOn        string                `json:"endsOn,omitempty"`
	TargetMembers int                   `json:"targetMembers,omitempty"`
}
type RecruitmentPlan struct {
	RecruitmentInput
	StartsOn         string    `json:"startsOn"`
	EndedOn          *string   `json:"endedOn,omitempty"`
	CreatedAt        time.Time `json:"createdAt"`
	Status           string    `json:"status"`
	ParticipantCount int       `json:"participantCount"`
	CompletedCount   int       `json:"completedCount"`
}
type recruitmentSubmission struct {
	ID        int64    `json:"id"`
	Version   string   `json:"version"`
	Approvers []string `json:"approvers"`
	Revisions int      `json:"revisions"`
	Penalized bool     `json:"penalized"`
	Approved  bool     `json:"approved"`
	Languages []string `json:"languages"`
}
type recruitmentProgress struct {
	Submissions []recruitmentSubmission `json:"submissions"`
	Completed   bool                    `json:"completed"`
}
type RecruitmentMember struct {
	Username            string         `json:"username"`
	UserInfo            model.UserInfo `json:"userInfo"`
	ValidSubmissions    int            `json:"validSubmissions"`
	RequiredSubmissions int            `json:"requiredSubmissions"`
	Attempts            int            `json:"attempts"`
	Status              string         `json:"status"`
}
type RecruitmentSubmission struct {
	ID                int64  `json:"id"`
	Title             string `json:"title"`
	Submitter         string `json:"submitter"`
	Status            string `json:"status"`
	Approvals         int    `json:"approvals"`
	RequiredApprovals int    `json:"requiredApprovals"`
	Revisions         int    `json:"revisions"`
}
type RecruitmentReviewProgress struct {
	Conditions          RecruitmentConditions `json:"conditions"`
	Approvals           int                   `json:"approvals"`
	RequiredApprovals   int                   `json:"requiredApprovals"`
	Revisions           int                   `json:"revisions"`
	ValidSubmissions    int                   `json:"validSubmissions"`
	RequiredSubmissions int                   `json:"requiredSubmissions"`
	Status              string                `json:"status"`
}
type RecruitmentDashboard struct {
	Active      *RecruitmentPlan        `json:"active"`
	History     []RecruitmentPlan       `json:"history"`
	Members     []RecruitmentMember     `json:"members"`
	Submissions []RecruitmentSubmission `json:"submissions"`
	Team        []model.UserInfo        `json:"team"`
}

// RecruitmentNotifier 招募完成通知（站内信/邮件由 NotificationService 实现）。
type RecruitmentNotifier interface {
	NotifyRecruitmentCompleted(ctx context.Context, user model.UserInfo, sub *model.Submission) error
}

type ReviewerRecruitmentService struct {
	repo      *repository.ReviewerRecruitmentRepo
	reviewers *repository.ReviewerRepo
	users     *UserSearchService
	notifier  RecruitmentNotifier
	hub       *ws.Hub

	teamMu      sync.Mutex
	teamCache   []model.UserInfo
	teamCacheAt time.Time
}

func NewReviewerRecruitmentService(repo *repository.ReviewerRecruitmentRepo) *ReviewerRecruitmentService {
	return &ReviewerRecruitmentService{repo: repo}
}

// SetTeamSources 注入审核团队与用户资料来源，用于仪表板的「当前审核团队」。
func (s *ReviewerRecruitmentService) SetTeamSources(
	reviewers *repository.ReviewerRepo,
	users *UserSearchService,
) {
	s.reviewers = reviewers
	s.users = users
}

// SetNotifier 注入招募完成通知。
func (s *ReviewerRecruitmentService) SetNotifier(n RecruitmentNotifier) { s.notifier = n }

// SetHub 注入 WebSocket hub，用于招募状态变更的实时失效通知。
func (s *ReviewerRecruitmentService) SetHub(hub *ws.Hub) { s.hub = hub }

// NotifyChanged 广播招募变更；只发失效信号，客户端收到后重新拉取。
func (s *ReviewerRecruitmentService) NotifyChanged(ctx context.Context) {
	if s.hub == nil {
		return
	}
	if err := s.hub.PublishRecruitmentChanged(ctx, nil); err != nil {
		logrus.WithError(err).Warn("publish recruitment changed failed")
	}
}

var recruitmentZone = time.FixedZone("Asia/Shanghai", 8*60*60)

// 审核团队资料缓存时长：新增/移除审核员后最多延迟这么久反映到仪表板。
const teamCacheTTL = 5 * time.Minute

// 招募可选的投稿语言；投稿语言不在前四项时统一归入 others。
var (
	recruitmentAllowedLanguages    = []string{"zh", "en", "ja", "ko", "others"}
	recruitmentSubmissionLanguages = []string{"zh", "en", "ja", "ko"}
)

func recruitmentToday() string { return time.Now().In(recruitmentZone).Format("2006-01-02") }
func recruitmentDate(s string) string {
	if len(s) > 10 {
		return s[:10]
	}
	return s
}
func recruitmentForm(plan *model.ReviewerRecruitment) RecruitmentInput {
	var f RecruitmentInput
	b, _ := json.Marshal(plan.FormData)
	_ = json.Unmarshal(b, &f)
	f.ID = plan.ID
	return f
}
func decodeRecruitment(m *model.ReviewerRecruitmentMember) recruitmentProgress {
	var p recruitmentProgress
	b, _ := json.Marshal(m.Progress)
	_ = json.Unmarshal(b, &p)
	return p
}
func encodeRecruitment(p recruitmentProgress) model.JSONObject {
	b, _ := json.Marshal(p)
	var data model.JSONObject
	_ = json.Unmarshal(b, &data)
	return data
}
func recruitmentEndDue(p *model.ReviewerRecruitment) bool {
	return p.EndsOn != nil && recruitmentDate(*p.EndsOn) <= recruitmentToday() ||
		p.TargetMembers > 0 && p.CompletedCount >= p.TargetMembers
}
func endRecruitment(tx *gorm.DB, p *model.ReviewerRecruitment) (bool, error) {
	if !recruitmentEndDue(p) {
		return false, nil
	}
	today := recruitmentToday()
	p.Status = "ended"
	p.EndedOn = &today
	if err := tx.Model(p).Updates(map[string]any{"status": "ended", "ended_on": today}).Error; err != nil {
		return false, err
	}
	return true, nil
}
func (s *ReviewerRecruitmentService) activeChanged(tx *gorm.DB) (*model.ReviewerRecruitment, bool, error) {
	p, err := s.repo.Active(tx)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	ended, err := endRecruitment(tx, p)
	if err != nil {
		return nil, false, err
	}
	if ended {
		return nil, true, nil
	}
	return p, false, nil
}
func (s *ReviewerRecruitmentService) active(tx *gorm.DB) (*model.ReviewerRecruitment, error) {
	p, _, err := s.activeChanged(tx)
	return p, err
}
func (s *ReviewerRecruitmentService) Tick(ctx context.Context) error {
	changed := false
	err := s.repo.Transaction(ctx, func(tx *gorm.DB) error {
		var e error
		_, changed, e = s.activeChanged(tx)
		return e
	})
	if err != nil {
		return err
	}
	if changed {
		s.NotifyChanged(ctx)
	}
	return nil
}
func (s *ReviewerRecruitmentService) Create(ctx context.Context, user string, in RecruitmentInput) (*RecruitmentPlan, error) {
	parsed, err := uuid.Parse(in.ID)
	if err != nil || parsed.Version() != 4 {
		return nil, invalidInput("招募 ID 必须为 UUID v4")
	}
	in.ID = parsed.String()
	in.Announcement = strings.TrimSpace(in.Announcement)
	if in.Announcement == "" || len([]rune(in.Announcement)) > 10000 || len(in.Languages) == 0 || len(in.Languages) > model.MaxLanguages {
		return nil, invalidInput("请填写公告并选择投稿语言")
	}
	for _, l := range in.Languages {
		if !slices.Contains(recruitmentAllowedLanguages, l) {
			return nil, invalidInput("投稿语言无效")
		}
	}
	c := in.Conditions
	for _, n := range []int{c.ValidSubmissions, c.ApprovalsPerSubmission, c.SubmissionsPerLanguage, c.MaxAttempts} {
		if n < 1 || n > 1000000 {
			return nil, invalidInput("招募计数须为 1 到 1000000 的整数")
		}
	}
	if c.RevisionsPerSubmission < 0 || c.RevisionsPerSubmission > 1000000 || in.TargetMembers < 0 || in.TargetMembers > 1000000 {
		return nil, ErrInvalidInput
	}
	if in.EndsOn == "" && in.TargetMembers == 0 {
		return nil, invalidInput("请设置结束日期或招募人数")
	}
	if in.EndsOn != "" {
		if _, e := time.Parse("2006-01-02", in.EndsOn); e != nil || in.EndsOn <= recruitmentToday() {
			return nil, invalidInput("结束日期必须晚于今天（于当日 0 时结束）")
		}
	}
	var out *RecruitmentPlan
	err = s.repo.Transaction(ctx, func(tx *gorm.DB) error {
		var existing model.ReviewerRecruitment
		if e := tx.First(&existing, "id = ?", in.ID).Error; e == nil {
			if existing.CreatedBy != user {
				return ErrForbidden
			}
			out = s.planDTO(&existing, 0)
			return nil
		} else if !errors.Is(e, gorm.ErrRecordNotFound) {
			return e
		}
		p, e := s.active(tx)
		if e != nil {
			return e
		}
		if p != nil {
			return invalidInput("已有进行中的招募")
		}
		b, _ := json.Marshal(in)
		var form model.JSONObject
		_ = json.Unmarshal(b, &form)
		record := model.ReviewerRecruitment{ID: in.ID, FormData: form, StartsOn: recruitmentToday(), TargetMembers: in.TargetMembers, Status: "active", CreatedBy: user}
		if in.EndsOn != "" {
			record.EndsOn = &in.EndsOn
		}
		if e := tx.Create(&record).Error; e != nil {
			return e
		}
		out = s.planDTO(&record, 0)
		return nil
	})
	if err == nil && out != nil {
		s.NotifyChanged(ctx)
	}
	return out, err
}
func (s *ReviewerRecruitmentService) planDTO(p *model.ReviewerRecruitment, count int) *RecruitmentPlan {
	out := &RecruitmentPlan{RecruitmentInput: recruitmentForm(p), StartsOn: recruitmentDate(p.StartsOn), EndedOn: p.EndedOn, CreatedAt: p.CreatedAt, Status: p.Status, ParticipantCount: count, CompletedCount: p.CompletedCount}
	if p.Status == "active" {
		near := p.TargetMembers > 0 && p.TargetMembers-p.CompletedCount <= 2
		if p.EndsOn != nil {
			end, e := time.ParseInLocation("2006-01-02", recruitmentDate(*p.EndsOn), recruitmentZone)
			if e == nil && time.Until(end) <= 24*time.Hour {
				near = true
			}
		}
		if near {
			out.Status = "ending"
		}
	}
	return out
}
func (s *ReviewerRecruitmentService) Active(ctx context.Context) (*RecruitmentPlan, error) {
	var out *RecruitmentPlan
	ended := false
	err := s.repo.Transaction(ctx, func(tx *gorm.DB) error {
		p, wasEnded, e := s.activeChanged(tx)
		ended = wasEnded
		if e != nil || p == nil {
			return e
		}
		var count int64
		if e = tx.Model(&model.ReviewerRecruitmentMember{}).Where("recruitment_id = ?", p.ID).Count(&count).Error; e != nil {
			return e
		}
		out = s.planDTO(p, int(count))
		return nil
	})
	if err == nil && ended {
		s.NotifyChanged(ctx)
	}
	return out, err
}
func recruitmentMemberDTO(m *model.ReviewerRecruitmentMember, p recruitmentProgress, c RecruitmentConditions) RecruitmentMember {
	out := RecruitmentMember{Username: m.Username, UserInfo: m.UserInfo, RequiredSubmissions: c.ValidSubmissions, Status: "active"}
	languages := map[string]bool{}
	for _, sub := range p.Submissions {
		if sub.Penalized {
			out.Attempts++
		}
		if sub.Approved {
			out.ValidSubmissions++
			for _, l := range sub.Languages {
				languages[l] = true
			}
		}
	}
	if len(languages) < 2 {
		out.RequiredSubmissions = max(out.RequiredSubmissions, c.SubmissionsPerLanguage)
	}
	out.RequiredSubmissions += out.Attempts
	if p.Completed {
		out.Status = "completed"
	}
	return out
}
func (s *ReviewerRecruitmentService) Me(ctx context.Context, user string) (*RecruitmentMember, error) {
	var out *RecruitmentMember
	ended := false
	err := s.repo.Transaction(ctx, func(tx *gorm.DB) error {
		plan, wasEnded, e := s.activeChanged(tx)
		ended = wasEnded
		if e != nil || plan == nil {
			return e
		}
		var m model.ReviewerRecruitmentMember
		e = tx.Where("recruitment_id = ? AND username = ?", plan.ID, user).First(&m).Error
		if errors.Is(e, gorm.ErrRecordNotFound) {
			return nil
		}
		if e != nil {
			return e
		}
		dto := recruitmentMemberDTO(&m, decodeRecruitment(&m), recruitmentForm(plan).Conditions)
		out = &dto
		return nil
	})
	if err == nil && ended {
		s.NotifyChanged(ctx)
	}
	return out, err
}
func (s *ReviewerRecruitmentService) Exit(ctx context.Context, user string) error {
	err := s.repo.Transaction(ctx, func(tx *gorm.DB) error {
		p, e := s.active(tx)
		if e != nil {
			return e
		}
		if p == nil {
			return nil
		}
		return tx.Where("recruitment_id = ? AND username = ?", p.ID, user).Delete(&model.ReviewerRecruitmentMember{}).Error
	})
	if err == nil {
		s.NotifyChanged(ctx)
	}
	return err
}
func recruitmentTagged(tags []string) bool {
	return slices.Contains(tags, model.RecruitmentTag)
}
func recruitmentVersion(sub *model.Submission) string {
	if sub.FileUpdatedAt != nil {
		return sub.FileUpdatedAt.UTC().Format(time.RFC3339Nano)
	}
	return sub.CreatedAt.UTC().Format(time.RFC3339Nano)
}

// Enroll runs inside the submission transaction; drafts never create participation records.
// 返回值表示是否新增了报名记录，供事务提交后广播变更。
func (s *ReviewerRecruitmentService) Enroll(tx *gorm.DB, sub *model.Submission) (bool, error) {
	if !recruitmentTagged(sub.Tags) {
		return false, nil
	}
	if err := s.repo.Lock(tx); err != nil {
		return false, err
	}
	p, err := s.active(tx)
	if err != nil {
		return false, err
	}
	if p == nil {
		return false, invalidInput("当前没有进行中的审核招募")
	}
	if sub.SubmissionType != model.SubmissionTypeNew {
		return false, invalidInput("审核招募只接受新歌词提交")
	}
	form := recruitmentForm(p)
	for _, l := range sub.Languages {
		code := l
		if !slices.Contains(recruitmentSubmissionLanguages, code) {
			code = "others"
		}
		if !slices.Contains(form.Languages, code) {
			return false, invalidInput("投稿语言不符合本期招募条件")
		}
	}
	if sub.Status == model.StatusDraft {
		return false, nil
	}
	var m model.ReviewerRecruitmentMember
	err = tx.Where("recruitment_id = ? AND username = ?", p.ID, sub.Submitter).First(&m).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return false, err
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		m = model.ReviewerRecruitmentMember{RecruitmentID: p.ID, Username: sub.Submitter, UserInfo: sub.SubmitterInfo, JoinedAt: time.Now()}
	}
	progress := decodeRecruitment(&m)
	if progress.Completed {
		return false, invalidInput("你已完成本期招募")
	}
	for _, item := range progress.Submissions {
		if item.ID == sub.ID {
			return false, nil
		}
	}
	progress.Submissions = append(progress.Submissions, recruitmentSubmission{ID: sub.ID, Version: recruitmentVersion(sub), Approvers: []string{}, Languages: sub.Languages})
	m.Progress = encodeRecruitment(progress)
	if err := tx.Save(&m).Error; err != nil {
		return false, err
	}
	return true, nil
}

// locate uses the submission IDs stored with this enrollment, so withdrawn and previous attempts never count again.
func (s *ReviewerRecruitmentService) locate(tx *gorm.DB, sub *model.Submission) (*model.ReviewerRecruitment, *model.ReviewerRecruitmentMember, recruitmentProgress, int, error) {
	var m model.ReviewerRecruitmentMember
	err := tx.Where("username = ? AND progress @> ?::jsonb", sub.Submitter, fmt.Sprintf(`{"submissions":[{"id":%d}]}`, sub.ID)).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, recruitmentProgress{}, -1, nil
	}
	if err != nil {
		return nil, nil, recruitmentProgress{}, -1, err
	}
	var plan model.ReviewerRecruitment
	if err = tx.First(&plan, "id = ?", m.RecruitmentID).Error; err != nil {
		return nil, nil, recruitmentProgress{}, -1, err
	}
	progress := decodeRecruitment(&m)
	for i, item := range progress.Submissions {
		if item.ID == sub.ID {
			return &plan, &m, progress, i, nil
		}
	}
	return nil, nil, progress, -1, nil
}
func (s *ReviewerRecruitmentService) Progress(ctx context.Context, id int64, user string, staff bool) (*RecruitmentReviewProgress, error) {
	var sub model.Submission
	if err := s.repo.DB.WithContext(ctx).First(&sub, id).Error; err != nil {
		return nil, err
	}
	if !staff && sub.Submitter != user {
		return nil, ErrForbidden
	}
	plan, m, p, index, err := s.locate(s.repo.DB.WithContext(ctx), &sub)
	if err != nil || m == nil {
		return nil, err
	}
	item := p.Submissions[index]
	if item.Version != recruitmentVersion(&sub) {
		item.Approvers = nil
	}
	c := recruitmentForm(plan).Conditions
	dto := recruitmentMemberDTO(m, p, c)
	return &RecruitmentReviewProgress{Conditions: c, Approvals: len(item.Approvers), RequiredApprovals: c.ApprovalsPerSubmission, Revisions: item.Revisions, ValidSubmissions: dto.ValidSubmissions, RequiredSubmissions: dto.RequiredSubmissions, Status: dto.Status}, nil
}

// Accept records distinct reviewers for this file version, then uses the normal publication path.
// A transaction advisory lock covers that path as well, preventing withdrawal or another vote racing publication.
func (s *ReviewerRecruitmentService) Accept(ctx context.Context, user *SubmissionUser, id int64, comment string, publish func(*gorm.DB, *model.Submission) error) (bool, error) {
	handled := false
	var publishErr error
	var completedUser *model.UserInfo
	var completedSub *model.Submission
	err := s.repo.Transaction(ctx, func(tx *gorm.DB) error {
		var sub model.Submission
		if e := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&sub, id).Error; e != nil {
			return e
		}
		plan, m, p, index, e := s.locate(tx, &sub)
		if e != nil || m == nil {
			return e
		}
		handled = true
		if user.Name == sub.Submitter {
			return ErrForbidden
		}
		if !slices.Contains([]string{model.StatusPending, model.StatusReviewing}, sub.Status) {
			return ErrInvalidStatus
		}
		item := &p.Submissions[index]
		version := recruitmentVersion(&sub)
		if item.Version != version {
			item.Version = version
			item.Approvers = []string{}
		}
		if slices.Contains(item.Approvers, user.Name) {
			return nil
		}
		item.Approvers = append(item.Approvers, user.Name)
		c := recruitmentForm(plan).Conditions
		if len(item.Approvers) < c.ApprovalsPerSubmission {
			m.Progress = encodeRecruitment(p)
			if e = tx.Save(m).Error; e != nil {
				return e
			}
			if e = tx.Model(&sub).Updates(map[string]any{"status": model.StatusPending, "reviewer": "", "reviewer_info": nil, "review_lease_at": nil}).Error; e != nil {
				return e
			}
			return tx.Create(&model.ReviewHistory{SubmissionID: id, Reviewer: user.Name, ReviewerInfo: model.UserInfo{Username: user.Name, DisplayName: user.DisplayName, Avatar: user.Avatar}, Status: "accepted", Comment: comment}).Error
		}
		// Publish on this transaction connection: state claim and counters roll back together on failure.
		if e = publish(tx, &sub); e != nil {
			if !errors.Is(e, ErrApproveNeedsManualFix) {
				return e
			}
			// GitHub has already accepted the file. Commit the approved state
			// and counters, while still surfacing the storage repair error.
			publishErr = e
		}
		item.Approved = true
		item.Languages = sub.Languages
		dto := recruitmentMemberDTO(m, p, c)
		if !p.Completed && dto.ValidSubmissions >= dto.RequiredSubmissions {
			p.Completed = true
			plan.CompletedCount++
			if e = tx.Model(plan).Update("completed_count", plan.CompletedCount).Error; e != nil {
				return e
			}
			userInfo := m.UserInfo
			completedUser = &userInfo
			subCopy := sub
			completedSub = &subCopy
		}
		m.Progress = encodeRecruitment(p)
		if e = tx.Save(m).Error; e != nil {
			return e
		}
		_, e = s.active(tx)
		return e
	})
	if err != nil {
		return handled, err
	}
	if handled {
		s.NotifyChanged(ctx)
	}
	if completedUser != nil && completedSub != nil && s.notifier != nil {
		if e := s.notifier.NotifyRecruitmentCompleted(ctx, *completedUser, completedSub); e != nil {
			logrus.WithError(e).WithField("submission_id", completedSub.ID).Warn("notify recruitment completed failed")
		}
	}
	return handled, publishErr
}

// RecordCorrections belongs to the transaction that stores the review conclusion/report.
func (s *ReviewerRecruitmentService) RecordCorrections(db *gorm.DB, sub *model.Submission, count int) error {
	if count <= 0 {
		return nil
	}
	// 单独开启事务，保证 advisory lock 覆盖读改写；调用方在事务提交后再广播。
	return db.Transaction(func(tx *gorm.DB) error {
		if err := s.repo.Lock(tx); err != nil {
			return err
		}
		plan, m, p, index, err := s.locate(tx, sub)
		if err != nil || m == nil {
			return err
		}
		item := &p.Submissions[index]
		item.Revisions += count
		item.Approvers = []string{}
		c := recruitmentForm(plan).Conditions
		if item.Revisions > c.RevisionsPerSubmission && !item.Penalized {
			item.Penalized = true
		}
		dto := recruitmentMemberDTO(m, p, c)
		// maxAttempts limits the escalating base requirement; the optional single-language standard is not an entry barrier.
		if c.ValidSubmissions+dto.Attempts > c.MaxAttempts {
			return tx.Delete(m).Error
		}
		m.Progress = encodeRecruitment(p)
		return tx.Save(m).Error
	})
}
func recruitmentCorrectionCount(structured map[string]any, comment string) int {
	count := 0
	report, _ := structured["reviewReport"].(map[string]any)
	blocks, _ := report["blocks"].([]any)
	for _, raw := range blocks {
		block, ok := raw.(map[string]any)
		if !ok || block["enabled"] == false {
			continue
		}
		if changes, ok := block["changes"].([]any); ok {
			for _, rawChange := range changes {
				change, ok := rawChange.(map[string]any)
				if ok && change["enabled"] != false {
					count++
				}
			}
		} else {
			count++
		}
	}
	if count == 0 && strings.TrimSpace(comment) != "" {
		count = 1
	}
	return count
}
func (s *ReviewerRecruitmentService) Dashboard(ctx context.Context) (*RecruitmentDashboard, error) {
	out := &RecruitmentDashboard{History: []RecruitmentPlan{}, Members: []RecruitmentMember{}, Submissions: []RecruitmentSubmission{}, Team: []model.UserInfo{}}
	ended := false
	err := s.repo.Transaction(ctx, func(tx *gorm.DB) error {
		active, wasEnded, e := s.activeChanged(tx)
		ended = wasEnded
		if e != nil {
			return e
		}
		var plans []model.ReviewerRecruitment
		if e = tx.Order("created_at DESC").Limit(100).Find(&plans).Error; e != nil {
			return e
		}
		for i := range plans {
			p := &plans[i]
			var members []model.ReviewerRecruitmentMember
			if e = tx.Where("recruitment_id = ?", p.ID).Find(&members).Error; e != nil {
				return e
			}
			dto := s.planDTO(p, len(members))
			if active == nil || p.ID != active.ID {
				out.History = append(out.History, *dto)
				continue
			}
			out.Active = dto
			c := recruitmentForm(p).Conditions
			var pending []recruitmentSubmission
			for j := range members {
				m := &members[j]
				progress := decodeRecruitment(m)
				out.Members = append(out.Members, recruitmentMemberDTO(m, progress, c))
				pending = append(pending, progress.Submissions...)
			}
			if len(pending) == 0 {
				continue
			}
			ids := make([]int64, 0, len(pending))
			for _, item := range pending {
				ids = append(ids, item.ID)
			}
			var subs []model.Submission
			if e = tx.Where("id IN ?", ids).Find(&subs).Error; e != nil {
				return e
			}
			byID := make(map[int64]model.Submission, len(subs))
			for _, sub := range subs {
				byID[sub.ID] = sub
			}
			for _, item := range pending {
				sub, ok := byID[item.ID]
				if !ok {
					continue
				}
				approvals := len(item.Approvers)
				if item.Version != recruitmentVersion(&sub) {
					approvals = 0
				}
				out.Submissions = append(out.Submissions, RecruitmentSubmission{ID: sub.ID, Title: sub.Title, Submitter: sub.Submitter, Status: sub.Status, Approvals: approvals, RequiredApprovals: c.ApprovalsPerSubmission, Revisions: item.Revisions})
			}
		}
		return nil
	})
	if err == nil {
		s.fillTeam(ctx, out)
	}
	if err == nil && ended {
		s.NotifyChanged(ctx)
	}
	return out, err
}

// fillTeam 填充「当前审核团队」
func (s *ReviewerRecruitmentService) fillTeam(ctx context.Context, out *RecruitmentDashboard) {
	if s.reviewers == nil {
		return
	}
	s.teamMu.Lock()
	if !s.teamCacheAt.IsZero() && time.Since(s.teamCacheAt) < teamCacheTTL {
		out.Team = append(out.Team, s.teamCache...)
		s.teamMu.Unlock()
		return
	}
	s.teamMu.Unlock()

	names, err := s.reviewers.ListAll(ctx)
	if err != nil {
		logrus.WithError(err).Warn("list reviewers for recruitment dashboard failed")
		return
	}
	infos := map[string]UserSearchItem{}
	if s.users != nil {
		infos = s.users.GetInfos(ctx, names)
	}
	team := make([]model.UserInfo, 0, len(names))
	for _, name := range names {
		info := infos[name]
		team = append(team, model.UserInfo{
			Username:    name,
			DisplayName: info.DisplayName,
			Avatar:      info.Avatar,
		})
	}
	s.teamMu.Lock()
	s.teamCache = append([]model.UserInfo(nil), team...)
	s.teamCacheAt = time.Now()
	s.teamMu.Unlock()
	out.Team = append(out.Team, team...)
}
