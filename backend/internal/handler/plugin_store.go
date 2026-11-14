package handler

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/config"
	"github.com/amll-dev/amll-hub/backend/internal/middleware"
	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

var pluginArtifactFilePattern = regexp.MustCompile(`^([a-f0-9]{64})\.zip$`)

var (
	errPluginUploadTooLarge = errors.New("插件包超过大小限制")
	errPluginFileMissing    = errors.New("缺少插件包文件")
)

// PluginStoreHandler 插件商店 handler
type PluginStoreHandler struct {
	svc           *service.PluginStoreService
	files         *service.PluginStoreFileService
	catalog       *service.PluginCatalogService
	cfg           *config.Config
	reviewerCache *middleware.ReviewerCache
	adminCache    *middleware.AdminCache
}

func NewPluginStoreHandler(
	svc *service.PluginStoreService,
	files *service.PluginStoreFileService,
	catalog *service.PluginCatalogService,
	cfg *config.Config,
	rc *middleware.ReviewerCache,
	ac *middleware.AdminCache,
) *PluginStoreHandler {
	return &PluginStoreHandler{svc: svc, files: files, catalog: catalog, cfg: cfg, reviewerCache: rc, adminCache: ac}
}

func pluginUser(c *gin.Context) *service.PluginUser {
	user := currentUser(c)
	if user == nil {
		return nil
	}
	return &service.PluginUser{Name: user.Name, DisplayName: user.DisplayName, Avatar: user.Avatar}
}

// Catalog GET /api/v1/store/catalog.json
func (h *PluginStoreHandler) Catalog(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	body, etag, err := h.catalog.Get(ctx)
	if err != nil {
		logrus.WithError(err).Error("build plugin catalog failed")
		pkg.InternalError(c, "生成插件目录失败")
		return
	}
	quoted := `"` + etag + `"`
	if inm := strings.TrimSpace(c.GetHeader("If-None-Match")); inm != "" {
		if inm == quoted || inm == etag {
			c.Header("ETag", quoted)
			c.Status(http.StatusNotModified)
			return
		}
	}
	c.Header("ETag", quoted)
	c.Header("Cache-Control", "no-cache")
	c.Header("Content-Type", "application/json; charset=utf-8")
	c.Data(http.StatusOK, "application/json; charset=utf-8", body)
}

// Artifact GET /api/v1/store/artifacts/:file
func (h *PluginStoreHandler) Artifact(c *gin.Context) {
	match := pluginArtifactFilePattern.FindStringSubmatch(c.Param("file"))
	if len(match) != 2 {
		pkg.NotFound(c, "插件包不存在")
		return
	}
	sha := match[1]
	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	version, plugin, err := h.svc.GetPublicArtifact(ctx, sha)
	if err != nil {
		if errors.Is(err, service.ErrPluginArtifactMissing) {
			pkg.NotFound(c, "插件包不存在")
			return
		}
		logrus.WithError(err).Error("query plugin artifact failed")
		pkg.InternalError(c, "查询插件包失败")
		return
	}

	rc, info, err := h.files.GetArtifact(ctx, sha)
	if err != nil {
		logrus.WithError(err).Error("open plugin artifact failed")
		pkg.NotFound(c, "插件包不存在")
		return
	}
	defer rc.Close()

	etag := `"` + sha + `"`
	if inm := strings.TrimSpace(c.GetHeader("If-None-Match")); inm == etag || inm == sha {
		c.Header("ETag", etag)
		c.Status(http.StatusNotModified)
		return
	}

	c.Header("Content-Type", "application/zip")
	c.Header("Content-Length", strconv.FormatInt(info.Size, 10))
	c.Header("ETag", etag)
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, service.PluginArtifactDownloadFilename(plugin.PluginKey, version.Version)))
	// 下载请求开始即计数，让前端在点击后短时间内刷新就能看到最新次数
	pkg.GoSafe("plugin-download-count", func() {
		countCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		h.svc.IncrementDownload(countCtx, sha)
	})
	c.Status(http.StatusOK)

	if _, err := io.Copy(c.Writer, rc); err != nil {
		logrus.WithError(err).Warn("stream plugin artifact failed")
		return
	}
}

// ListPublic GET /api/v1/store/plugins
func (h *PluginStoreHandler) ListPublic(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	q := repository.PluginListQuery{
		Page:     page,
		PageSize: pageSize,
		Q:        strings.TrimSpace(c.Query("q")),
		Channel:  c.Query("channel"),
		Sort:     c.DefaultQuery("sort", "recent"),
	}
	if q.Channel != "" && q.Channel != "trusted-js" && q.Channel != "theme" {
		pkg.BadRequest(c, "channel 只能是 trusted-js 或 theme")
		return
	}
	switch q.Sort {
	case "recent", "downloads", "name":
	default:
		pkg.BadRequest(c, "sort 只能是 recent / downloads / name")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	items, total, err := h.svc.ListPublic(ctx, q)
	if err != nil {
		logrus.WithError(err).Error("list public plugins failed")
		pkg.InternalError(c, "查询插件列表失败")
		return
	}
	if items == nil {
		items = []service.PluginPublicListItem{}
	}
	pkg.OK(c, gin.H{"items": items, "total": total, "page": page, "pageSize": pageSize})
}

// GetPublic GET /api/v1/store/plugins/:key
func (h *PluginStoreHandler) GetPublic(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	detail, err := h.svc.GetPublic(ctx, c.Param("key"), middleware.GetUserName(c))
	if err != nil {
		if errors.Is(err, service.ErrPluginNotFound) {
			pkg.NotFound(c, "插件不存在")
			return
		}
		logrus.WithError(err).Error("get public plugin failed")
		pkg.InternalError(c, "查询插件失败")
		return
	}
	pkg.OK(c, detail)
}

// Stats GET /api/v1/store/stats
func (h *PluginStoreHandler) Stats(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	stats, err := h.svc.Stats(ctx)
	if err != nil {
		logrus.WithError(err).Error("get plugin stats failed")
		pkg.InternalError(c, "查询商店统计失败")
		return
	}
	pkg.OK(c, stats)
}

// CreateSubmission POST /api/v1/store/submissions
func (h *PluginStoreHandler) CreateSubmission(c *gin.Context) {
	user := pluginUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	tmpPath, sha, size, err := h.readUpload(c)
	if err != nil {
		writePluginUploadErr(c, err)
		return
	}
	defer os.Remove(tmpPath)

	result, size, err := h.svc.ValidateFile(tmpPath)
	if err != nil {
		writePluginErr(c, err)
		return
	}
	in, err := parsePluginSubmissionForm(c)
	if err != nil {
		pkg.BadRequest(c, err.Error())
		return
	}
	created, err := h.svc.CreateSubmission(ctx, user, result, sha, size, tmpPath, in)
	if err != nil {
		writePluginErr(c, err)
		return
	}
	// 图标只来自包内 manifest.icon
	if len(result.Icon) > 0 {
		if _, err := h.svc.SetIconByKey(ctx, user.Name, created.PluginKey, result.Icon); err != nil {
			logrus.WithError(err).Warn("set plugin icon after submission failed")
			created.IconUploadFailed = true
		}
	}
	pkg.OK(c, created)
}

// ValidateSubmission POST /api/v1/store/submissions/validate
func (h *PluginStoreHandler) ValidateSubmission(c *gin.Context) {
	user := pluginUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	tmpPath, _, _, err := h.readUpload(c)
	if err != nil {
		writePluginUploadErr(c, err)
		return
	}
	defer os.Remove(tmpPath)

	result, _, err := h.svc.ValidateFile(tmpPath)
	if err != nil {
		var issueErr *service.PluginIssueError
		if errors.As(err, &issueErr) {
			pkg.OK(c, gin.H{
				"ok":       false,
				"kind":     result.Kind,
				"manifest": result.Manifest,
				"issues":   issueErr.Issues,
			})
			return
		}
		writePluginErr(c, err)
		return
	}
	resp := gin.H{
		"ok":           true,
		"kind":         result.Kind,
		"manifest":     result.Manifest,
		"issues":       []service.PluginIssue{},
		"entry":        result.Entry,
		"iconDetected": result.IconDetected,
	}
	if result.IconDetected {
		// 仅供投稿页预览，最长约 65 KB；不落库、不打日志
		resp["iconPreview"] = "data:image/png;base64," + base64.StdEncoding.EncodeToString(result.Icon)
	}
	pkg.OK(c, resp)
}

// ListMyPlugins GET /api/v1/store/my/plugins
func (h *PluginStoreHandler) ListMyPlugins(c *gin.Context) {
	user := pluginUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	q := repository.PluginListQuery{
		Page:     page,
		PageSize: pageSize,
		Q:        strings.TrimSpace(c.Query("q")),
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	items, total, err := h.svc.ListMyPlugins(ctx, user.Name, q)
	if err != nil {
		logrus.WithError(err).Error("list my plugins failed")
		pkg.InternalError(c, "查询插件列表失败")
		return
	}
	if items == nil {
		items = []service.PluginManagementItem{}
	}
	pkg.OK(c, gin.H{"items": items, "total": total, "page": page, "pageSize": pageSize})
}

// GetMyPlugin GET /api/v1/store/my/plugins/:key
func (h *PluginStoreHandler) GetMyPlugin(c *gin.Context) {
	user := pluginUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	item, err := h.svc.GetMyPlugin(ctx, user.Name, c.Param("key"))
	if err != nil {
		writePluginErr(c, err)
		return
	}
	pkg.OK(c, item)
}

// GetReviewPlugin GET /api/v1/store/review/plugins/:key
func (h *PluginStoreHandler) GetReviewPlugin(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	item, err := h.svc.GetPluginManagement(ctx, c.Param("key"))
	if err != nil {
		writePluginErr(c, err)
		return
	}
	pkg.OK(c, item)
}

// UnlistMyPlugin POST /api/v1/store/my/plugins/:key/unlist
func (h *PluginStoreHandler) UnlistMyPlugin(c *gin.Context) {
	user := pluginUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	if err := h.svc.UnlistMyPlugin(ctx, user, c.Param("key")); err != nil {
		writePluginErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "插件已下架")
}

// RollbackMyPluginVersion POST /api/v1/store/my/plugins/:key/versions/:id/rollback
func (h *PluginStoreHandler) RollbackMyPluginVersion(c *gin.Context) {
	user := pluginUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	id, err := parsePositiveID(c.Param("id"))
	if err != nil {
		pkg.BadRequest(c, "无效的版本 id")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	if err := h.svc.RollbackMyPluginVersion(ctx, user, c.Param("key"), id); err != nil {
		writePluginErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "已回滚到所选版本")
}

// UpdateMyPlugin PUT /api/v1/store/my/plugins/:key
func (h *PluginStoreHandler) UpdateMyPlugin(c *gin.Context) {
	user := pluginUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	var in service.PluginManagementUpdateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		pkg.BadRequest(c, "参数错误")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	if err := h.svc.UpdateMyPlugin(ctx, user.Name, c.Param("key"), &in); err != nil {
		writePluginErr(c, err)
		return
	}
	pkg.OK(c, gin.H{"ok": true})
}

// ListComments GET /api/v1/store/plugins/:key/comments
func (h *PluginStoreHandler) ListComments(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	comments, err := h.svc.ListComments(ctx, c.Param("key"))
	if err != nil {
		writePluginErr(c, err)
		return
	}
	if comments == nil {
		comments = []model.PluginComment{}
	}
	pkg.OK(c, comments)
}

// CreateComment POST /api/v1/store/plugins/:key/comments
func (h *PluginStoreHandler) CreateComment(c *gin.Context) {
	user := pluginUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	var req struct {
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "评论内容必填")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	if err := h.svc.AddComment(ctx, user, c.Param("key"), req.Content); err != nil {
		writePluginErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "评论成功")
}

// RatePlugin POST /api/v1/store/plugins/:key/ratings
func (h *PluginStoreHandler) RatePlugin(c *gin.Context) {
	user := pluginUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	var req struct {
		Score int `json:"score" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "评分必须是 1-5 的整数")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	summary, myScore, err := h.svc.RatePlugin(ctx, user, c.Param("key"), req.Score)
	if err != nil {
		writePluginErr(c, err)
		return
	}
	pkg.OKWithMsg(c, gin.H{"rating": summary, "myScore": myScore}, "评分成功")
}

// ListMine GET /api/v1/store/submissions
func (h *PluginStoreHandler) ListMine(c *gin.Context) {
	user := pluginUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	q := repository.PluginVersionListQuery{
		Page:     page,
		PageSize: pageSize,
		Status:   c.DefaultQuery("status", "all"),
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	items, total, err := h.svc.ListMine(ctx, user.Name, q)
	if err != nil {
		logrus.WithError(err).Error("list my plugin submissions failed")
		pkg.InternalError(c, "查询我的投稿失败")
		return
	}
	if items == nil {
		items = []service.PluginSubmissionDetail{}
	}
	pkg.OK(c, gin.H{"items": items, "total": total, "page": page, "pageSize": pageSize})
}

// GetMine GET /api/v1/store/submissions/:id
func (h *PluginStoreHandler) GetMine(c *gin.Context) {
	user := pluginUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	id, err := parsePositiveID(c.Param("id"))
	if err != nil {
		pkg.BadRequest(c, "无效的 id")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	isAdmin := false
	if h.adminCache != nil {
		isAdmin, _ = h.adminCache.IsAdmin(ctx, user.Name)
	}
	detail, err := h.svc.GetMine(ctx, user.Name, isAdmin, id)
	if err != nil {
		writePluginErr(c, err)
		return
	}
	pkg.OK(c, detail)
}

// UpdateMine PUT /api/v1/store/submissions/:id
func (h *PluginStoreHandler) UpdateMine(c *gin.Context) {
	user := pluginUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	id, err := parsePositiveID(c.Param("id"))
	if err != nil {
		pkg.BadRequest(c, "无效的 id")
		return
	}
	var in service.PluginSubmissionInput
	if err := c.ShouldBindJSON(&in); err != nil {
		pkg.BadRequest(c, "参数错误")
		return
	}
	if err := validatePluginSubmissionInput(&in); err != nil {
		pkg.BadRequest(c, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	if err := h.svc.UpdateMine(ctx, user.Name, id, &in); err != nil {
		writePluginErr(c, err)
		return
	}
	pkg.OK(c, gin.H{"ok": true})
}

// DownloadMineArtifact GET /api/v1/store/submissions/:id/artifact
func (h *PluginStoreHandler) DownloadMineArtifact(c *gin.Context) {
	user := pluginUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	id, err := parsePositiveID(c.Param("id"))
	if err != nil {
		pkg.BadRequest(c, "无效的 id")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()
	isReviewer, isAdmin := false, false
	if h.reviewerCache != nil {
		isReviewer, _ = h.reviewerCache.IsReviewer(ctx, user.Name)
	}
	if h.adminCache != nil {
		isAdmin, _ = h.adminCache.IsAdmin(ctx, user.Name)
	}
	version, plugin, err := h.svc.GetMineArtifact(ctx, user.Name, isReviewer, isAdmin, id)
	if err != nil {
		writePluginErr(c, err)
		return
	}
	rc, info, err := h.files.GetArtifact(ctx, version.SHA256)
	if err != nil {
		pkg.NotFound(c, "插件包不存在")
		return
	}
	defer rc.Close()
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Length", strconv.FormatInt(info.Size, 10))
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, service.PluginArtifactDownloadFilename(plugin.PluginKey, version.Version)))
	c.Status(http.StatusOK)
	_, _ = io.Copy(c.Writer, rc)
}

// GetIcon GET /api/v1/store/plugins/:key/icon
func (h *PluginStoreHandler) GetIcon(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	rc, info, err := h.svc.GetIconByKey(ctx, c.Param("key"))
	if err != nil {
		pkg.NotFound(c, "插件图标不存在")
		return
	}
	defer rc.Close()
	contentType := info.ContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.Header("Content-Type", contentType)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Length", strconv.FormatInt(info.Size, 10))
	c.Header("Cache-Control", "public, max-age=86400")
	c.Header("ETag", info.ETag)
	c.Status(http.StatusOK)
	_, _ = io.Copy(c.Writer, rc)
}

func (h *PluginStoreHandler) readUpload(c *gin.Context) (tmpPath, sha string, size int64, err error) {
	max := h.cfg.PluginStore.MaxArtifactBytes
	overhead := int64(1 << 20)
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, max+overhead)
	if err := c.Request.ParseMultipartForm(8 << 20); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return "", "", 0, errPluginUploadTooLarge
		}
		return "", "", 0, errors.New("multipart 表单格式错误")
	}
	fh, err := c.FormFile("file")
	if err != nil {
		return "", "", 0, errPluginFileMissing
	}
	f, err := fh.Open()
	if err != nil {
		return "", "", 0, err
	}
	defer f.Close()

	tmp, err := os.CreateTemp("", "plugin-upload-*.zip")
	if err != nil {
		return "", "", 0, err
	}
	tmpPath = tmp.Name()
	defer func() {
		if err != nil {
			_ = tmp.Close()
			_ = os.Remove(tmpPath)
		}
	}()

	hasher := sha256.New()
	n, err := io.Copy(io.MultiWriter(tmp, hasher), io.LimitReader(f, max+1))
	if err != nil {
		_ = tmp.Close()
		return "", "", 0, err
	}
	if n > max {
		_ = tmp.Close()
		return "", "", 0, errPluginUploadTooLarge
	}
	if err := tmp.Close(); err != nil {
		return "", "", 0, err
	}
	return tmpPath, hex.EncodeToString(hasher.Sum(nil)), n, nil
}

func parsePluginSubmissionForm(c *gin.Context) (*service.PluginSubmissionInput, error) {
	in := &service.PluginSubmissionInput{
		Summary:         strings.TrimSpace(c.PostForm("summary")),
		DescriptionMD:   c.PostForm("description_md"),
		Homepage:        strings.TrimSpace(c.PostForm("homepage")),
		RepoURL:         strings.TrimSpace(c.PostForm("repo_url")),
		License:         strings.TrimSpace(c.PostForm("license")),
		ReadmeMD:        c.PostForm("readme_md"),
		ChangelogMD:     c.PostForm("changelog_md"),
		MinAppVersion:   strings.TrimSpace(c.PostForm("min_app_version")),
		TargetPluginKey: strings.TrimSpace(c.PostForm("target_plugin_key")),
	}
	if raw := strings.TrimSpace(c.PostForm("tags")); raw != "" {
		if err := json.Unmarshal([]byte(raw), &in.Tags); err != nil {
			return nil, errors.New("tags 必须是 JSON 字符串数组")
		}
	}
	if raw := strings.TrimSpace(c.PostForm("platforms")); raw != "" {
		in.Platforms = strings.Split(raw, ",")
	}
	if err := validatePluginSubmissionInput(in); err != nil {
		return nil, err
	}
	return in, nil
}

func validatePluginSubmissionInput(in *service.PluginSubmissionInput) error {
	if pkg.UTF16Len(in.Summary) > 512 {
		return errors.New("summary 最多 512 个字符")
	}
	if len(in.DescriptionMD) > 200_000 {
		return errors.New("description_md 过长")
	}
	if len(in.ReadmeMD) > 200_000 || len(in.ChangelogMD) > 200_000 {
		return errors.New("readme_md / changelog_md 过长")
	}
	if in.Homepage != "" && !strings.HasPrefix(in.Homepage, "https://") {
		return errors.New("homepage 必须以 https:// 开头")
	}
	if in.RepoURL != "" && !strings.HasPrefix(in.RepoURL, "http://") && !strings.HasPrefix(in.RepoURL, "https://") {
		return errors.New("repo_url 必须是 http(s) 地址")
	}
	if pkg.UTF16Len(in.License) > 128 {
		return errors.New("license 最多 128 个字符")
	}
	if len(in.Tags) > 12 {
		return errors.New("tags 最多 12 个")
	}
	for _, tag := range in.Tags {
		if pkg.UTF16Len(tag) > 32 {
			return errors.New("单个 tag 最多 32 个字符")
		}
	}
	if in.MinAppVersion != "" {
		if !service.IsValidPluginVersion(in.MinAppVersion) {
			return errors.New("min_app_version 必须是 semver")
		}
	}
	return nil
}

func writePluginUploadErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errPluginUploadTooLarge):
		pkg.Fail(c, http.StatusRequestEntityTooLarge, http.StatusRequestEntityTooLarge, "插件包超过大小限制")
	case errors.Is(err, errPluginFileMissing):
		pkg.BadRequest(c, "file 字段必填")
	default:
		logrus.WithError(err).Warn("read plugin upload failed")
		pkg.BadRequest(c, "读取插件包失败")
	}
}

func writePluginErr(c *gin.Context, err error) {
	var issueErr *service.PluginIssueError
	switch {
	case errors.As(err, &issueErr):
		issues := issueErr.Issues
		if len(issues) == 0 {
			issues = []service.PluginIssue{{Path: "/", Message: "包校验未通过"}}
		}
		c.JSON(http.StatusUnprocessableEntity, pkg.Response{
			Code:    http.StatusUnprocessableEntity,
			Message: "包校验未通过",
			Data:    gin.H{"issues": issues},
		})
	case errors.Is(err, service.ErrPluginValidation):
		c.JSON(http.StatusUnprocessableEntity, pkg.Response{
			Code:    http.StatusUnprocessableEntity,
			Message: "包校验未通过",
			Data:    gin.H{"issues": []service.PluginIssue{{Path: "/", Message: "包校验未通过"}}},
		})
	case errors.Is(err, service.ErrPluginVersionExists):
		pkg.Fail(c, http.StatusConflict, http.StatusConflict, "该版本已存在")
	case errors.Is(err, service.ErrPluginDuplicateSHA):
		pkg.Fail(c, http.StatusConflict, http.StatusConflict, "该插件包已存在")
	case errors.Is(err, service.ErrPluginReservedID):
		pkg.Fail(c, http.StatusUnprocessableEntity, http.StatusUnprocessableEntity, "该插件 id 为预留 id")
	case errors.Is(err, service.ErrPluginForbidden):
		pkg.Fail(c, http.StatusForbidden, http.StatusForbidden, "无权操作该插件")
	case errors.Is(err, service.ErrPluginNotFound):
		pkg.NotFound(c, "插件不存在")
	case errors.Is(err, service.ErrPluginVersionNotFound):
		pkg.NotFound(c, "插件版本不存在")
	case errors.Is(err, service.ErrPluginInvalidStatus):
		pkg.Fail(c, http.StatusConflict, http.StatusConflict, "当前状态不允许此操作")
	case errors.Is(err, service.ErrPluginInvalidInput):
		msg := err.Error()
		if i := strings.Index(msg, ": "); i >= 0 {
			msg = msg[i+2:]
		}
		pkg.BadRequest(c, msg)
	case errors.Is(err, service.ErrPluginReviewConflict):
		pkg.Fail(c, http.StatusConflict, http.StatusConflict, "该版本已被处理")
	case errors.Is(err, service.ErrPluginReviewForbidden):
		pkg.Fail(c, http.StatusForbidden, http.StatusForbidden, "不能审核自己发布的插件")
	case errors.Is(err, service.ErrPluginReviewInvalid):
		pkg.BadRequest(c, "审核动作无效")
	case errors.Is(err, service.ErrPluginIconTooLarge):
		pkg.Fail(c, http.StatusRequestEntityTooLarge, http.StatusRequestEntityTooLarge, "插件图标超过大小限制")
	case errors.Is(err, service.ErrPluginIconFormat):
		pkg.BadRequest(c, "插件图标只支持 PNG / JPEG / WebP")
	case errors.Is(err, service.ErrPluginIconMissing):
		pkg.NotFound(c, "插件图标不存在")
	case errors.Is(err, service.ErrPluginCommentEmpty):
		pkg.BadRequest(c, "评论内容不能为空")
	case errors.Is(err, service.ErrPluginCommentTooLong):
		pkg.BadRequest(c, "评论内容过长")
	case errors.Is(err, service.ErrPluginRatingInvalid):
		pkg.BadRequest(c, "评分必须是 1-5 的整数")
	case errors.Is(err, repository.ErrInvalidPluginListingAction):
		pkg.BadRequest(c, "非法的上架动作")
	default:
		logrus.WithError(err).Error("plugin store error")
		pkg.InternalError(c, "内部错误")
	}
}

func parsePositiveID(raw string) (int64, error) {
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("invalid id")
	}
	return id, nil
}
