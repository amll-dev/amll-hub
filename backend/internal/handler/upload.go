package handler

import (
	"context"
	"net/http"
	"path"
	"strconv"
	"strings"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// UploadHandler 文件上传 handler
type UploadHandler struct {
	files *service.FileService
	subs  *service.SubmissionService
}

// NewUploadHandler 创建上传 handler
func NewUploadHandler(files *service.FileService, subs *service.SubmissionService) *UploadHandler {
	return &UploadHandler{files: files, subs: subs}
}

// UploadTTML POST /api/v1/uploads/ttml
func (h *UploadHandler) UploadTTML(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}

	// 1. 优先从 multipart 表单读取
	fileName := c.PostForm("fileName")
	var content []byte
	var err error

	if fh, _ := c.FormFile("file"); fh != nil {
		if fileName == "" {
			fileName = fh.Filename
		}
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
		// 2. 兼容 raw body 上传
		if fileName == "" {
			fileName = c.Query("fileName")
		}
		if fileName == "" {
			pkg.BadRequest(c, "fileName 必填")
			return
		}
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

	// 若 fileName 未带 .ttml 后缀，自动补全
	if !strings.HasSuffix(fileName, ".ttml") {
		fileName = fileName + ".ttml"
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.files.UploadTTML(ctx, fileName, content); err != nil {
		logrus.WithError(err).Warn("upload ttml failed")
		pkg.BadRequest(c, "上传 TTML 失败")
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

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	audioKey, err := h.files.UploadAudio(ctx, subID, audioFH.Filename, audioContent)
	if err != nil {
		logrus.WithError(err).Warn("upload audio failed")
		pkg.BadRequest(c, err.Error())
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
				logrus.WithError(err).Warn("upload cover failed")
				pkg.BadRequest(c, err.Error())
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
var publicServePrefixes = []string{service.MusicPrefix, service.CoverPrefix}

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
	default:
		return "application/octet-stream"
	}
}
