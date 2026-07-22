package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/config"
	"github.com/amll-dev/amll-hub/backend/internal/handler"
	"github.com/amll-dev/amll-hub/backend/internal/infrastructure"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/amll-dev/amll-hub/backend/internal/router"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	logrus "github.com/sirupsen/logrus"
)

// Run 启动 HTTP 服务
func Run() {
	// 1. 加载配置
	cfg, err := config.Load()
	if err != nil {
		logrus.Fatalf("load config: %v", err)
	}

	// 日志格式
	logrus.SetFormatter(&logrus.JSONFormatter{
		TimestampFormat: time.RFC3339Nano,
	})
	logrus.SetLevel(logrus.InfoLevel)

	// 2. 初始化基础设施
	db, err := infrastructure.NewPostgres(cfg.Database)
	if err != nil {
		logrus.Fatalf("init postgres: %v", err)
	}

	redisClient, err := infrastructure.NewRedis(cfg.Redis)
	if err != nil {
		logrus.Fatalf("init redis: %v", err)
	}

	minioClient, err := infrastructure.NewMinIO(cfg.MinIO)
	if err != nil {
		logrus.Fatalf("init minio: %v", err)
	}

	mq, err := infrastructure.NewRabbitMQ(cfg.RabbitMQ)
	if err != nil {
		logrus.Fatalf("init rabbitmq: %v", err)
	}
	defer func() {
		if err := mq.Close(); err != nil {
			logrus.Errorf("close rabbitmq: %v", err)
		}
	}()

	meiliClient, err := infrastructure.NewMeiliSearch(cfg.MeiliSearch)
	if err != nil {
		logrus.Fatalf("init meilisearch: %v", err)
	}
	if err := infrastructure.EnsureMeiliSearchIndex(meiliClient, cfg.MeiliSearch.Index); err != nil {
		logrus.Warnf("ensure meilisearch index: %v", err)
	}

	// 3. 初始化 repository
	songRepo := repository.NewSongRepo(db)
	artistRepo := repository.NewArtistRepo(db)
	syncRepo := repository.NewSyncRepo(db)
	progressRepo := repository.NewSyncProgressRepo(db)
	notFoundRepo := repository.NewNotFoundRepo(db)

	// 4. 初始化 service
	syncSvc := service.NewSyncService(cfg, syncRepo, progressRepo, mq)
	lyricsSvc := service.NewLyricsService(cfg, songRepo, minioClient, redisClient)
	searchSvc := service.NewSearchService(cfg, meiliClient)
	statsSvc := service.NewStatsService(songRepo, artistRepo, syncRepo)
	indexSvc := service.NewIndexService(cfg, minioClient)
	notFoundSvc := service.NewNotFoundService(notFoundRepo, redisClient, mq)
	onlineSearchSvc := service.NewOnlineSearchService(cfg)
	cloudMusicSvc := service.NewCloudMusicService(cfg, redisClient)
	authSvc := service.NewAuthService(
		infrastructure.NewCasdoorClient(cfg.Casdoor),
		redisClient,
		cfg.Casdoor.JWTSecret,
		cfg.Casdoor.JWTTTL,
		cfg.Casdoor.Organization,
	)

	// 4.1 启动无歌词服务后台任务：白名单预热 + 每周清空
	appCtx, appCancel := context.WithCancel(context.Background())
	defer appCancel()
	{
		preloadCtx, preloadCancel := context.WithTimeout(context.Background(), 30*time.Second)
		if err := notFoundSvc.PreloadWhitelist(preloadCtx); err != nil {
			logrus.Warnf("preload not_found whitelist: %v", err)
		}
		preloadCancel()
		notFoundSvc.StartWeeklyClearTask(appCtx)
	}

	// 5. 初始化 handler
	syncH := handler.NewSyncHandler(syncSvc)
	lyricsH := handler.NewLyricsHandler(lyricsSvc, notFoundSvc)
	searchH := handler.NewSearchHandler(searchSvc)
	batchH := handler.NewBatchHandler(songRepo)
	statsH := handler.NewStatsHandler(statsSvc)
	indexH := handler.NewIndexHandler(indexSvc)
	nfH := handler.NewNotFoundHandler(notFoundSvc)
	onlineSearchH := handler.NewOnlineSearchHandler(onlineSearchSvc)
	cloudMusicH := handler.NewCloudMusicHandler(cloudMusicSvc)
	authH := handler.NewAuthHandler(authSvc)

	// 6. 启动 HTTP
	r := router.New(syncH, lyricsH, searchH, batchH, statsH, indexH, nfH, onlineSearchH, cloudMusicH, authH, cfg.Casdoor.JWTSecret)

	srv := &http.Server{
		Addr:              ":" + cfg.HTTP.Port,
		Handler:           r,
		ReadTimeout:       30 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	// 7. 优雅关闭
	go func() {
		logrus.Infof("http server listening on :%s", cfg.HTTP.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logrus.Fatalf("listen: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	appCancel()
	logrus.Info("shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		logrus.Errorf("server shutdown: %v", err)
	}
	if db != nil {
		if sqlDB, err := db.DB(); err == nil {
			_ = sqlDB.Close()
		}
	}
	if redisClient != nil {
		_ = redisClient.Close()
	}
	logrus.Info("server exited")
}

// _ 占位避免 fmt 未引用
var _ = fmt.Sprintf
