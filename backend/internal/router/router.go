package router

import (
	"os"
	"strings"

	"github.com/amll-dev/amll-hub/backend/internal/handler"
	"github.com/amll-dev/amll-hub/backend/internal/middleware"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	logrus "github.com/sirupsen/logrus"
)

// RouterDeps 路由构建依赖（各 handler、审核员缓存与 JWT 密钥）
type RouterDeps struct {
	Sync         *handler.SyncHandler
	Lyrics       *handler.LyricsHandler
	Search       *handler.SearchHandler
	Batch        *handler.BatchHandler
	Stats        *handler.StatsHandler
	Index        *handler.IndexHandler
	NotFound     *handler.NotFoundHandler
	OnlineSearch *handler.OnlineSearchHandler
	CloudMusic   *handler.CloudMusicHandler
	Auth         *handler.AuthHandler
	Submission   *handler.SubmissionHandler
	Review       *handler.ReviewHandler
	Comment      *handler.CommentHandler
	Upload       *handler.UploadHandler
	SearchIP     *handler.SearchIPHandler
	DailyRec     *handler.DailyRecommendationHandler
	WS           *handler.WSHandler
	Validate     *handler.ValidateHandler
	LatestSong   *handler.LatestSongHandler
	Admin        *handler.AdminHandler

	ReviewerCache *middleware.ReviewerCache
	AdminCache    *middleware.AdminCache
	JWTSecret     string
}

// New 构建并返回 Gin 引擎
func New(deps RouterDeps) *gin.Engine {
	syncH := deps.Sync
	lyricsH := deps.Lyrics
	searchH := deps.Search
	batchH := deps.Batch
	statsH := deps.Stats
	indexH := deps.Index
	nfH := deps.NotFound
	onlineSearchH := deps.OnlineSearch
	cloudMusicH := deps.CloudMusic
	authH := deps.Auth
	submissionH := deps.Submission
	reviewH := deps.Review
	commentH := deps.Comment
	uploadH := deps.Upload
	searchIpH := deps.SearchIP
	dailyRecH := deps.DailyRec
	wsH := deps.WS
	validateH := deps.Validate
	latestSongH := deps.LatestSong
	adminH := deps.Admin
	reviewerCache := deps.ReviewerCache
	adminCache := deps.AdminCache
	jwtSecret := deps.JWTSecret

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()

	// 受信代理配置
	if tp := os.Getenv("TRUSTED_PROXIES"); tp != "" {
		proxies := strings.Split(tp, ",")
		for i := range proxies {
			proxies[i] = strings.TrimSpace(proxies[i])
		}
		if err := r.SetTrustedProxies(proxies); err != nil {
			logrus.Warnf("set trusted proxies failed: %v", err)
		}
	} else {
		_ = r.SetTrustedProxies(nil)
	}

	r.Use(middleware.RequestID())
	r.Use(middleware.Logger())
	r.Use(middleware.Recovery())
	corsConfig := cors.Config{
		AllowMethods:     []string{"GET", "POST", "PUT", "OPTIONS"},
		AllowHeaders:     []string{"Authorization", "Content-Type", "X-Request-ID"},
		ExposeHeaders:    []string{"Content-Length", "ETag", "X-Request-ID"},
		AllowCredentials: false,
	}
	if allowedOrigins := os.Getenv("CORS_ALLOWED_ORIGINS"); allowedOrigins != "" {
		corsConfig.AllowOrigins = strings.Split(allowedOrigins, ",")
	} else {
		corsConfig.AllowAllOrigins = true
	}
	r.Use(cors.New(corsConfig))

	// 健康检查
	r.GET("/health", func(c *gin.Context) {
		pkg.OK(c, gin.H{"status": "ok"})
	})

	// ws
	r.GET("/ws/viewers", wsH.Viewers)

	api := r.Group("/api/v1")
	{
		// 搜索
		api.GET("/search", searchH.Search)

		// 同步触发/状态
		api.POST("/sync", syncH.Trigger)
		api.GET("/sync/status", syncH.Status)

		// 在线搜索
		online := api.Group("/online")
		{
			online.GET("/search", onlineSearchH.Search)
			online.GET("/songs/:platform/:songId", onlineSearchH.GetSong)
			online.GET("/lyrics/:platform/:songId", onlineSearchH.GetLyric)
		}

		// 网易云解析
		api.GET("/ncm/search", cloudMusicH.Search)
		api.GET("/ncm/parse-music", cloudMusicH.ParseMusic)
		api.GET("/ncm/parse-playlist", cloudMusicH.ParsePlaylist)

		// 批量查询
		api.POST("/songs/batch", batchH.Post)

		// 词库统计
		api.GET("/stats", statsH.Get)

		// 索引文件下载
		api.GET("/index/*path", indexH.GetIndex)

		// 投稿音频/封面文件流式播放
		api.GET("/uploads/file/*key", uploadH.ServeFile)

		// 无歌词记录系统
		api.GET("/not-found-ranking", nfH.GetRanking)
		api.GET("/not-found-stats", nfH.GetStats)
		api.GET("/pure-music-whitelist", nfH.ListPureMusicWhitelist)
		api.GET("/cloud-music-whitelist", nfH.ListCloudMusicWhitelist)

		// 用户认证系统
		auth := api.Group("/auth")
		{
			auth.POST("/login", authH.Login)
			auth.POST("/login-code", authH.LoginByCode)
			auth.POST("/register", authH.Register)
			auth.POST("/send-code", authH.SendCode)
			auth.POST("/check-user", authH.CheckUser)
			auth.POST("/forgot-password", authH.ForgotPassword)
			auth.GET("/captcha", authH.GetCaptcha)

			// 受保护接口
			protected := auth.Group("")
			protected.Use(middleware.Auth(jwtSecret))
			protected.GET("/profile", authH.GetProfile)
			protected.PUT("/profile", authH.UpdateProfile)
			protected.POST("/change-password", authH.ChangePassword)
			protected.POST("/avatar", authH.UploadAvatar)
		}

		// 投稿模块
		sub := api.Group("")
		sub.Use(middleware.Auth(jwtSecret))
		{
			// 投稿 CRUD
			sub.POST("/submissions", submissionH.Create)
			sub.GET("/submissions", submissionH.List)
			sub.GET("/submissions/stats", submissionH.Stats)
			sub.GET("/submissions/:id", submissionH.GetDetail)
			sub.GET("/submissions/:id/ttml", submissionH.GetTtml)
			sub.PUT("/submissions/:id/file", submissionH.UpdateFile)
			sub.POST("/submissions/:id/close", submissionH.Close)

			// TTML 校验
			sub.POST("/submissions/validate", validateH.Validate)

			// 审核
			sub.POST("/submissions/:id/review",
				middleware.RequireReviewer(reviewerCache),
				reviewH.Review,
			)
			// 标记为审核中
			sub.POST("/submissions/:id/mark-reviewing",
				middleware.RequireReviewer(reviewerCache),
				reviewH.MarkReviewing,
			)
			// 释放审核占用
			sub.POST("/submissions/:id/release-review",
				middleware.RequireReviewer(reviewerCache),
				reviewH.ReleaseReview,
			)

			// 评论
			sub.GET("/submissions/:id/comments", commentH.List)
			sub.POST("/submissions/:id/comments", commentH.Create)

			// 文件上传
			sub.POST("/uploads/ttml", uploadH.UploadTTML)
			sub.POST("/uploads/audio", uploadH.UploadAudio)

			// 搜索IP显示投稿
			sub.POST("/search-ip/submissions", searchIpH.Create)
			sub.GET("/search-ip/submissions", searchIpH.List)
			// 审核中心全量列表（仅审核员；all 为静态段，优先于 :id 匹配）
			sub.GET("/search-ip/submissions/all",
				middleware.RequireReviewer(reviewerCache),
				searchIpH.ListAll,
			)
			sub.GET("/search-ip/submissions/:id", searchIpH.GetDetail)
			// 搜索IP投稿审核
			sub.POST("/search-ip/submissions/:id/review",
				middleware.RequireReviewer(reviewerCache),
				searchIpH.Review,
			)
			sub.POST("/search-ip/upload-temp", searchIpH.UploadTemp)

			// 审核员管理
			adminGrp := sub.Group("/admin")
			adminGrp.Use(middleware.RequireAdmin(adminCache))
			{
				adminGrp.GET("/reviewers", adminH.ListReviewers)
				adminGrp.POST("/reviewers", adminH.AddReviewer)
				adminGrp.DELETE("/reviewers/:username", adminH.RemoveReviewer)
			}

			// 每日推荐投稿
			sub.POST("/daily-recommendations", dailyRecH.Create)
			sub.POST("/daily-recommendations/upload-temp", dailyRecH.UploadTemp)
			sub.POST("/daily-recommendations/upload-temp-from-url", dailyRecH.UploadTempFromURL)
			sub.GET("/daily-recommendations/check-date", dailyRecH.CheckDate)
			sub.GET("/daily-recommendations/submissions", dailyRecH.ListMine)
			sub.GET("/daily-recommendations/submissions/:id", dailyRecH.GetDetail)
			// 点赞
			sub.GET("/daily-recommendations/like/:id", dailyRecH.GetLike)
			sub.POST("/daily-recommendations/like/:id", dailyRecH.ToggleLike)
		}

		// 搜索IP显示
		api.POST("/search-ip/match", searchIpH.Match)
		api.GET("/search-ip/image/*key", searchIpH.GetImage)

		// 每日推荐
		api.GET("/daily-recommendations", dailyRecH.ListAll)
		api.GET("/daily-recommendations/today", dailyRecH.GetToday)
		api.GET("/daily-recommendations/date/:date", dailyRecH.GetByDate)
		api.GET("/daily-recommendations/image/*key", dailyRecH.GetImage)

		// 最新收录
		api.GET("/latest-songs", latestSongH.List)

		// 歌词获取
		// :folder ∈ {raw-lyrics, ncm-lyrics, qq-lyrics, spotify-lyrics, am-lyrics}
		api.GET("/lyrics/:folder/:filename", lyricsH.GetLyrics)
		// 歌词查看
		api.GET("/lyrics/view/:filename", lyricsH.ViewLyric)
		// 歌词解析
		api.POST("/lyrics/parse", lyricsH.ParseLyric)
	}

	return r
}
