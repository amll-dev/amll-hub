package handler

import (
	"context"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// UploadHandler 文件上传 handler
type UploadHandler struct {
	files *service.FileService
	subs  *service.SubmissionService
	binds *service.GithubBindService
}

// NewUploadHandler 创建上传 handler
func NewUploadHandler(files *service.FileService, subs *service.SubmissionService, binds *service.GithubBindService) *UploadHandler {
	return &UploadHandler{files: files, subs: subs, binds: binds}
}

// UploadTTML POST /api/v1/uploads/ttml
func (h *UploadHandler) UploadTTML(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}

	var content []byte
	var err error
	if fh, _ := c.FormFile("file"); fh != nil {
		f, err := fh.Open()
		if err != nil {
			logrus.WithError(err).Warn("open ttml file failed")
			pkg.BadRequest(c, "读取文件失败")
			return
		}
		defer f.Close()
		content, err = readLimited(f, h.files.MaxTTMLSize())
		if err != nil {
			logrus.WithError(err).Warn("read ttml file failed")
			pkg.BadRequest(c, err.Error())
			return
		}
	} else {
		// 兼容 raw body 上传
		content, err = readLimited(c.Request.Body, h.files.MaxTTMLSize())
		if err != nil {
			logrus.WithError(err).Warn("read ttml request body failed")
			pkg.BadRequest(c, err.Error())
			return
		}
	}

	if len(content) == 0 {
		pkg.BadRequest(c, "文件内容为空")
		return
	}

	// 文件名中的作者 ID 优先取 TTML 元数据
	githubID, ok := service.ExtractTTMLAuthorGithubID(content)
	if !ok {
		binding, bindErr := h.binds.GetBinding(c.Request.Context(), user.Name)
		if bindErr != nil {
			logrus.WithError(bindErr).Warn("get github binding failed")
			pkg.Fail(c, http.StatusInternalServerError, http.StatusInternalServerError, "读取 GitHub 绑定信息失败")
			return
		}
		if binding == nil {
			pkg.BadRequest(c, "无法确定歌词作者 GitHub ID：请在歌词元数据中填写 ttmlAuthorGithub，或先绑定 GitHub 账号")
			return
		}
		githubID = binding.GithubID
	}

	// 忽略客户端传来的原始文件名，杜绝任意文件名进入 MinIO 与 GitHub 仓库
	fileName := service.GenerateTTMLFileName(githubID)

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.files.UploadTTML(ctx, fileName, content); err != nil {
		writeServiceErr(c, err, "upload ttml failed")
		return
	}
	pkg.OK(c, gin.H{"fileName": fileName})
}

// UploadAudio POST /api/v1/uploads/audio
func (h *UploadHandler) UploadAudio(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}

	subIDStr := c.PostForm("submissionId")
	subID, err := strconv.ParseInt(subIDStr, 10, 64)
	if err != nil || subID <= 0 {
		pkg.BadRequest(c, "submissionId 必填且为正整数")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	// 先校验投稿归属与音频数量上限，避免超限后仍然写入对象存储
	if err := h.subs.CheckAudioQuota(ctx, user, subID); err != nil {
		writeSubmissionErr(c, err)
		return
	}

	audioFH, err := c.FormFile("audio")
	if err != nil {
		pkg.BadRequest(c, "audio 字段必填")
		return
	}
	audioFile, err := audioFH.Open()
	if err != nil {
		logrus.WithError(err).Warn("open audio file failed")
		pkg.BadRequest(c, "打开音频文件失败")
		return
	}
	defer audioFile.Close()
	audioContent, err := readLimited(audioFile, h.files.MaxAudioSize())
	if err != nil {
		logrus.WithError(err).Warn("read audio file failed")
		pkg.BadRequest(c, err.Error())
		return
	}

	audioKey, err := h.files.UploadAudio(ctx, subID, audioFH.Filename, audioContent)
	if err != nil {
		writeServiceErr(c, err, "upload audio failed")
		return
	}

	// 表单上传的 cover
	coverKey := ""
	if coverFH, _ := c.FormFile("cover"); coverFH != nil {
		coverFile, err := coverFH.Open()
		if err == nil {
			coverBytes, readErr := readLimited(coverFile, h.files.MaxImageSize())
			_ = coverFile.Close()
			if readErr != nil {
				logrus.WithError(readErr).Warn("read cover file failed")
				pkg.BadRequest(c, readErr.Error())
				return
			}
			coverKey, err = h.files.UploadCover(ctx, subID, coverFH.Filename, coverBytes)
			if err != nil {
				writeServiceErr(c, err, "upload cover failed")
				return
			}
		}
	}

	title := pkg.Truncate(c.PostForm("title"), 200)
	artist := pkg.Truncate(c.PostForm("artist"), 200)
	album := pkg.Truncate(c.PostForm("album"), 200)

	audioIn := &service.AttachAudioInput{
		FileName:   audioKey,
		CoverURL:   h.files.CoverURL(coverKey),
		Title:      title,
		Artist:     artist,
		Album:      album,
		Platform:   c.PostForm("platform"),
		PlatformID: c.PostForm("platformId"),
	}
	if err := h.subs.AttachAudio(ctx, user, subID, audioIn); err != nil {
		// 关联失败时清理刚上传的对象，避免超限请求不断堆积文件
		cleanupCtx, cleanupCancel := pkg.DetachedTimeout(ctx, 5*time.Second)
		defer cleanupCancel()
		_ = h.files.Delete(cleanupCtx, audioKey)
		if coverKey != "" {
			_ = h.files.Delete(cleanupCtx, coverKey)
		}
		writeSubmissionErr(c, err)
		return
	}
	pkg.OK(c, gin.H{
		"fileName": audioKey,
		"coverUrl": audioIn.CoverURL,
		"title":    audioIn.Title,
		"artist":   audioIn.Artist,
		"album":    audioIn.Album,
	})
}

// publicServePrefixes 是允许匿名访问的 MinIO 前缀白名单，
// 防止通过该接口读取 bucket 内其他对象
var publicServePrefixes = []string{
	service.MusicPrefix,
	service.CoverPrefix,
	service.ProfileBannerPrefix,
	service.DocsImagePrefix,
}

// isPublicServeKey 校验 key 是否落在公开前缀内且不含路径穿越
func isPublicServeKey(key string) bool {
	if strings.Contains(key, "..") {
		return false
	}
	for _, p := range publicServePrefixes {
		if strings.HasPrefix(key, p) {
			return true
		}
	}
	return false
}

// ServeFile GET /api/v1/uploads/file/*key
// 从 MinIO 流式返回音频/封面文件，支持 HTTP Range 请求
func (h *UploadHandler) ServeFile(c *gin.Context) {
	key := c.Param("key")
	key = strings.TrimPrefix(key, "/")

	if key == "" || !isPublicServeKey(key) {
		c.Status(http.StatusNotFound)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	obj, size, modTime, err := h.files.GetWithStat(ctx, key)
	if err != nil {
		exists, existsErr := h.files.Exists(ctx, key)
		if existsErr == nil && !exists {
			c.Status(http.StatusNotFound)
			return
		}
		logrus.WithError(err).Warn("serve upload file failed")
		c.Status(http.StatusInternalServerError)
		return
	}
	defer func() { _ = obj.Close() }()

	c.Header("Content-Type", fileContentType(key))
	c.Header("Cache-Control", "public, max-age=3600")
	c.Header("Cross-Origin-Resource-Policy", "cross-origin")
	// SVG 可能携带脚本，直接访问时按静态资源隔离
	if strings.EqualFold(path.Ext(key), ".svg") {
		c.Header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
		c.Header("X-Content-Type-Options", "nosniff")
	}
	// http.ServeContent 支持 Range 请求，浏览器可流式播放与 seek
	http.ServeContent(c.Writer, c.Request, path.Base(key), modTime, obj)
	_ = size
}

// fileContentType 根据文件扩展名返回 Content-Type
func fileContentType(name string) string {
	ext := strings.ToLower(path.Ext(name))
	switch ext {
	case ".mp3":
		return "audio/mpeg"
	case ".flac":
		return "audio/flac"
	case ".wav":
		return "audio/wav"
	case ".m4a":
		return "audio/mp4"
	case ".ogg":
		return "audio/ogg"
	case ".aac":
		return "audio/aac"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".svg":
		return "image/svg+xml"
	default:
		return "application/octet-stream"
	}
}
