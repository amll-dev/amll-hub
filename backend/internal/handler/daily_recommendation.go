package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/amll-dev/amll-hub/backend/internal/middleware"
	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// DailyRecommendationHandler 每日推荐 handler
type DailyRecommendationHandler struct {
	svc *service.DailyRecommendationService
}

// NewDailyRecommendationHandler 创建 DailyRecommendationHandler
func NewDailyRecommendationHandler(svc *service.DailyRecommendationService) *DailyRecommendationHandler {
	return &DailyRecommendationHandler{svc: svc}
}

// Create POST /api/v1/daily-recommendations
func (h *DailyRecommendationHandler) Create(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	userID := middleware.GetUserID(c)

	input := &service.CreateDailyRecInput{
		SongName:     c.PostForm("songName"),
		Artist:       c.PostForm("artist"),
		CoverTempKey: c.PostForm("coverTempKey"),
		Date:         c.PostForm("date"),
		Comment:      c.PostForm("comment"),
		NcmID:        c.PostForm("ncmId"),
	}

	submitterInfo := model.JSONObject{
		"name":        user.Name,
		"displayName": user.DisplayName,
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.CreateRecommendation(ctx, userID, submitterInfo, input)
	if err != nil {
		logrus.WithError(err).Warn("create daily recommendation failed")
		pkg.BadRequest(c, err.Error())
		return
	}

	pkg.OK(c, result)
}

// UploadTemp POST /api/v1/daily-recommendations/upload-temp
func (h *DailyRecommendationHandler) UploadTemp(c *gin.Context) {
	if middleware.GetUserID(c) == "" {
		pkg.Unauthorized(c)
		return
	}

	fh, err := c.FormFile("file")
	if err != nil {
		pkg.BadRequest(c, "file 字段必填")
		return
	}
	f, err := fh.Open()
	if err != nil {
		pkg.BadRequest(c, "读取文件失败")
		return
	}
	defer f.Close()
	content, err := readLimited(f, maxTempImageSize)
	if err != nil {
		pkg.BadRequest(c, err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	tempKey, err := h.svc.UploadTemp(ctx, fh.Filename, content)
	if err != nil {
		logrus.WithError(err).Warn("upload daily rec temp image failed")
		pkg.BadRequest(c, err.Error())
		return
	}

	pkg.OK(c, gin.H{"tempKey": tempKey})
}

// UploadTempFromURL POST /api/v1/daily-recommendations/upload-temp-from-url
// 服务端代理下载图片 URL 并转存到临时区
func (h *DailyRecommendationHandler) UploadTempFromURL(c *gin.Context) {
	if middleware.GetUserID(c) == "" {
		pkg.Unauthorized(c)
		return
	}
	var body struct {
		URL string `json:"url"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		pkg.BadRequest(c, "请求参数无效")
		return
	}
	if body.URL == "" {
		pkg.BadRequest(c, "url 字段必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	tempKey, err := h.svc.UploadTempFromURL(ctx, body.URL)
	if err != nil {
		logrus.WithError(err).Warn("upload daily rec temp image from url failed")
		pkg.BadRequest(c, err.Error())
		return
	}
	pkg.OK(c, gin.H{"tempKey": tempKey})
}

// CheckDate GET /api/v1/daily-recommendations/check-date?date=YYYY-MM-DD
func (h *DailyRecommendationHandler) CheckDate(c *gin.Context) {
	if middleware.GetUserID(c) == "" {
		pkg.Unauthorized(c)
		return
	}
	date := c.Query("date")
	if date == "" {
		pkg.BadRequest(c, "date 参数必填")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	available, err := h.svc.CheckDate(ctx, date)
	if err != nil {
		pkg.InternalError(c, "检查日期失败")
		return
	}
	pkg.OK(c, gin.H{"available": available})
}

// ListAll GET /api/v1/daily-recommendations
func (h *DailyRecommendationHandler) ListAll(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	recs, err := h.svc.ListAll(ctx)
	if err != nil {
		pkg.InternalError(c, "查询列表失败")
		return
	}
	pkg.OK(c, recs)
}

// GetToday GET /api/v1/daily-recommendations/today
func (h *DailyRecommendationHandler) GetToday(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	rec, err := h.svc.GetToday(ctx)
	if err != nil {
		// 今天没有推荐，返回 null
		pkg.OK(c, nil)
		return
	}
	pkg.OK(c, rec)
}

// GetByDate GET /api/v1/daily-recommendations/:date
func (h *DailyRecommendationHandler) GetByDate(c *gin.Context) {
	date := c.Param("date")
	if date == "" {
		pkg.BadRequest(c, "date 参数必填")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	rec, err := h.svc.GetByDate(ctx, date)
	if err != nil {
		pkg.OK(c, nil)
		return
	}
	pkg.OK(c, rec)
}

// ListMine GET /api/v1/daily-recommendations/submissions
func (h *DailyRecommendationHandler) ListMine(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	result, err := h.svc.ListBySubmitter(ctx, userID)
	if err != nil {
		pkg.InternalError(c, "查询列表失败")
		return
	}
	pkg.OK(c, result)
}

// GetDetail GET /api/v1/daily-recommendations/submissions/:id
func (h *DailyRecommendationHandler) GetDetail(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		pkg.BadRequest(c, "无效的 id")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	rec, err := h.svc.GetByID(ctx, id)
	if err != nil {
		logrus.WithError(err).Error("get daily rec detail failed")
		pkg.InternalError(c, "查询详情失败")
		return
	}
	pkg.OK(c, rec)
}

// GetLike GET /api/v1/daily-recommendations/like/:id
func (h *DailyRecommendationHandler) GetLike(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		pkg.BadRequest(c, "无效的 id")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	status, err := h.svc.GetLikeStatus(ctx, id, user.Name)
	if err != nil {
		if errors.Is(err, service.ErrDailyRecNotFound) {
			pkg.Fail(c, http.StatusNotFound, http.StatusNotFound, "推荐不存在")
			return
		}
		logrus.WithError(err).Warn("get daily rec like status failed")
		pkg.InternalError(c, "查询点赞状态失败")
		return
	}
	pkg.OK(c, status)
}

// ToggleLike POST /api/v1/daily-recommendations/like/:id（需登录）
func (h *DailyRecommendationHandler) ToggleLike(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		pkg.BadRequest(c, "无效的 id")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()
	status, err := h.svc.ToggleLike(ctx, id, user.Name)
	if err != nil {
		if errors.Is(err, service.ErrDailyRecNotFound) {
			pkg.Fail(c, http.StatusNotFound, http.StatusNotFound, "推荐不存在")
			return
		}
		logrus.WithError(err).Warn("toggle daily rec like failed")
		pkg.InternalError(c, "操作失败")
		return
	}
	pkg.OK(c, status)
}

// GetImage GET /api/v1/daily-recommendations/image/*key
func (h *DailyRecommendationHandler) GetImage(c *gin.Context) {
	key := c.Param("key")
	key = strings.TrimPrefix(key, "/")
	if key == "" {
		c.Status(http.StatusNotFound)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()
	content, contentType, err := h.svc.GetImage(ctx, key)
	if err != nil {
		if errors.Is(err, service.ErrDailyRecNotFound) {
			c.Status(http.StatusNotFound)
			return
		}
		logrus.WithError(err).Error("get daily rec image failed")
		c.Status(http.StatusInternalServerError)
		return
	}
	c.Header("Cache-Control", "public, max-age=60, must-revalidate")
	c.Data(http.StatusOK, contentType, content)
}
