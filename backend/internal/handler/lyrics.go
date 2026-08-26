package handler

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// LyricsHandler 歌词获取 handler
type LyricsHandler struct {
	svc   *service.LyricsService
	nfSvc *service.NotFoundService
}

func NewLyricsHandler(svc *service.LyricsService, nfSvc *service.NotFoundService) *LyricsHandler {
	return &LyricsHandler{svc: svc, nfSvc: nfSvc}
}

// GetLyrics GET /api/v1/lyrics/:folder/:filename
// 直接返回 TTML 原始字节流
// :folder ∈ {raw-lyrics, ncm-lyrics, qq-lyrics, spotify-lyrics, am-lyrics}
func (h *LyricsHandler) GetLyrics(c *gin.Context) {
	folder := c.Param("folder")
	filename := c.Param("filename")

	if !pkg.IsValidFolder(folder) || filename == "" {
		pkg.Fail(c, http.StatusBadRequest, http.StatusBadRequest, "invalid folder or filename")
		return
	}

	// 平台 ID 查询时，去掉末尾的 .ttml 后缀
	if folder != "raw-lyrics" {
		filename = strings.TrimSuffix(filename, ".ttml")
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	// 1. 解析 MinioPath
	resolved, err := h.svc.ResolveLyric(ctx, folder, filename)
	if err != nil {
		if errors.Is(err, service.ErrLyricNotFound) {
			// platform_id 对于非 raw-lyrics 请求，filename 已经被去掉了 .ttml 后缀
			platformID := filename
			if folder == "raw-lyrics" {
				platformID = strings.TrimSuffix(filename, ".ttml")
			}
			pkg.Fail(c, http.StatusNotFound, http.StatusNotFound, "lyric not found: "+platformID)

			// 异步记录无歌词（仅对平台歌词端点生效，raw-lyrics 不记录）
			if folder != "raw-lyrics" && h.nfSvc != nil {
				platform := pkg.FolderToPlatform(folder)
				clientIP := GetClientIP(c)
				// 使用独立 context，避免被请求 context 取消
				go func(platform, platformID, clientIP string) {
					defer func() {
						if r := recover(); r != nil {
							logrus.WithField("panic", r).Error("not_found handler goroutine panic")
						}
					}()
					nfCtx, nfCancel := context.WithTimeout(context.Background(), 10*time.Second)
					defer nfCancel()
					h.nfSvc.HandleNotFoundRequest(nfCtx, platform, platformID, clientIP)
				}(platform, filename, clientIP)
			}
			return
		}
		logrus.WithError(err).Error("resolve lyric failed")
		pkg.InternalError(c, "internal server error")
		return
	}

	// 2. 设置基础响应头
	c.Header("Content-Type", "application/xml; charset=utf-8")
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	if resolved.ETag != "" {
		c.Header("ETag", resolved.ETag)
	}
	c.Header("Content-Length", strconv.FormatInt(resolved.Size, 10))

	// 3. 流式返回
	c.Status(http.StatusOK)
	if err := h.svc.StreamLyric(ctx, resolved.MinioPath, func(reader io.Reader) error {
		_, err := io.Copy(c.Writer, reader)
		return err
	}); err != nil {
		logrus.WithError(err).Error("stream lyric failed")
		return
	}

	// 歌词流式返回成功后：异步检查是否在排行榜中，如果在则删除
	if folder != "raw-lyrics" && h.nfSvc != nil {
		platform := pkg.FolderToPlatform(folder)
		go func(platform, platformID string) {
			defer func() {
				if r := recover(); r != nil {
					logrus.WithField("panic", r).Error("not_found cleanup goroutine panic")
				}
			}()
			nfCtx, nfCancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer nfCancel()
			h.nfSvc.CheckAndDeleteOnLyricResolved(nfCtx, platform, platformID)
		}(platform, filename)
	}
}

// ViewLyric GET /api/v1/lyrics/view/:filename
// 解析 raw-lyrics 下的 TTML 文件，返回结构化歌词数据（搜索页查看歌词）
func (h *LyricsHandler) ViewLyric(c *gin.Context) {
	filename := c.Param("filename")
	if filename == "" {
		pkg.BadRequest(c, "invalid filename")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	resp, err := h.svc.ViewLyric(ctx, filename)
	if err != nil {
		if errors.Is(err, service.ErrLyricNotFound) {
			pkg.Fail(c, http.StatusNotFound, http.StatusNotFound, "lyric not found")
			return
		}
		logrus.WithError(err).Error("view lyric failed")
		pkg.InternalError(c, "解析歌词失败")
		return
	}
	pkg.OK(c, resp)
}

// ParseLyric POST /api/v1/lyrics/parse
// 解析任意 TTML 文本，返回结构化歌词数据（投稿详情页歌词预览用）
// body = 原始 TTML 文本 (text/plain)
func (h *LyricsHandler) ParseLyric(c *gin.Context) {
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, 2*1024*1024))
	if err != nil {
		pkg.BadRequest(c, "读取请求体失败")
		return
	}
	if len(body) == 0 {
		pkg.BadRequest(c, "TTML 内容为空")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	resp, err := h.svc.ParseLyric(ctx, string(body))
	if err != nil {
		logrus.WithError(err).Error("parse lyric failed")
		pkg.InternalError(c, "解析歌词失败")
		return
	}
	pkg.OK(c, resp)
}
