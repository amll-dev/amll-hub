package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
)

// qmAlbumMidRe 专辑 mid 形态校验：mid 会拼进 CDN 地址，必须挡掉任意内容
var qmAlbumMidRe = regexp.MustCompile(`^[0-9A-Za-z]{8,32}$`)

// qmCoverURLTemplate QM封面 CDN 模板
const qmCoverURLTemplate = "https://y.gtimg.cn/music/photo_new/T002R%dx%dM000%s.jpg"

// QMMusicHandler QM解析 handler
type QMMusicHandler struct {
	svc *service.QMMusicService
}

// NewQMMusicHandler 构造函数
func NewQMMusicHandler(svc *service.QMMusicService) *QMMusicHandler {
	return &QMMusicHandler{svc: svc}
}

// Search GET /api/v1/qm/search?q=&limit=
// limit 默认 10，范围 1-100
func (h *QMMusicHandler) Search(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	if q == "" {
		pkg.BadRequest(c, "q 参数必填")
		return
	}
	limit := pkg.Clamp(pkg.ParseInt(c.Query("limit"), 10), 1, 100)

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.Search(ctx, q, limit)
	if err != nil {
		writeQMMusicErr(c, err)
		return
	}
	pkg.OK(c, result)
}

// Song GET /api/v1/qm/song?id=
// id 支持歌曲 mid、数字 id 或分享链接
func (h *QMMusicHandler) Song(c *gin.Context) {
	id := strings.TrimSpace(c.Query("id"))
	if id == "" {
		pkg.BadRequest(c, "id 参数必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.GetSong(ctx, id)
	if err != nil {
		writeQMMusicErr(c, err)
		return
	}
	pkg.OK(c, result)
}

// ParseMusic GET /api/v1/qm/parse-music?songId=&level=
// level 默认 hq，可选: hi-res/lossless/hq/sq/lq
func (h *QMMusicHandler) ParseMusic(c *gin.Context) {
	songID := strings.TrimSpace(c.Query("songId"))
	if songID == "" {
		pkg.BadRequest(c, "songId 参数必填")
		return
	}
	level := strings.TrimSpace(c.DefaultQuery("level", "hq"))

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.ParseMusic(ctx, songID, level)
	if err != nil {
		writeQMMusicErr(c, err)
		return
	}
	pkg.OK(c, result)
}

// ParsePlaylist GET /api/v1/qm/parse-playlist?playlistId=
func (h *QMMusicHandler) ParsePlaylist(c *gin.Context) {
	playlistID := strings.TrimSpace(c.Query("playlistId"))
	if playlistID == "" {
		pkg.BadRequest(c, "playlistId 参数必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.ParsePlaylist(ctx, playlistID)
	if err != nil {
		writeQMMusicErr(c, err)
		return
	}
	pkg.OK(c, result)
}

// Convert GET /api/v1/qm/convert?id=
// 返回该歌曲的 mid 与数字 id
func (h *QMMusicHandler) Convert(c *gin.Context) {
	id := strings.TrimSpace(c.Query("id"))
	if id == "" {
		pkg.BadRequest(c, "id 参数必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.Convert(ctx, id)
	if err != nil {
		writeQMMusicErr(c, err)
		return
	}
	pkg.OK(c, result)
}

// Cover GET /api/v1/qm/cover?mid=&size=
func (h *QMMusicHandler) Cover(c *gin.Context) {
	mid := strings.TrimSpace(c.Query("mid"))
	if !qmAlbumMidRe.MatchString(mid) {
		pkg.BadRequest(c, "mid 参数非法")
		return
	}
	size := pkg.Clamp(pkg.ParseInt(c.Query("size"), 300), 100, 1000)

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	target := fmt.Sprintf(qmCoverURLTemplate, size, size, mid)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		pkg.InternalError(c, "封面获取失败")
		return
	}
	req.Header.Set("Referer", "https://y.qq.com/")
	req.Header.Set("User-Agent", "Mozilla/5.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeUpstreamErr(c, err, "封面获取失败")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		pkg.NotFound(c, "封面不存在")
		return
	}

	c.Header("Access-Control-Allow-Origin", "*")
	c.Header("Cache-Control", "public, max-age=86400")
	c.DataFromReader(http.StatusOK, resp.ContentLength, "image/jpeg", resp.Body, nil)
}

// writeQMMusicErr 统一处理 QQ 音乐解析错误
func writeQMMusicErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrInvalidInput):
		pkg.BadRequest(c, "请求参数非法")
	case errors.Is(err, service.ErrNotFound):
		pkg.NotFound(c, "未找到该歌曲")
	case errors.Is(err, service.ErrNoPlayableURL):
		pkg.Fail(c, http.StatusNotFound, http.StatusNotFound, "无可用播放链接")
	case errors.Is(err, service.ErrQMCredentialExpired):
		pkg.Fail(c, http.StatusServiceUnavailable, http.StatusServiceUnavailable, "QM登录凭据已失效")
	case errors.Is(err, service.ErrUpstreamUnavailable):
		writeUpstreamErr(c, err, "QM解析服务暂不可用")
	default:
		pkg.InternalError(c, "解析失败")
	}
}
