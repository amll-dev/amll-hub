package service

import (
	"context"
	"errors"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"gorm.io/gorm"
)

// 文档字段上限
const (
	// MaxDocContentSize 单篇文档正文上限
	MaxDocContentSize = 1 << 20 // 1 MiB
	// MaxDocImageSize 文档图片上限
	MaxDocImageSize = 5 << 20 // 5 MiB
	maxDocTitleLen  = 200
	maxDocSlugLen   = 80
	maxDocNoteLen   = 300
)

var docSlugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// DocumentInput 文档创建/更新入参
//
// SortOrder / Content 用指针区分「请求未提供」与「显式设为 0 / 空串」：
// PUT 是部分更新语义（slug/title/group/status 都是空则保持原值），如果这两项
// 用零值表示「未提供」，单独的 `{"status":"draft"}` 会把正文清空，且 sortOrder
// 永远无法设回 0。
type DocumentInput struct {
	Slug   string
	Title  string
	Group  string
	Status string
	// SortOrder nil 表示保持原值
	SortOrder *int
	// Content nil 表示保持原值，指向空串表示显式清空正文
	Content *string
	// Note 本次保存的备注，写进版本快照
	Note string
}

// DocumentService 文档业务逻辑
type DocumentService struct {
	db    *gorm.DB
	repo  *repository.DocumentRepo
	files *FileService
}

// NewDocumentService 创建文档服务
func NewDocumentService(db *gorm.DB, repo *repository.DocumentRepo, files *FileService) *DocumentService {
	return &DocumentService{db: db, repo: repo, files: files}
}

// ListPublic 公开列表：仅已发布
func (s *DocumentService) ListPublic(
	ctx context.Context, group, q string, page, size int,
) ([]repository.DocumentListRow, int64, error) {
	return s.repo.List(ctx, repository.DocumentListQuery{
		Page: page, PageSize: size, Group: group, Status: model.DocStatusPublished, Q: q,
	})
}

// DocumentNavItem 精简导航项：首页、侧栏、上一篇/下一篇只需要这几个字段。
// group 不能省：前端 groupDocs 按它分桶，缺了首页和侧栏就无法归组。
type DocumentNavItem struct {
	ID        int64     `json:"id"`
	Slug      string    `json:"slug"`
	Title     string    `json:"title"`
	Group     string    `json:"group"`
	UpdatedBy string    `json:"updatedBy"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// maxDocNavItems 导航接口一次最多返回的条数，防止异常数据把响应撑大
const maxDocNavItems = 1000

// ListNav 返回全部已发布文档的精简字段（不分页）。
// 文档量级通常几十到一两百，首页 / 侧栏 / 上下篇一次性取全，避免被分页上限截断。
func (s *DocumentService) ListNav(ctx context.Context) ([]DocumentNavItem, error) {
	rows, err := s.repo.ListAllPublished(ctx)
	if err != nil {
		return nil, err
	}
	if len(rows) > maxDocNavItems {
		rows = rows[:maxDocNavItems]
	}
	items := make([]DocumentNavItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, DocumentNavItem{
			ID:        row.ID,
			Slug:      row.Slug,
			Title:     row.Title,
			Group:     row.GroupName,
			UpdatedBy: row.UpdatedBy,
			UpdatedAt: row.UpdatedAt,
		})
	}
	return items, nil
}

// ListManage 管理端列表：可含草稿
func (s *DocumentService) ListManage(
	ctx context.Context, status, group, q string, page, size int,
) ([]repository.DocumentListRow, int64, error) {
	if status != "" && status != model.DocStatusDraft && status != model.DocStatusPublished {
		return nil, 0, invalidInput("status 只能是 draft 或 published")
	}
	return s.repo.List(ctx, repository.DocumentListQuery{
		Page: page, PageSize: size, Group: group, Status: status, Q: q,
	})
}

// GetPublic 公开详情：草稿仅对可编辑者可见，其他人按不存在处理
func (s *DocumentService) GetPublic(ctx context.Context, slug string, canEdit bool) (*model.Document, int64, error) {
	doc, err := s.repo.GetBySlug(ctx, strings.TrimSpace(slug))
	if err != nil {
		return nil, 0, err
	}
	if doc == nil {
		return nil, 0, ErrDocumentNotFound
	}
	if doc.Status != model.DocStatusPublished && !canEdit {
		return nil, 0, ErrDocumentNotFound
	}
	count, err := s.repo.CountRevisions(ctx, doc.ID)
	if err != nil {
		return nil, 0, err
	}
	return doc, count, nil
}

// GetByID 管理端按 id 查询
func (s *DocumentService) GetByID(ctx context.Context, id int64) (*model.Document, error) {
	doc, err := s.repo.GetByID(ctx, nil, id)
	if err != nil {
		return nil, err
	}
	if doc == nil {
		return nil, ErrDocumentNotFound
	}
	return doc, nil
}

// Create 新建文档并写入首个版本快照
func (s *DocumentService) Create(ctx context.Context, in DocumentInput, actor *SubmissionUser) (*model.Document, error) {
	doc := &model.Document{}
	if err := applyDocumentInput(doc, in); err != nil {
		return nil, err
	}
	if doc.Slug == "" {
		return nil, invalidInput("slug 必填")
	}
	taken, err := s.repo.SlugExists(ctx, nil, doc.Slug, 0)
	if err != nil {
		return nil, err
	}
	if taken {
		return nil, ErrDocumentSlugTaken
	}

	doc.CreatedBy, doc.CreatedByInfo = actorFields(actor)
	doc.UpdatedBy, doc.UpdatedByInfo = doc.CreatedBy, doc.CreatedByInfo
	if doc.Status == model.DocStatusPublished {
		now := time.Now()
		doc.PublishedAt = &now
	}

	err = s.repo.Transaction(ctx, func(tx *gorm.DB) error {
		if err := s.repo.Create(ctx, tx, doc); err != nil {
			// 并发创建同名 slug 时，先查后插之间的窗口会让唯一索引兜底；此时按
			// 「slug 已被占用」返回 409，而不是把 23505 当内部错误抛 500。
			if isDocSlugConflict(err) {
				return ErrDocumentSlugTaken
			}
			return err
		}
		return s.repo.CreateRevision(ctx, tx, revisionOf(doc, in.Note, actor))
	})
	if err != nil {
		return nil, err
	}
	return doc, nil
}

// Update 更新文档：先落库再写一份新版本快照（快照为保存后的内容）
func (s *DocumentService) Update(ctx context.Context, id int64, in DocumentInput, actor *SubmissionUser) (*model.Document, error) {
	var out *model.Document
	err := s.repo.Transaction(ctx, func(tx *gorm.DB) error {
		doc, err := s.repo.GetByIDForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		if doc == nil {
			return ErrDocumentNotFound
		}
		if err := applyDocumentInput(doc, in); err != nil {
			return err
		}
		if doc.Slug == "" {
			return invalidInput("slug 必填")
		}
		// 用事务连接查，避免「检查走了另一条连接」时看不到本事务内的改动；
		// 真正的并发窗口由下面的唯一约束兜底（见 UpdateFields 的错误映射）。
		taken, err := s.repo.SlugExists(ctx, tx, doc.Slug, id)
		if err != nil {
			return err
		}
		if taken {
			return ErrDocumentSlugTaken
		}
		if doc.Status == model.DocStatusPublished && doc.PublishedAt == nil {
			now := time.Now()
			doc.PublishedAt = &now
		}

		doc.UpdatedBy, doc.UpdatedByInfo = actorFields(actor)
		updates := map[string]any{
			"slug":            doc.Slug,
			"title":           doc.Title,
			"group_name":      doc.GroupName,
			"status":          doc.Status,
			"sort_order":      doc.SortOrder,
			"content":         doc.Content,
			"updated_by":      doc.UpdatedBy,
			"updated_by_info": doc.UpdatedByInfo,
			"published_at":    doc.PublishedAt,
		}
		if err := s.repo.UpdateFields(ctx, tx, id, updates); err != nil {
			// 两个管理员同时把文档改成同一个 slug 时，两边的事务内检查都看不到
			// 对方未提交的改动，只能靠唯一索引拦下后来者：这里把 23505 翻成
			// 「slug 已被占用」，前端拿到可理解的 409 而不是 500。
			if isDocSlugConflict(err) {
				return ErrDocumentSlugTaken
			}
			return err
		}
		if err := s.repo.CreateRevision(ctx, tx, revisionOf(doc, in.Note, actor)); err != nil {
			return err
		}
		out = doc
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Delete 删除文档（软删除）
//
// 原实现是 DELETE + document_revisions 的 ON DELETE CASCADE，一篇文档连同全部
// 历史版本一起消失，且不留操作人。对「多人共同维护文档」的系统这个审计缺口太贵，
// 所以改为只写 deleted_at / deleted_by，版本快照与正文都留在库里。
func (s *DocumentService) Delete(ctx context.Context, id int64, actor *SubmissionUser) error {
	doc, err := s.repo.GetByID(ctx, nil, id)
	if err != nil {
		return err
	}
	if doc == nil {
		return ErrDocumentNotFound
	}
	by := ""
	if actor != nil {
		by = actor.Name
	}
	return s.repo.SoftDelete(ctx, id, by)
}

// UploadMarkdown 导入 .md
func (s *DocumentService) UploadMarkdown(
	ctx context.Context, mode string, docID int64, fileName string, content []byte, in DocumentInput, actor *SubmissionUser,
) (*model.Document, error) {
	if !strings.HasSuffix(strings.ToLower(fileName), ".md") {
		return nil, invalidInput("只支持 .md 文件")
	}
	text := normalizeMarkdownText(content)
	if len([]byte(text)) > MaxDocContentSize {
		return nil, invalidInput("正文超过 %d 字节上限", MaxDocContentSize)
	}
	in.Content = &text
	if in.Note == "" {
		in.Note = "上传 " + path.Base(fileName)
	}

	switch mode {
	case "overwrite":
		if docID <= 0 {
			return nil, invalidInput("覆盖上传需要指定文档")
		}
		// 覆盖时保持原标题，避免被文件名顶掉
		return s.Update(ctx, docID, in, actor)
	case "create", "":
		if strings.TrimSpace(in.Title) == "" {
			in.Title = strings.TrimSuffix(path.Base(fileName), path.Ext(fileName))
		}
		return s.Create(ctx, in, actor)
	default:
		return nil, invalidInput("mode 只能是 create 或 overwrite")
	}
}

// UploadImage 上传文档图片
func (s *DocumentService) UploadImage(ctx context.Context, slugHint, fileName string, content []byte) (string, error) {
	if s.files == nil {
		return "", errors.New("file service unavailable")
	}
	ext := strings.ToLower(path.Ext(fileName))
	if ext == "" {
		return "", invalidInput("缺少文件扩展名")
	}
	dir := sanitizeObjectNameSegment(slugHint)
	if dir == "" || dir == "user" {
		dir = "misc"
	}
	rel := dir + "/" + pkg.Truncate(sanitizeObjectNameSegment(strings.TrimSuffix(path.Base(fileName), ext)), 40) + "-" + time.Now().Format("20060102150405") + ext
	return s.files.UploadDocImage(ctx, rel, content)
}

// ListRevisions 版本列表
func (s *DocumentService) ListRevisions(ctx context.Context, docID int64, page, size int) ([]repository.DocumentRevisionRow, int64, error) {
	if _, err := s.GetByID(ctx, docID); err != nil {
		return nil, 0, err
	}
	return s.repo.ListRevisions(ctx, docID, page, size)
}

// GetRevision 单条版本（含正文）
func (s *DocumentService) GetRevision(ctx context.Context, docID, revID int64) (*model.DocumentRevision, error) {
	rev, err := s.repo.GetRevision(ctx, docID, revID)
	if err != nil {
		return nil, err
	}
	if rev == nil {
		return nil, ErrDocumentRevisionNotFound
	}
	return rev, nil
}

// Rollback 回滚到指定版本：恢复标题与正文，并追加一条快照
//
// 版本快照只保存 title / content（见 001_init.up.sql 的注释），所以回滚
// 不会动 slug、分组、状态、排序；前端回滚入口必须把这句话告诉用户。
func (s *DocumentService) Rollback(ctx context.Context, docID, revID int64, actor *SubmissionUser) (*model.Document, error) {
	var out *model.Document
	err := s.repo.Transaction(ctx, func(tx *gorm.DB) error {
		doc, err := s.repo.GetByIDForUpdate(ctx, tx, docID)
		if err != nil {
			return err
		}
		if doc == nil {
			return ErrDocumentNotFound
		}
		rev, err := s.repo.GetRevision(ctx, docID, revID)
		if err != nil {
			return err
		}
		if rev == nil {
			return ErrDocumentRevisionNotFound
		}

		doc.Title = rev.Title
		doc.Content = rev.Content
		doc.UpdatedBy, doc.UpdatedByInfo = actorFields(actor)
		if err := s.repo.UpdateFields(ctx, tx, docID, map[string]any{
			"title":           doc.Title,
			"content":         doc.Content,
			"updated_by":      doc.UpdatedBy,
			"updated_by_info": doc.UpdatedByInfo,
		}); err != nil {
			return err
		}
		note := "回滚至版本 #" + strconv.FormatInt(revID, 10)
		if err := s.repo.CreateRevision(ctx, tx, revisionOf(doc, note, actor)); err != nil {
			return err
		}
		out = doc
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// applyDocumentInput 校验并写入可变字段，未提供的字段保持原值
func applyDocumentInput(doc *model.Document, in DocumentInput) error {
	if slug := strings.ToLower(strings.TrimSpace(in.Slug)); slug != "" {
		if len(slug) < 2 || len(slug) > maxDocSlugLen {
			return invalidInput("slug 长度需在 2–%d 之间", maxDocSlugLen)
		}
		if !docSlugPattern.MatchString(slug) {
			return invalidInput("slug 只能包含小写字母、数字与中划线")
		}
		doc.Slug = slug
	}

	if title := strings.TrimSpace(in.Title); title != "" {
		if utf8.RuneCountInString(title) > maxDocTitleLen {
			return invalidInput("标题最多 %d 个字符", maxDocTitleLen)
		}
		doc.Title = title
	}

	if group := strings.TrimSpace(in.Group); group != "" {
		switch group {
		case model.DocGroupLyrics, model.DocGroupAPI:
			doc.GroupName = group
		default:
			return invalidInput("group 只能是 lyrics 或 api")
		}
	}

	if status := strings.TrimSpace(in.Status); status != "" {
		switch status {
		case model.DocStatusDraft, model.DocStatusPublished:
			doc.Status = status
		default:
			return invalidInput("status 只能是 draft 或 published")
		}
	}

	// 正文只在请求体显式带 content 时覆盖：nil = 未提供，保持原值；
	// "" = 显式清空（草稿场景）。这样才能和 slug/title 等字段的语义对齐，
	// 不会因为一次 `{"status":"draft"}` 把几十 KB 正文清掉。
	if in.Content != nil {
		if len([]byte(*in.Content)) > MaxDocContentSize {
			return invalidInput("正文超过 %d 字节上限", MaxDocContentSize)
		}
		doc.Content = *in.Content
	}

	if doc.Status == model.DocStatusPublished && strings.TrimSpace(doc.Content) == "" {
		return invalidInput("发布的文档正文不能为空")
	}
	if doc.Title == "" {
		return invalidInput("标题必填")
	}

	// 同上：0 是合法排序值，必须用指针区分「没传」与「传了 0」
	if in.SortOrder != nil {
		doc.SortOrder = *in.SortOrder
	}
	return nil
}

// isDocSlugConflict 判断是否为 slug 唯一索引冲突（PostgreSQL SQLSTATE 23505）。
// 事务内的 SlugExists 只能看到已提交数据，并发改同一个 slug 时两边都能通过检查，
// 最终由 ux_documents_slug_active 拦下后来者。
func isDocSlugConflict(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "23505") ||
		strings.Contains(msg, "duplicate key value violates unique constraint")
}

// revisionOf 生成当前内容的版本快照
func revisionOf(doc *model.Document, note string, actor *SubmissionUser) *model.DocumentRevision {
	author, info := actorFields(actor)
	return &model.DocumentRevision{
		DocumentID: doc.ID,
		Title:      doc.Title,
		Content:    doc.Content,
		Note:       pkg.Truncate(strings.TrimSpace(note), maxDocNoteLen),
		Author:     author,
		AuthorInfo: info,
	}
}

func actorFields(actor *SubmissionUser) (string, model.UserInfo) {
	if actor == nil {
		return "", model.UserInfo{}
	}
	return actor.Name, model.UserInfo{
		Username:    actor.Name,
		DisplayName: actor.DisplayName,
		Avatar:      actor.Avatar,
	}
}

// normalizeMarkdownText 去掉 BOM、统一换行
func normalizeMarkdownText(content []byte) string {
	text := strings.TrimPrefix(string(content), "\ufeff")
	text = strings.ReplaceAll(text, "\r\n", "\n")
	return text
}
