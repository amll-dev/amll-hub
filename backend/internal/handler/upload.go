package handler

import (
	"context"
	"io"
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
		pkg.Fail(c, 401, 401, "未登录")
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
		content, err = io.ReadAll(f)
		if err != nil {
			logrus.WithError(err).Warn("read ttml file failed")
			pkg.InternalError(c, "读取文件内容失败")
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
		content, err = io.ReadAll(c.Request.Body)
		if err != nil {
			logrus.WithError(err).Warn("read ttml request body failed")
			pkg.InternalError(c, "读取请求体失败")
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
		pkg.Fail(c, 401, 401, "未登录")
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
	audioContent, err := io.ReadAll(audioFile)
	if err != nil {
		logrus.WithError(err).Warn("read audio file failed")
		pkg.InternalError(c, "读取音频失败")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	audioKey, err := h.files.UploadAudio(ctx, subID, audioFH.Filename, audioContent)
	if err != nil {
		logrus.WithError(err).Warn("upload audio failed")
		pkg.BadRequest(c, "上传音频失败")
		return
	}

	// 封面
	coverKey := ""
	if coverFH, _ := c.FormFile("cover"); coverFH != nil {
		coverFile, err := coverFH.Open()
		if err == nil {
			coverBytes, _ := io.ReadAll(coverFile)
			_ = coverFile.Close()
			coverKey, err = h.files.UploadCover(ctx, subID, coverFH.Filename, coverBytes)
			if err != nil {
				logrus.WithError(err).Warn("upload cover failed")
				pkg.BadRequest(c, "上传封面失败")
				return
			}
		}
	}

	// 组装音频元数据，写入 submission_audios 表
	audioIn := &service.AttachAudioInput{
		FileName:   audioKey,
		CoverURL:   h.files.CoverURL(coverKey),
		Title:      truncate(c.PostForm("title"), 200),
		Artist:     truncate(c.PostForm("artist"), 200),
		Album:      truncate(c.PostForm("album"), 200),
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
	})
}

// truncate 截断字符串到 max 长度
func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}
