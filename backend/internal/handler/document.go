package handler

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/amll-dev/amll-hub/backend/internal/middleware"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// DocumentHandler 文档系统 handler
type DocumentHandler struct {
	svc           *service.DocumentService
	reviewerCache *middleware.ReviewerCache
	adminCache    *middleware.AdminCache
}

// NewDocumentHandler 创建文档 handler
func NewDocumentHandler(
	svc *service.DocumentService,
	rc *middleware.ReviewerCache,
	ac *middleware.AdminCache,
) *DocumentHandler {
	return &DocumentHandler{svc: svc, reviewerCache: rc, adminCache: ac}
}

// canEdit 当前登录用户是否具备审核员及以上权限
func (h *DocumentHandler) canEdit(c *gin.Context) bool {
	name := middleware.GetUserName(c)
	if name == "" {
		return false
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	if h.adminCache != nil {
		if ok, err := h.adminCache.IsAdmin(ctx, name); err == nil && ok {
			return true
		}
	}
	if h.reviewerCache != nil {
		if ok, err := h.reviewerCache.IsReviewer(ctx, name); err == nil && ok {
			return true
		}
	}
	return false
}

// writeDocErr 文档接口错误映射
func writeDocErr(c *gin.Context, err error, action string) {
	var validationErr *service.ValidationError
	switch {
	case errors.As(err, &validationErr):
		pkg.BadRequest(c, validationErr.Message)
	case errors.Is(err, service.ErrDocumentNotFound):
		pkg.NotFound(c, "文档不存在")
	case errors.Is(err, service.ErrDocumentRevisionNotFound):
		pkg.NotFound(c, "版本不存在")
	case errors.Is(err, service.ErrDocumentSlugTaken):
		pkg.Fail(c, 409, 409, "slug 已被占用")
	default:
		logrus.WithError(err).Error(action)
		pkg.InternalError(c, "内部错误")
	}
}

// queryInt 读取整型 query 参数
func queryInt(c *gin.Context, key string, fallback int) int {
	v, err := strconv.Atoi(c.DefaultQuery(key, ""))
	if err != nil {
		return fallback
	}
	return v
}

// maxPublicDocs 是公开文档列表一次最多返回的条数，防止前端误用拉爆内存。
// 文档量级通常几十到一两百，1000 足够覆盖。
const maxPublicDocs = 1000

// clampDocPaging 与 repository.normalizePage 保持同一口径（默认 20、上限 50）。
// 响应里回显的是这里算出来的实际值：原样回显请求的 pageSize 会让前端按
// total/pageSize 算出偏少的页数，翻到后面直接空白。
func clampDocPaging(page, size int) (int, int) {
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 20
	}
	if size > 50 {
		size = 50
	}
	return page, size
}

// ListPublic GET /api/v1/docs
func (h *DocumentHandler) ListPublic(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	group := strings.TrimSpace(c.Query("group"))
	q := strings.TrimSpace(c.Query("q"))
	page, pageSize := clampDocPaging(
		queryInt(c, "page", 1),
		queryInt(c, "pageSize", queryInt(c, "limit", 100)),
	)

	items, total, err := h.svc.ListPublic(ctx, group, q, page, pageSize)
	if err != nil {
		writeDocErr(c, err, "list documents failed")
		return
	}

	if c.Query("page") == "" && total > int64(len(items)) {
		items, err = h.collectPublicRest(ctx, group, q, items, total)
		if err != nil {
			writeDocErr(c, err, "list documents failed")
			return
		}
	}
	pkg.OK(c, gin.H{"items": items, "total": total, "page": page, "pageSize": pageSize})
}

// collectPublicRest 从第 2 页起继续拉取公开文档，直到取满 total 或达到 maxPublicDocs 上限。
func (h *DocumentHandler) collectPublicRest(
	ctx context.Context, group, q string, first []repository.DocumentListRow, total int64,
) ([]repository.DocumentListRow, error) {
	items := first
	// repo 每页最多 50 条，固定按 50 翻页即可
	for page := 2; int64(len(items)) < total && len(items) < maxPublicDocs; page++ {
		rows, _, err := h.svc.ListPublic(ctx, group, q, page, 50)
		if err != nil {
			return nil, err
		}
		if len(rows) == 0 {
			break
		}
		items = append(items, rows...)
	}
	return items, nil
}

// ListNav GET /api/v1/docs/nav
// 精简导航接口：只返回 id/slug/title/updatedAt，不分页，供首页、侧栏与上下篇使用。
func (h *DocumentHandler) ListNav(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	items, err := h.svc.ListNav(ctx)
	if err != nil {
		writeDocErr(c, err, "list document nav failed")
		return
	}
	pkg.OK(c, gin.H{"items": items})
}

// GetPublic GET /api/v1/docs/:slug
func (h *DocumentHandler) GetPublic(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	canEdit := h.canEdit(c)
	doc, revisionCount, err := h.svc.GetPublic(ctx, c.Param("slug"), canEdit)
	if err != nil {
		writeDocErr(c, err, "get document failed")
		return
	}
	pkg.OK(c, gin.H{
		"document":      doc,
		"canEdit":       canEdit,
		"revisionCount": revisionCount,
	})
}

// ListManage GET /api/v1/manage/docs
func (h *DocumentHandler) ListManage(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	page, pageSize := clampDocPaging(
		queryInt(c, "page", 1),
		queryInt(c, "pageSize", queryInt(c, "limit", 20)),
	)
	items, total, err := h.svc.ListManage(
		ctx,
		strings.TrimSpace(c.Query("status")),
		strings.TrimSpace(c.Query("group")),
		strings.TrimSpace(c.Query("q")),
		page,
		pageSize,
	)
	if err != nil {
		writeDocErr(c, err, "list documents for manage failed")
		return
	}
	pkg.OK(c, gin.H{"items": items, "total": total, "page": page, "pageSize": pageSize})
}

// docPayload 创建/更新请求体
//
// SortOrder / Content 用指针，才能区分「没传这个字段」和「传了 0 / 空串」：
// PUT 只带 `{"status":"draft"}` 时应当保持原正文，而不是把整篇文档清空。
type docPayload struct {
	Slug      string  `json:"slug"`
	Title     string  `json:"title"`
	Group     string  `json:"group"`
	Status    string  `json:"status"`
	SortOrder *int    `json:"sortOrder"`
	Content   *string `json:"content"`
	Note      string  `json:"note"`
}

func (p docPayload) toInput() service.DocumentInput {
	return service.DocumentInput{
		Slug:      p.Slug,
		Title:     p.Title,
		Group:     p.Group,
		Status:    p.Status,
		SortOrder: p.SortOrder,
		Content:   p.Content,
		Note:      p.Note,
	}
}

// Create POST /api/v1/manage/docs
func (h *DocumentHandler) Create(c *gin.Context) {
	actor := currentUser(c)
	if actor == nil {
		pkg.Unauthorized(c)
		return
	}
	var req docPayload
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "请求体格式错误")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	doc, err := h.svc.Create(ctx, req.toInput(), actor)
	if err != nil {
		writeDocErr(c, err, "create document failed")
		return
	}
	pkg.OK(c, gin.H{"id": doc.ID, "slug": doc.Slug})
}

// Update PUT /api/v1/manage/docs/:id
func (h *DocumentHandler) Update(c *gin.Context) {
	actor := currentUser(c)
	if actor == nil {
		pkg.Unauthorized(c)
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		pkg.BadRequest(c, "文档 id 非法")
		return
	}
	var req docPayload
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "请求体格式错误")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	doc, err := h.svc.Update(ctx, id, req.toInput(), actor)
	if err != nil {
		writeDocErr(c, err, "update document failed")
		return
	}
	pkg.OK(c, gin.H{"id": doc.ID, "slug": doc.Slug})
}

// Delete DELETE /api/v1/manage/docs/:id
func (h *DocumentHandler) Delete(c *gin.Context) {
	actor := currentUser(c)
	if actor == nil {
		pkg.Unauthorized(c)
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		pkg.BadRequest(c, "文档 id 非法")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	// 软删除要记操作人，所以这里必须带上 currentUser
	if err := h.svc.Delete(ctx, id, actor); err != nil {
		writeDocErr(c, err, "delete document failed")
		return
	}
	pkg.OK(c, gin.H{"id": id})
}

// UploadMarkdown POST /api/v1/manage/docs/upload
func (h *DocumentHandler) UploadMarkdown(c *gin.Context) {
	actor := currentUser(c)
	if actor == nil {
		pkg.Unauthorized(c)
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		pkg.BadRequest(c, "缺少 .md 文件")
		return
	}
	f, err := fileHeader.Open()
	if err != nil {
		pkg.BadRequest(c, "读取文件失败")
		return
	}
	defer func() { _ = f.Close() }()

	content, err := readLimited(f, service.MaxDocContentSize)
	if err != nil {
		pkg.BadRequest(c, "正文超过 1 MiB 上限")
		return
	}

	docID, _ := strconv.ParseInt(c.PostForm("docId"), 10, 64)
	in := service.DocumentInput{
		Slug:   strings.TrimSpace(c.PostForm("slug")),
		Title:  strings.TrimSpace(c.PostForm("title")),
		Group:  strings.TrimSpace(c.PostForm("group")),
		Status: strings.TrimSpace(c.PostForm("status")),
		Note:   strings.TrimSpace(c.PostForm("note")),
	}
	// 表单不带 sortOrder 时留空（新建走默认 0，覆盖上传保持原排序）
	if raw := strings.TrimSpace(c.PostForm("sortOrder")); raw != "" {
		if n, convErr := strconv.Atoi(raw); convErr == nil {
			in.SortOrder = &n
		}
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	doc, err := h.svc.UploadMarkdown(ctx, c.PostForm("mode"), docID, fileHeader.Filename, content, in, actor)
	if err != nil {
		writeDocErr(c, err, "upload document markdown failed")
		return
	}
	pkg.OK(c, gin.H{"id": doc.ID, "slug": doc.Slug})
}

// UploadImage POST /api/v1/manage/docs/images
func (h *DocumentHandler) UploadImage(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		pkg.BadRequest(c, "缺少图片文件")
		return
	}
	f, err := fileHeader.Open()
	if err != nil {
		pkg.BadRequest(c, "读取文件失败")
		return
	}
	defer func() { _ = f.Close() }()

	content, err := readLimited(f, service.MaxDocImageSize)
	if err != nil {
		pkg.BadRequest(c, "图片超过 5 MiB 上限")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	key, err := h.svc.UploadImage(ctx, c.PostForm("slug"), fileHeader.Filename, content)
	if err != nil {
		writeDocErr(c, err, "upload document image failed")
		return
	}
	pkg.OK(c, gin.H{"key": key})
}

// ListRevisions GET /api/v1/manage/docs/:id/revisions
func (h *DocumentHandler) ListRevisions(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		pkg.BadRequest(c, "文档 id 非法")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	page, pageSize := clampDocPaging(queryInt(c, "page", 1), queryInt(c, "pageSize", 20))
	items, total, err := h.svc.ListRevisions(ctx, id, page, pageSize)
	if err != nil {
		writeDocErr(c, err, "list document revisions failed")
		return
	}
	pkg.OK(c, gin.H{"items": items, "total": total, "page": page, "pageSize": pageSize})
}

// GetRevision GET /api/v1/manage/docs/:id/revisions/:revId
func (h *DocumentHandler) GetRevision(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		pkg.BadRequest(c, "文档 id 非法")
		return
	}
	revID, err := strconv.ParseInt(c.Param("revId"), 10, 64)
	if err != nil || revID <= 0 {
		pkg.BadRequest(c, "版本 id 非法")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	rev, err := h.svc.GetRevision(ctx, id, revID)
	if err != nil {
		writeDocErr(c, err, "get document revision failed")
		return
	}
	pkg.OK(c, rev)
}

// Rollback POST /api/v1/manage/docs/:id/revisions/:revId/rollback
func (h *DocumentHandler) Rollback(c *gin.Context) {
	actor := currentUser(c)
	if actor == nil {
		pkg.Unauthorized(c)
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		pkg.BadRequest(c, "文档 id 非法")
		return
	}
	revID, err := strconv.ParseInt(c.Param("revId"), 10, 64)
	if err != nil || revID <= 0 {
		pkg.BadRequest(c, "版本 id 非法")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	doc, err := h.svc.Rollback(ctx, id, revID, actor)
	if err != nil {
		writeDocErr(c, err, "rollback document failed")
		return
	}
	pkg.OK(c, gin.H{"id": doc.ID, "slug": doc.Slug})
}
