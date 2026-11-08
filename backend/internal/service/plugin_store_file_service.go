package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/amll-dev/amll-hub/backend/internal/config"
	"github.com/minio/minio-go/v7"
)

const (
	pluginArtifactPrefix = "artifacts/"
	pluginIconPrefix     = "icons/"
)

// PluginStoreFileService 插件 artifact / 图标对象存储
type PluginStoreFileService struct {
	client *minio.Client
	bucket string
}

func NewPluginStoreFileService(ctx context.Context, cfg *config.Config, client *minio.Client) (*PluginStoreFileService, error) {
	bucket := cfg.PluginStore.Bucket
	if bucket == "" {
		bucket = "plugin-store"
	}
	exists, err := client.BucketExists(ctx, bucket)
	if err != nil {
		return nil, fmt.Errorf("check plugin store bucket: %w", err)
	}
	if !exists {
		if err := client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
			return nil, fmt.Errorf("create plugin store bucket %s: %w", bucket, err)
		}
	}
	return &PluginStoreFileService{client: client, bucket: bucket}, nil
}

func (s *PluginStoreFileService) Bucket() string { return s.bucket }

func (s *PluginStoreFileService) ArtifactKey(sha string) string {
	return pluginArtifactPrefix + sha + ".zip"
}

func (s *PluginStoreFileService) StatArtifact(ctx context.Context, sha string) (minio.ObjectInfo, bool, error) {
	info, err := s.client.StatObject(ctx, s.bucket, s.ArtifactKey(sha), minio.StatObjectOptions{})
	if err != nil {
		resp := minio.ToErrorResponse(err)
		if resp.Code == "NoSuchKey" {
			return minio.ObjectInfo{}, false, nil
		}
		return minio.ObjectInfo{}, false, err
	}
	return info, true, nil
}

// PutArtifact 内容寻址写入：已存在则直接复用，不覆盖
func (s *PluginStoreFileService) PutArtifact(ctx context.Context, sha string, file *os.File, size int64) (bool, error) {
	if _, exists, err := s.StatArtifact(ctx, sha); err != nil {
		return false, err
	} else if exists {
		return false, nil
	}
	_, err := s.client.PutObject(ctx, s.bucket, s.ArtifactKey(sha), file, size, minio.PutObjectOptions{
		ContentType: "application/zip",
	})
	if err != nil {
		return false, err
	}
	return true, nil
}

func (s *PluginStoreFileService) GetArtifact(ctx context.Context, sha string) (io.ReadCloser, minio.ObjectInfo, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, s.ArtifactKey(sha), minio.GetObjectOptions{})
	if err != nil {
		return nil, minio.ObjectInfo{}, err
	}
	info, err := obj.Stat()
	if err != nil {
		_ = obj.Close()
		return nil, minio.ObjectInfo{}, err
	}
	return obj, info, nil
}

func (s *PluginStoreFileService) DeleteArtifact(ctx context.Context, sha string) error {
	return s.deleteObject(ctx, s.ArtifactKey(sha))
}

func (s *PluginStoreFileService) DeleteIcon(ctx context.Context, key string) error {
	if key == "" {
		return nil
	}
	return s.deleteObject(ctx, key)
}

func (s *PluginStoreFileService) deleteObject(ctx context.Context, key string) error {
	err := s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
	if err != nil {
		resp := minio.ToErrorResponse(err)
		if resp.Code == "NoSuchKey" {
			return nil
		}
	}
	return err
}

// PutIcon 保存插件图标，返回对象 key
func (s *PluginStoreFileService) PutIcon(ctx context.Context, pluginKey string, data []byte, ext, mime string) (string, error) {
	sum := sha256.Sum256(data)
	name := hex.EncodeToString(sum[:])
	key := fmt.Sprintf("%s%s/%s%s", pluginIconPrefix, sanitizeObjectNameSegment(pluginKey), name, ext)
	_, err := s.client.PutObject(ctx, s.bucket, key, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{
		ContentType: mime,
	})
	if err != nil {
		return "", err
	}
	return key, nil
}

func (s *PluginStoreFileService) GetIcon(ctx context.Context, key string) (io.ReadCloser, minio.ObjectInfo, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, minio.ObjectInfo{}, err
	}
	info, err := obj.Stat()
	if err != nil {
		_ = obj.Close()
		return nil, minio.ObjectInfo{}, err
	}
	return obj, info, nil
}

// DetectPluginIcon 只识别 PNG / JPEG / WebP，拒绝 SVG
func DetectPluginIcon(data []byte) (ext, mime string, ok bool) {
	switch {
	case len(data) >= 8 && bytes.HasPrefix(data, []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}):
		return ".png", "image/png", true
	case len(data) >= 3 && bytes.HasPrefix(data, []byte{0xff, 0xd8, 0xff}):
		return ".jpg", "image/jpeg", true
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return ".webp", "image/webp", true
	default:
		return "", "", false
	}
}

// SniffObjectContentType 根据对象 key 推断流式响应的 Content-Type
func SniffObjectContentType(key string) string {
	switch strings.ToLower(key[strings.LastIndex(key, ".")+1:]) {
	case "png":
		return "image/png"
	case "jpg", "jpeg":
		return "image/jpeg"
	case "webp":
		return "image/webp"
	default:
		return "application/octet-stream"
	}
}

// PluginArtifactDownloadFilename 安全的下载文件名
func PluginArtifactDownloadFilename(pluginKey, version string) string {
	return sanitizeObjectNameSegment(pluginKey) + "-" + sanitizeObjectNameSegment(version) + ".zip"
}
