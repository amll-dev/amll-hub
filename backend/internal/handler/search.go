package handler

import (
	"context"
	"errors"
	"strings"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// SearchHandler 搜索 handler
type SearchHandler struct {
	svc *service.SearchService
	// users 仅用于统计「用户」Tab 的命中数
	users *service.UserSearchService
}

func NewSearchHandler(svc *service.SearchService, users *service.UserSearchService) *SearchHandler {
	return &SearchHandler{svc: svc, users: users}
}

// Search GET /api/v1/search?q=&field=&limit=&offset=&all=
func (h *SearchHandler) Search(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	field := strings.TrimSpace(c.DefaultQuery("field", "all"))
	limit := pkg.Clamp(pkg.ParseInt(c.Query("limit"), 20), 1, 100)
	offset := pkg.Clamp(pkg.ParseInt(c.Query("offset"), 0), 0, 100000)
	// all=true 时返回全部命中
	if c.Query("all") == "true" {
		limit = 100000
	}

	// 校验 field
	switch field {
	case "all", "song", "artist", "album", "id", "lyric", "author":
	default:
		pkg.BadRequest(c, "field 参数非法")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	result, err := h.svc.Search(ctx, service.SearchRequest{
		Query:  q,
		Field:  field,
		Limit:  limit,
		Offset: offset,
	})
	if err != nil {
		if errors.Is(err, service.ErrUpstreamUnavailable) {
			writeUpstreamErr(c, err, "搜索服务暂不可用")
			return
		}
		logrus.WithError(err).Error("search failed")
		pkg.InternalError(c, "搜索失败")
		return
	}

	pkg.OK(c, result)
}

// Counts GET /api/v1/search/counts?q=
// 返回搜索结果页各 Tab 的命中数。
func (h *SearchHandler) Counts(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	totals := map[string]int64{
		"all": 0, "song": 0, "artist": 0, "album": 0,
		"lyric": 0, "id": 0, "author": 0, "user": 0,
	}
	userMore := false

	if q != "" {
		t, err := h.svc.CountByFields(ctx, q)
		if err != nil {
			if errors.Is(err, service.ErrUpstreamUnavailable) {
				writeUpstreamErr(c, err, "搜索服务暂不可用")
				return
			}
			logrus.WithError(err).Error("search counts failed")
			pkg.InternalError(c, "统计搜索数量失败")
			return
		}
		for k, v := range t {
			totals[k] = v
		}

		// 用户数来自 Casdoor
		if n, more, err := h.users.Count(ctx, q, 20); err == nil {
			totals["user"] = int64(n)
			userMore = more
		} else {
			logrus.WithError(err).Warn("count users for search tabs failed")
		}
	}

	pkg.OK(c, gin.H{
		"totals":   totals,
		"userMore": userMore,
	})
}
