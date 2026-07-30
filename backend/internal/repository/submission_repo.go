package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// SubmissionRepo 投稿数据访问层
type SubmissionRepo struct {
	db *gorm.DB
}

func NewSubmissionRepo(db *gorm.DB) *SubmissionRepo {
	return &SubmissionRepo{db: db}
}

// Create 创建投稿（在事务中调用）
func (r *SubmissionRepo) Create(ctx context.Context, tx *gorm.DB, s *model.Submission) error {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	return tx.WithContext(ctx).Create(s).Error
}

// GetByID 查询投稿详情
func (r *SubmissionRepo) GetByID(ctx context.Context, id int64) (*model.Submission, error) {
	var s model.Submission
	if err := r.db.WithContext(ctx).First(&s, id).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

// GetByIDForUpdate 加锁查询（事务内）
func (r *SubmissionRepo) GetByIDForUpdate(ctx context.Context, tx *gorm.DB, id int64) (*model.Submission, error) {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	var s model.Submission
	if err := tx.WithContext(ctx).
		Set("gorm:query_option", "FOR UPDATE").
		First(&s, id).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

// UpdateStatus 更新投稿状态（事务内）
func (r *SubmissionRepo) UpdateStatus(ctx context.Context, tx *gorm.DB, s *model.Submission) error {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	return tx.WithContext(ctx).Model(&model.Submission{}).
		Where("id = ?", s.ID).
		Updates(map[string]interface{}{
			"status":                s.Status,
			"reviewer":              s.Reviewer,
			"reviewed_at":           s.ReviewedAt,
			"review_comment":        s.ReviewComment,
			"revision_requested_at": s.RevisionRequestedAt,
			"closed_at":             s.ClosedAt,
			"closed_by":             s.ClosedBy,
			"closed_by_info":        s.ClosedByInfo,
			"file_updated_at":       s.FileUpdatedAt,
		}).Error
}

// UpdateFile 更新投稿文件（need_revision → pending）
func (r *SubmissionRepo) UpdateFile(ctx context.Context, tx *gorm.DB, id int64, fileName string, metadata *model.Submission) error {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	updates := map[string]interface{}{
		"file_name":       fileName,
		"file_updated_at": time.Now(),
		"status":          model.StatusPending,
	}
	if metadata != nil {
		updates["title"] = metadata.Title
		updates["artist"] = metadata.Artist
		updates["album"] = metadata.Album
		updates["ncm_id"] = metadata.NcmID
		updates["qq_id"] = metadata.QqID
		updates["am_id"] = metadata.AmID
		updates["spotify_id"] = metadata.SpotifyID
		updates["notes"] = metadata.Notes
		updates["tags"] = metadata.Tags
		updates["metadata"] = metadata.Metadata
		updates["language"] = metadata.Language
	}
	return tx.WithContext(ctx).Model(&model.Submission{}).
		Where("id = ?", id).
		Updates(updates).Error
}

// Close 关闭投稿
func (r *SubmissionRepo) Close(ctx context.Context, tx *gorm.DB, id int64, closedBy string, closedByInfo *model.UserInfo) error {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	return tx.WithContext(ctx).Model(&model.Submission{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"status":         model.StatusClosed,
			"closed_at":      time.Now(),
			"closed_by":      closedBy,
			"closed_by_info": closedByInfo,
		}).Error
}

// ListQuery 列表查询参数
type ListQuery struct {
	Mode     string // review / square / creator
	Status   string // all / pending / processing / rejected / approved / need_revision / missing_audio
	Language string // others / ja / zh / en / ko
	Search   string
	Page     int
	Limit    int
	// Submitter 仅 creator 模式有效，限定投稿人
	Submitter string
}

// ListResult 列表查询结果
type ListResult struct {
	Total int64
	Items []model.Submission
}

// List 列表查询
//
// processing 在原 JS 实现中是 pending+reviewing+need_revision+missing_audio 的合集
func (r *SubmissionRepo) List(ctx context.Context, q ListQuery) (*ListResult, error) {
	if q.Page < 1 {
		q.Page = 1
	}
	if q.Limit < 1 {
		q.Limit = 50
	}
	if q.Limit > 500 {
		q.Limit = 500
	}

	db := r.db.WithContext(ctx).Model(&model.Submission{})

	switch q.Mode {
	case "creator":
		// 创作中心：仅返回当前用户自己的投稿
		if q.Submitter == "" {
			return &ListResult{Items: []model.Submission{}}, nil
		}
		db = db.Where("submitter = ?", q.Submitter)
	case "square":
		// 广场：返回除 draft 外的可见投稿
		db = db.Where("status <> ?", model.StatusDraft)
	case "review":
		// 审核中心：返回所有非 draft 投稿
		db = db.Where("status <> ?", model.StatusDraft)
	default:
		// 默认 creator 行为
		if q.Submitter == "" {
			return &ListResult{Items: []model.Submission{}}, nil
		}
		db = db.Where("submitter = ?", q.Submitter)
	}

	if q.Status != "" && q.Status != "all" {
		if q.Status == "processing" {
			db = db.Where("status IN ?", []string{
				model.StatusPending,
				model.StatusReviewing,
				model.StatusNeedRevision,
				model.StatusMissingAudio,
			})
		} else {
			db = db.Where("status = ?", q.Status)
		}
	}

	if q.Language != "" && q.Language != "others" {
		db = db.Where("language = ?", q.Language)
	}

	if q.Search != "" {
		// 使用 GIN 索引的 to_tsvector 全文搜索
		db = db.Where(
			"to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(artist,'') || ' ' || coalesce(album,'') || ' ' || coalesce(submitter,'')) @@ plainto_tsquery('simple', ?)",
			q.Search,
		)
	}

	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, err
	}

	var items []model.Submission
	if err := db.
		Order("created_at DESC").
		Offset((q.Page - 1) * q.Limit).
		Limit(q.Limit).
		Find(&items).Error; err != nil {
		return nil, err
	}

	return &ListResult{Total: total, Items: items}, nil
}

// Stats 各状态计数
type Stats struct {
	Pending      int64 `json:"pending"`
	Reviewing    int64 `json:"reviewing"`
	Approved     int64 `json:"approved"`
	Rejected     int64 `json:"rejected"`
	NeedRevision int64 `json:"needRevision"`
	MissingAudio int64 `json:"missingAudio"`
	Closed       int64 `json:"closed"`
	Draft        int64 `json:"draft"`
}

func (r *SubmissionRepo) Stats(ctx context.Context, submitter string) (*Stats, error) {
	type row struct {
		Status string
		Cnt    int64
	}
	var rows []row
	db := r.db.WithContext(ctx).Model(&model.Submission{}).
		Select("status, COUNT(*) AS cnt").
		Group("status")
	if submitter != "" {
		db = db.Where("submitter = ?", submitter)
	}
	if err := db.Scan(&rows).Error; err != nil {
		return nil, err
	}
	stats := &Stats{}
	for i := range rows {
		switch rows[i].Status {
		case model.StatusPending:
			stats.Pending = rows[i].Cnt
		case model.StatusReviewing:
			stats.Reviewing = rows[i].Cnt
		case model.StatusApproved:
			stats.Approved = rows[i].Cnt
		case model.StatusRejected:
			stats.Rejected = rows[i].Cnt
		case model.StatusNeedRevision:
			stats.NeedRevision = rows[i].Cnt
		case model.StatusMissingAudio:
			stats.MissingAudio = rows[i].Cnt
		case model.StatusClosed:
			stats.Closed = rows[i].Cnt
		case model.StatusDraft:
			stats.Draft = rows[i].Cnt
		}
	}
	return stats, nil
}

// ListNeedRevisionOverdue 查询 need_revision 且超过 cutoff 的投稿
func (r *SubmissionRepo) ListNeedRevisionOverdue(ctx context.Context, cutoff time.Time, limit int) ([]model.Submission, error) {
	if limit <= 0 {
		limit = 500
	}
	var items []model.Submission
	err := r.db.WithContext(ctx).
		Where("status = ? AND revision_requested_at < ?", model.StatusNeedRevision, cutoff).
		Order("revision_requested_at ASC").
		Limit(limit).
		Find(&items).Error
	return items, err
}

// AutoReject 系统自动拒绝（事务内更新 + 返回受影响记录）
func (r *SubmissionRepo) AutoReject(ctx context.Context, tx *gorm.DB, cutoff time.Time) ([]model.Submission, error) {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	var items []model.Submission
	// 使用 RETURNING 拿到被更新的记录，便于后续插入审核历史与删除文件
	err := tx.WithContext(ctx).
		Table("submissions").
		Where("status = ? AND revision_requested_at < ?", model.StatusNeedRevision, cutoff).
		Updates(map[string]interface{}{
			"status":         model.StatusRejected,
			"reviewer":       "system",
			"reviewed_at":    time.Now(),
			"review_comment": gorm.Expr("COALESCE(review_comment,'') || E'\n[系统自动处理] 超过4天未修改，自动拒绝。'"),
		}).
		Clauses(clause.Returning{}).
		Scan(&items).Error
	return items, err
}

// ReviewHistoryRepo 审核历史
type ReviewHistoryRepo struct {
	db *gorm.DB
}

func NewReviewHistoryRepo(db *gorm.DB) *ReviewHistoryRepo {
	return &ReviewHistoryRepo{db: db}
}

// ListBySubmission 按时间倒序返回投稿的审核历史
func (r *ReviewHistoryRepo) ListBySubmission(ctx context.Context, submissionID int64) ([]model.ReviewHistory, error) {
	var items []model.ReviewHistory
	err := r.db.WithContext(ctx).
		Where("submission_id = ?", submissionID).
		Order("reviewed_at DESC").
		Find(&items).Error
	return items, err
}

// Insert 插入审核历史（事务内）
func (r *ReviewHistoryRepo) Insert(ctx context.Context, tx *gorm.DB, h *model.ReviewHistory) error {
	if tx == nil {
		tx = r.db.WithContext(ctx)
	}
	return tx.WithContext(ctx).Create(h).Error
}

// CommentRepo 评论
type CommentRepo struct {
	db *gorm.DB
}

func NewCommentRepo(db *gorm.DB) *CommentRepo {
	return &CommentRepo{db: db}
}

// ListBySubmission 按时间正序返回评论
func (r *CommentRepo) ListBySubmission(ctx context.Context, submissionID int64) ([]model.Comment, error) {
	var items []model.Comment
	err := r.db.WithContext(ctx).
		Where("submission_id = ?", submissionID).
		Order("created_at ASC").
		Find(&items).Error
	return items, err
}

// Insert 插入评论
func (r *CommentRepo) Insert(ctx context.Context, c *model.Comment) error {
	return r.db.WithContext(ctx).Create(c).Error
}

// AudioRepo 音频附件
type AudioRepo struct {
	db *gorm.DB
}

func NewAudioRepo(db *gorm.DB) *AudioRepo {
	return &AudioRepo{db: db}
}

// GetBySubmissionID 查询投稿的音频
func (r *AudioRepo) GetBySubmissionID(ctx context.Context, submissionID int64) (*model.SubmissionAudio, error) {
	var a model.SubmissionAudio
	if err := r.db.WithContext(ctx).Where("submission_id = ?", submissionID).First(&a).Error; err != nil {
		return nil, err
	}
	return &a, nil
}

// Upsert 创建或更新音频（每个投稿最多一个）
func (r *AudioRepo) Upsert(ctx context.Context, a *model.SubmissionAudio) error {
	// 优先尝试更新；不存在则插入
	res := r.db.WithContext(ctx).
		Model(&model.SubmissionAudio{}).
		Where("submission_id = ?", a.SubmissionID).
		Updates(map[string]interface{}{
			"file_name":   a.FileName,
			"cover_url":   a.CoverURL,
			"title":       a.Title,
			"artist":      a.Artist,
			"album":       a.Album,
			"platform":    a.Platform,
			"platform_id": a.PlatformID,
			"uploaded_by": a.UploadedBy,
			"uploaded_at": time.Now(),
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		return nil
	}
	return r.db.WithContext(ctx).Create(a).Error
}

// ReviewerRepo 审核员名单
type ReviewerRepo struct {
	db *gorm.DB
}

func NewReviewerRepo(db *gorm.DB) *ReviewerRepo {
	return &ReviewerRepo{db: db}
}

// ListAll 返回所有审核员用户名
func (r *ReviewerRepo) ListAll(ctx context.Context) ([]string, error) {
	var names []string
	err := r.db.WithContext(ctx).Model(&model.Reviewer{}).
		Pluck("username", &names).Error
	return names, err
}

// IsReviewer 判断是否审核员
func (r *ReviewerRepo) IsReviewer(ctx context.Context, username string) (bool, error) {
	if username == "" {
		return false, nil
	}
	var cnt int64
	err := r.db.WithContext(ctx).Model(&model.Reviewer{}).
		Where("username = ?", username).
		Count(&cnt).Error
	return cnt > 0, err
}

// Add 添加审核员
func (r *ReviewerRepo) Add(ctx context.Context, username string) error {
	if username == "" {
		return errors.New("username required")
	}
	rv := model.Reviewer{Username: username}
	// ON CONFLICT DO NOTHING
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&rv).Error
}

// Remove 移除审核员
func (r *ReviewerRepo) Remove(ctx context.Context, username string) error {
	return r.db.WithContext(ctx).
		Where("username = ?", username).
		Delete(&model.Reviewer{}).Error
}

// _ 防 fmt 未引用
var _ = fmt.Sprintf
