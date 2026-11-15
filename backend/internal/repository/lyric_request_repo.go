package repository

import (
	"context"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// LyricRequestRepo 歌词请愿数据访问
type LyricRequestRepo struct {
	db *gorm.DB
}

// NewLyricRequestRepo 创建 LyricRequestRepo
func NewLyricRequestRepo(db *gorm.DB) *LyricRequestRepo {
	return &LyricRequestRepo{db: db}
}

// LyricRequestFilter 列表筛选条件
type LyricRequestFilter struct {
	Status    string // pending / completed / 空=全部
	Keyword   string // 歌名 / 歌手 / 专辑模糊匹配
	Requester string // 只看某个用户发起的
	Sort      string // hot / latest
	Offset    int
	Limit     int
}

func (r *LyricRequestRepo) applyFilter(q *gorm.DB, f LyricRequestFilter) *gorm.DB {
	if f.Status != "" {
		q = q.Where("status = ?", f.Status)
	}
	if f.Requester != "" {
		q = q.Where("requester_name = ?", f.Requester)
	}
	if kw := strings.TrimSpace(f.Keyword); kw != "" {
		like := "%" + kw + "%"
		q = q.Where("(song_name ILIKE ? OR artist ILIKE ? OR album ILIKE ?)", like, like, like)
	}
	return q
}

// List 分页查询请愿列表，返回列表与总数
func (r *LyricRequestRepo) List(
	ctx context.Context, f LyricRequestFilter,
) ([]model.LyricRequest, int64, error) {
	var total int64
	countQ := r.applyFilter(r.db.WithContext(ctx).Model(&model.LyricRequest{}), f)
	if err := countQ.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.LyricRequest{}, 0, nil
	}

	order := "created_at DESC, id DESC"
	if f.Sort == "hot" {
		order = "support_count DESC, created_at DESC, id DESC"
	}

	var items []model.LyricRequest
	listQ := r.applyFilter(r.db.WithContext(ctx).Model(&model.LyricRequest{}), f).
		Order(order).
		Offset(f.Offset).
		Limit(f.Limit)
	if err := listQ.Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// Create 创建请愿
func (r *LyricRequestRepo) Create(ctx context.Context, req *model.LyricRequest) error {
	return r.db.WithContext(ctx).Create(req).Error
}

// GetByID 按 ID 查询
func (r *LyricRequestRepo) GetByID(ctx context.Context, id int64) (*model.LyricRequest, error) {
	var req model.LyricRequest
	if err := r.db.WithContext(ctx).First(&req, id).Error; err != nil {
		return nil, err
	}
	return &req, nil
}

// FindByPlatformIDs 按平台 ID 查找「完全同一首歌」的已存在请愿。
//
// 原实现把各平台列用 OR 连接（ncm_id = ? OR qq_id = ? ...），只要撞上
// 任意一个 ID 就取 id 最小的一条合并：在多平台 ID 场景下会把持有不同 ID
// 的两条记录串号，且本次补齐的 ID 静默丢失。这里改为：
//   - 各平台列用 AND 连接，要求已有记录在每个本次提供的 ID 上「兼容」：
//     要么相等，要么该列为 '0'/NULL（尚未登记，可被补齐）；
//   - 同时要求至少一个 ID 与已有记录精确相等，避免全 '0' 记录被误命中，
//     也确保不同歌（如 ncm 冲突）不会因某个 ID 偶然相同而串号。
//
// 命中后由 service 层把本次非 "0" 的 ID 写回，完成平台 ID 补齐。
// col 来自 platformIDs() 的固定列名白名单，非用户输入。
func (r *LyricRequestRepo) FindByPlatformIDs(
	ctx context.Context, ids map[string]string,
) (*model.LyricRequest, error) {
	if len(ids) == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	compat := make([]string, 0, len(ids))
	overlap := make([]string, 0, len(ids))
	compatArgs := make([]any, 0, len(ids))
	overlapArgs := make([]any, 0, len(ids))
	for col, val := range ids {
		compat = append(compat, "("+col+" = ? OR "+col+" = '0' OR "+col+" IS NULL)")
		compatArgs = append(compatArgs, val)
		overlap = append(overlap, col+" = ?")
		overlapArgs = append(overlapArgs, val)
	}
	args := append(compatArgs, overlapArgs...)
	where := "(" + strings.Join(compat, " AND ") + ") AND (" + strings.Join(overlap, " OR ") + ")"

	var req model.LyricRequest
	err := r.db.WithContext(ctx).
		Where(where, args...).
		Order("id ASC").
		First(&req).Error
	if err != nil {
		return nil, err
	}
	return &req, nil
}

// UpdateFields 按字段更新请愿
func (r *LyricRequestRepo) UpdateFields(
	ctx context.Context, id int64, fields map[string]any,
) error {
	if len(fields) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).
		Model(&model.LyricRequest{}).
		Where("id = ?", id).
		Updates(fields).Error
}

// Delete 删除请愿
func (r *LyricRequestRepo) Delete(ctx context.Context, id int64) error {
	return r.db.WithContext(ctx).Delete(&model.LyricRequest{}, id).Error
}

// SetStatus 更新状态
func (r *LyricRequestRepo) SetStatus(ctx context.Context, id int64, status string) error {
	return r.db.WithContext(ctx).
		Model(&model.LyricRequest{}).
		Where("id = ?", id).
		Updates(map[string]any{"status": status}).Error
}

// IncRequestCount 合并请愿时累加发起次数
func (r *LyricRequestRepo) IncRequestCount(ctx context.Context, id int64) error {
	return r.db.WithContext(ctx).
		Model(&model.LyricRequest{}).
		Where("id = ?", id).
		UpdateColumn("request_count", gorm.Expr("request_count + 1")).Error
}

// AddSupportIfAbsent 新增一条支持记录
func (r *LyricRequestRepo) AddSupportIfAbsent(
	ctx context.Context, requestID int64, userName string, info model.JSONObject,
) (bool, error) {
	inserted := false
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		support := &model.LyricRequestSupport{
			RequestID: requestID,
			UserName:  userName,
			UserInfo:  info,
		}
		res := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(support)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return nil
		}
		inserted = true
		return tx.Model(&model.LyricRequest{}).
			Where("id = ?", requestID).
			UpdateColumn("support_count", gorm.Expr("support_count + 1")).Error
	})
	return inserted, err
}

// ToggleSupport 切换支持状态，返回切换后的状态与最新支持数
func (r *LyricRequestRepo) ToggleSupport(
	ctx context.Context, requestID int64, userName string, info model.JSONObject,
) (bool, int, error) {
	supported := false
	count := 0
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		support := &model.LyricRequestSupport{
			RequestID: requestID,
			UserName:  userName,
			UserInfo:  info,
		}
		res := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(support)
		if res.Error != nil {
			return res.Error
		}

		delta := 0
		if res.RowsAffected > 0 {
			supported = true
			delta = 1
		} else {
			del := tx.Where("request_id = ? AND user_name = ?", requestID, userName).
				Delete(&model.LyricRequestSupport{})
			if del.Error != nil {
				return del.Error
			}
			if del.RowsAffected > 0 {
				delta = -1
			}
		}

		if delta != 0 {
			if err := tx.Model(&model.LyricRequest{}).
				Where("id = ?", requestID).
				UpdateColumn("support_count", gorm.Expr("GREATEST(support_count + ?, 0)", delta)).
				Error; err != nil {
				return err
			}
		}

		var fresh model.LyricRequest
		if err := tx.Select("support_count").First(&fresh, requestID).Error; err != nil {
			return err
		}
		count = fresh.SupportCount
		return nil
	})
	return supported, count, err
}

// ListSupports 批量取每个请愿的前 limitPer 条支持记录（按时间倒序）
func (r *LyricRequestRepo) ListSupports(
	ctx context.Context, requestIDs []int64, limitPer int,
) (map[int64][]model.LyricRequestSupport, error) {
	out := make(map[int64][]model.LyricRequestSupport, len(requestIDs))
	if len(requestIDs) == 0 {
		return out, nil
	}
	var rows []model.LyricRequestSupport
	err := r.db.WithContext(ctx).Raw(`
		SELECT id, request_id, user_name, user_info, created_at FROM (
			SELECT id, request_id, user_name, user_info, created_at,
			       ROW_NUMBER() OVER (PARTITION BY request_id ORDER BY created_at DESC) AS rn
			FROM lyric_request_supports
			WHERE request_id IN (?)
		) t WHERE rn <= ?
		ORDER BY request_id, created_at DESC`, requestIDs, limitPer).Scan(&rows).Error
	if err != nil {
		return out, err
	}
	for _, row := range rows {
		out[row.RequestID] = append(out[row.RequestID], row)
	}
	return out, nil
}

// SupportedRequestIDs 查询当前用户在这批请愿里已支持过哪些
func (r *LyricRequestRepo) SupportedRequestIDs(
	ctx context.Context, userName string, requestIDs []int64,
) (map[int64]bool, error) {
	out := make(map[int64]bool, len(requestIDs))
	if userName == "" || len(requestIDs) == 0 {
		return out, nil
	}
	var ids []int64
	err := r.db.WithContext(ctx).
		Model(&model.LyricRequestSupport{}).
		Where("user_name = ? AND request_id IN ?", userName, requestIDs).
		Pluck("request_id", &ids).Error
	if err != nil {
		return out, err
	}
	for _, id := range ids {
		out[id] = true
	}
	return out, nil
}

// CountComments 批量统计评论数
func (r *LyricRequestRepo) CountComments(
	ctx context.Context, requestIDs []int64,
) (map[int64]int64, error) {
	out := make(map[int64]int64, len(requestIDs))
	if len(requestIDs) == 0 {
		return out, nil
	}
	var rows []struct {
		RequestID int64
		Total     int64
	}
	err := r.db.WithContext(ctx).
		Model(&model.LyricRequestComment{}).
		Select("request_id, COUNT(*) AS total").
		Where("request_id IN ?", requestIDs).
		Group("request_id").
		Scan(&rows).Error
	if err != nil {
		return out, err
	}
	for _, row := range rows {
		out[row.RequestID] = row.Total
	}
	return out, nil
}

// ListComments 查询某条请愿最新的 limit 条评论，返回时按时间正序。
// 先 DESC + LIMIT 取最新，再在 Go 里反转，避免「前 300 条」导致新评论永远看不到。
func (r *LyricRequestRepo) ListComments(
	ctx context.Context, requestID int64, limit int,
) ([]model.LyricRequestComment, error) {
	var comments []model.LyricRequestComment
	err := r.db.WithContext(ctx).
		Where("request_id = ?", requestID).
		Order("created_at DESC, id DESC").
		Limit(limit).
		Find(&comments).Error
	if err != nil {
		return comments, err
	}
	for i, j := 0, len(comments)-1; i < j; i, j = i+1, j-1 {
		comments[i], comments[j] = comments[j], comments[i]
	}
	return comments, nil
}

// AddComment 新增评论
func (r *LyricRequestRepo) AddComment(ctx context.Context, comment *model.LyricRequestComment) error {
	return r.db.WithContext(ctx).Create(comment).Error
}

// ListByPlatformIDs 按平台 ID 批量查找待处理请愿
func (r *LyricRequestRepo) ListByPlatformIDs(
	ctx context.Context, ids map[string][]string,
) ([]model.LyricRequest, error) {
	conds := make([]string, 0, len(ids))
	args := make([]any, 0, len(ids))
	for col, vals := range ids {
		clean := make([]string, 0, len(vals))
		for _, v := range vals {
			if v = strings.TrimSpace(v); v != "" && v != "0" {
				clean = append(clean, v)
			}
		}
		if len(clean) == 0 {
			continue
		}
		conds = append(conds, col+" IN ?")
		args = append(args, clean)
	}
	if len(conds) == 0 {
		return nil, nil
	}

	var items []model.LyricRequest
	err := r.db.WithContext(ctx).
		Where(strings.Join(conds, " OR "), args...).
		Where("status = ?", model.LyricRequestPending).
		Order("id DESC").
		Find(&items).Error
	return items, err
}

// SetStatusByIDs 批量更新请愿状态
func (r *LyricRequestRepo) SetStatusByIDs(
	ctx context.Context, ids []int64, status string,
) error {
	if len(ids) == 0 {
		return nil
	}
	updates := map[string]any{"status": status}
	if status == model.LyricRequestCompleted {
		updates["completed_at"] = time.Now()
	} else {
		updates["completed_at"] = nil
	}
	return r.db.WithContext(ctx).
		Model(&model.LyricRequest{}).
		Where("id IN ?", ids).
		Updates(updates).Error
}

// ListAllSupports 查询这些请愿的全部支持者
func (r *LyricRequestRepo) ListAllSupports(
	ctx context.Context, requestIDs []int64,
) ([]model.LyricRequestSupport, error) {
	if len(requestIDs) == 0 {
		return nil, nil
	}
	var rows []model.LyricRequestSupport
	err := r.db.WithContext(ctx).
		Where("request_id IN ?", requestIDs).
		Order("created_at ASC").
		Find(&rows).Error
	return rows, err
}

// ListByIDs 按 ID 批量查询请愿
func (r *LyricRequestRepo) ListByIDs(ctx context.Context, ids []int64) ([]model.LyricRequest, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var items []model.LyricRequest
	err := r.db.WithContext(ctx).Where("id IN ?", ids).Find(&items).Error
	return items, err
}

// LatestSubmissionStatus 返回每个请愿最近一条关联投稿的审核状态
func (r *LyricRequestRepo) LatestSubmissionStatus(
	ctx context.Context, requestIDs []int64,
) (map[int64]string, error) {
	out := make(map[int64]string, len(requestIDs))
	if len(requestIDs) == 0 {
		return out, nil
	}
	var rows []struct {
		RequestID int64
		Status    string
	}
	// DISTINCT ON 让数据库只返回每个请愿最近的一条关联投稿，
	// 否则一个请愿关联 N 条投稿就返回 N 行，Go 里再白白丢掉 N-1 行。
	// ORDER BY 前缀必须与 DISTINCT ON 的列一致（Postgres 要求）。
	err := r.db.WithContext(ctx).Raw(`
		SELECT DISTINCT ON (l.request_id) l.request_id, s.status
		FROM submission_petition_links l
		JOIN submissions s ON s.id = l.submission_id
		WHERE l.request_id IN (?)
		ORDER BY l.request_id, l.created_at DESC, l.id DESC`, requestIDs).Scan(&rows).Error
	if err != nil {
		return out, err
	}
	for _, row := range rows {
		if _, ok := out[row.RequestID]; !ok {
			out[row.RequestID] = row.Status
		}
	}
	return out, nil
}
