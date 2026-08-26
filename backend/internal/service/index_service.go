package service

import (
	"context"
	"io"

	"github.com/amll-dev/amll-hub/backend/internal/config"
	"github.com/minio/minio-go/v7"
)

// IndexService 索引文件下载服务
type IndexService struct {
	cfg   *config.Config
	minio *minio.Client
}

func NewIndexService(cfg *config.Config, minioClient *minio.Client) *IndexService {
	return &IndexService{cfg: cfg, minio: minioClient}
}

// GetIndexFile 从 MinIO 获取索引文件，返回 ReadCloser
func (s *IndexService) GetIndexFile(ctx context.Context, minioKey string) (io.ReadCloser, error) {
	obj, err := s.minio.GetObject(ctx, s.cfg.MinIO.Bucket, minioKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}

	// 检查对象是否存在
	if _, statErr := obj.Stat(); statErr != nil {
		_ = obj.Close()
		return nil, ErrIndexNotFound
	}

	return obj, nil
}
