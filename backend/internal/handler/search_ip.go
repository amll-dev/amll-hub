package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
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

// SearchIPHandler 搜索IP投稿 handler
type SearchIPHandler struct {
	svc *service.SearchIPService
}

// NewSearchIPHandler 创建 SearchIPHandler
func NewSearchIPHandler(svc *service.SearchIPService) *SearchIPHandler {
	return &SearchIPHandler{svc: svc}
}

// Create POST /api/v1/search-ip/submissions
// multipart/form-data: title + data(JSON) + tempKeys(JSON: 文件名→临时key)
func (h *SearchIPHandler) Create(c *gin.Context) {
	user := currentUser(c)
	if user == nil {
		pkg.Unauthorized(c)
		return
	}

	userID := middleware.GetUserID(c)

	// 读取 title 字段
	title := c.PostForm("title")

	// 读取 data 字段
	dataStr := c.PostForm("data")
	if dataStr == "" {
		pkg.BadRequest(c, "data 字段必填")
		return
	}

	var data map[string]any
	if err := json.Unmarshal([]byte(dataStr), &data); err != nil {
		pkg.BadRequest(c, "data JSON 解析失败")
		return
	}

	// 读取 tempKeys 字段（文件名 → 临时 key）
	tempKeys := map[string]string{}
	tempKeysStr := c.PostForm("tempKeys")
	if tempKeysStr != "" {
		if err := json.Unmarshal([]byte(tempKeysStr), &tempKeys); err != nil {
			pkg.BadRequest(c, "tempKeys JSON 解析失败")
			return
		}
	}

	// 构建投稿者信息
	submitterInfo := model.JSONObject{
		"name":        user.Name,
		"displayName": user.DisplayName,
		"avatar":      user.Avatar,
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.CreateSubmission(ctx, userID, submitterInfo, &service.CreateSearchIPInput{
		Title:    title,
		Data:     data,
		TempKeys: tempKeys,
	})
	if err != nil {
		logrus.WithError(err).Warn("create search ip submission failed")
		pkg.BadRequest(c, err.Error())
		return
	}

	pkg.OK(c, result)
}

// UploadTemp POST /api/v1/search-ip/upload-temp
// 上传单张图片到临时区，返回 { tempKey }
func (h *SearchIPHandler) UploadTemp(c *gin.Context) {
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
		logrus.WithError(err).Warn("upload temp image failed")
		pkg.BadRequest(c, err.Error())
		return
	}

	pkg.OK(c, gin.H{"tempKey": tempKey})
}

// MatchRequest 匹配请求
type MatchRequest struct {
	Artists []string `json:"artists"`
}

// List GET /api/v1/search-ip/submissions
func (h *SearchIPHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	result, err := h.svc.ListBySubmitter(ctx, userID)
	if err != nil {
		logrus.WithError(err).Error("list search ip submissions failed")
		pkg.InternalError(c, "查询列表失败")
		return
	}
	pkg.OK(c, result)
}

// ListAll GET /api/v1/search-ip/submissions/all?status=pending|approved|rejected
// 查询全部用户的投稿
func (h *SearchIPHandler) ListAll(c *gin.Context) {
	status := c.DefaultQuery("status", "all")

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	result, err := h.svc.ListAll(ctx, status)
	if err != nil {
		logrus.WithError(err).Error("list all search ip submissions failed")
		pkg.InternalError(c, "查询列表失败")
		return
	}
	pkg.OK(c, result)
}

// SearchIPReviewRequest 审核请求
type SearchIPReviewRequest struct {
	Action string `json:"action"` // approve | reject
}

// Review POST /api/v1/search-ip/submissions/:id/review
// approve 通过公开展示，reject 不通过不展示
func (h *SearchIPHandler) Review(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		pkg.BadRequest(c, "无效的 id")
		return
	}

	var req SearchIPReviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "参数错误")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	if err := h.svc.Review(ctx, id, req.Action); err != nil {
		writeSubmissionErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "审核完成")
}

// GetDetail GET /api/v1/search-ip/submissions/:id
func (h *SearchIPHandler) GetDetail(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		pkg.BadRequest(c, "无效的 id")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	result, err := h.svc.GetByID(ctx, id)
	if err != nil {
		logrus.WithError(err).Error("get search ip detail failed")
		pkg.InternalError(c, "查询详情失败")
		return
	}
	pkg.OK(c, result)
}

// Match POST /api/v1/search-ip/match
func (h *SearchIPHandler) Match(c *gin.Context) {
	var req MatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "请求格式错误")
		return
	}

	if len(req.Artists) == 0 {
		pkg.OK(c, &service.MatchResult{
			Teams:   map[string]service.MatchTeam{},
			Members: map[string]service.MatchMember{},
		})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	result, err := h.svc.Match(ctx, req.Artists)
	if err != nil {
		logrus.WithError(err).Error("search ip match failed")
		pkg.InternalError(c, "匹配失败")
		return
	}

	pkg.OK(c, result)
}

// GetImage GET /api/v1/search-ip/image/*key
func (h *SearchIPHandler) GetImage(c *gin.Context) {
	key := c.Param("key")
	key = strings.TrimPrefix(key, "/")

	if key == "" {
		c.Status(http.StatusNotFound)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	obj, contentType, err := h.svc.GetImage(ctx, key)
	if err != nil {
		if errors.Is(err, service.ErrImageNotFound) {
			c.Status(http.StatusNotFound)
			return
		}
		logrus.WithError(err).Error("get search ip image failed")
		c.Status(http.StatusInternalServerError)
		return
	}
	defer func() { _ = obj.Close() }()

	c.Header("Content-Type", contentType)
	c.Header("Cache-Control", "public, max-age=3600")
	c.Status(http.StatusOK)
	if _, err := io.Copy(c.Writer, obj); err != nil {
		logrus.WithError(err).Error("stream search ip image failed")
	}
}
