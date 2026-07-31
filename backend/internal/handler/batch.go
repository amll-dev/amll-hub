package handler

import (
	"context"
	"net/http"
	"strconv"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/gin-gonic/gin"
)

// BatchHandler 批量查询 handler
type BatchHandler struct {
	songRepo *repository.SongRepo
}

func NewBatchHandler(songRepo *repository.SongRepo) *BatchHandler {
	return &BatchHandler{songRepo: songRepo}
}

// BatchRequest 批量查询请求
type BatchRequest struct {
	Platform string   `json:"platform" binding:"required"`
	IDs      []string `json:"ids" binding:"required"`
}

// BatchItem 单条响应
type BatchItem struct {
	ID           string            `json:"id"`
	MusicNames   []string          `json:"musicNames"`
	Artists      []string          `json:"artists"`
	Albums       []string          `json:"albums"`
	PlatformIDs  map[string]string `json:"platformIds"`
	RawLyricFile string            `json:"rawLyricFile"`
	MinioPath    string            `json:"minioPath"`
}

// Post POST /api/v1/batch
func (h *BatchHandler) Post(c *gin.Context) {
	var req BatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "请求参数非法")
		return
	}
	if !pkg.IsValidPlatform(req.Platform) {
		pkg.BadRequest(c, "platform 参数非法")
		return
	}
	if len(req.IDs) == 0 {
		pkg.BadRequest(c, "ids 不能为空")
		return
	}
	if len(req.IDs) > 500 {
		pkg.BadRequest(c, "ids 数量不能超过 500")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	songMap, err := h.songRepo.BatchGetByPlatform(ctx, req.Platform, req.IDs)
	if err != nil {
		pkg.Fail(c, http.StatusInternalServerError, 500, "批量查询失败: "+err.Error())
		return
	}

	// 收集命中的 songID，批量查询关联数据避免 N+1
	songIDs := make([]int64, 0, len(songMap))
	for _, song := range songMap {
		songIDs = append(songIDs, song.ID)
	}
	artistsMap, err := h.songRepo.GetArtistsBySongIDs(ctx, songIDs)
	if err != nil {
		pkg.Fail(c, http.StatusInternalServerError, 500, "批量查询艺术家失败: "+err.Error())
		return
	}
	pmsMap, err := h.songRepo.GetPlatformMappingsBySongIDs(ctx, songIDs)
	if err != nil {
		pkg.Fail(c, http.StatusInternalServerError, 500, "批量查询平台映射失败: "+err.Error())
		return
	}

	// 构造响应：保持与请求 ids 顺序一致（命中的返回，未命中的跳过）
	items := make([]BatchItem, 0, len(songMap))
	for _, id := range req.IDs {
		song, ok := songMap[id]
		if !ok {
			continue
		}
		artists := artistsMap[song.ID]
		artistNames := make([]string, 0, len(artists))
		for _, a := range artists {
			artistNames = append(artistNames, a.Name)
		}
		pms := pmsMap[song.ID]
		platformIDs := map[string]string{}
		for _, pm := range pms {
			platformIDs[pm.Platform] = pm.PlatformID
		}

		items = append(items, BatchItem{
			ID:           serviceID(song.ID),
			MusicNames:   fromJSONArray(song.MusicName),
			Artists:      artistNames,
			Albums:       fromJSONArray(song.Album),
			PlatformIDs:  platformIDs,
			RawLyricFile: song.RawLyricFile,
			MinioPath:    song.MinioPath,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 200,
		"data": items,
	})
}

// serviceID 生成前端可识别的 song id
func serviceID(id int64) string {
	return "song_" + strconv.FormatInt(id, 10)
}

// fromJSONArray 将 model.JSONStringArray 转 []string，nil 时返回空数组
func fromJSONArray(arr []string) []string {
	if arr == nil {
		return []string{}
	}
	return arr
}
