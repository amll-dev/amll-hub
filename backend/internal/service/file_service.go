package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"path"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/config"
	"github.com/minio/minio-go/v7"
)

// 投稿前缀
const (
	PendingLyricsPrefix  = "tg-lyrics/"
	ApprovedLyricsPrefix = "shtg-lyrics/"
	MusicPrefix          = "music/"
	CoverPrefix          = "tg-image/"
)

// FileService 投稿模块文件服务
type FileService struct {
	cfg    *config.Config
	minio  *minio.Client
	bucket string
}

// NewFileService 创建文件服务
func NewFileService(cfg *config.Config, minioClient *minio.Client) *FileService {
	return &FileService{
		cfg:    cfg,
		minio:  minioClient,
		bucket: cfg.MinIO.Bucket,
	}
}

// MaxTTMLSize 返回 TTML 文件大小上限（handler 层读取时前置校验用）
func (s *FileService) MaxTTMLSize() int64 { return s.cfg.Submission.MaxTTMLSize }

// MaxAudioSize 返回音频文件大小上限
func (s *FileService) MaxAudioSize() int64 { return s.cfg.Submission.MaxAudioSize }

// MaxImageSize 返回图片文件大小上限
func (s *FileService) MaxImageSize() int64 { return s.cfg.Submission.MaxImageSize }

// UploadTTML 上传 TTML 到待审核目录
func (s *FileService) UploadTTML(ctx context.Context, fileName string, content []byte) error {
	if err := validateTTMLFileName(fileName); err != nil {
		return err
	}
	if len(content) > int(s.cfg.Submission.MaxTTMLSize) {
		return fmt.Errorf("TTML 文件大小超过 %d 字节", s.cfg.Submission.MaxTTMLSize)
	}
	key := PendingLyricsPrefix + fileName
	_, err := s.minio.PutObject(ctx, s.bucket, key, bytes.NewReader(content), int64(len(content)), minio.PutObjectOptions{
		ContentType: "application/xml; charset=utf-8",
	})
	return err
}

// UploadAudio 上传音频附件
func (s *FileService) UploadAudio(ctx context.Context, submissionID int64, fileName string, content []byte) (string, error) {
	if len(content) > int(s.cfg.Submission.MaxAudioSize) {
		return "", fmt.Errorf("音频文件大小超过 %d 字节", s.cfg.Submission.MaxAudioSize)
	}
	ext := path.Ext(fileName)
	if !isAllowedAudioExt(ext) {
		return "", fmt.Errorf("不支持的音频格式: %s", ext)
	}
	key := fmt.Sprintf("%s%d-%d%s", MusicPrefix, submissionID, time.Now().UnixMilli(), ext)
	_, err := s.minio.PutObject(ctx, s.bucket, key, bytes.NewReader(content), int64(len(content)), minio.PutObjectOptions{
		ContentType: audioContentType(ext),
	})
	if err != nil {
		return "", err
	}
	return key, nil
}

// UploadCover 上传封面图，返回对象 key
func (s *FileService) UploadCover(ctx context.Context, submissionID int64, fileName string, content []byte) (string, error) {
	if len(content) > int(s.cfg.Submission.MaxImageSize) {
		return "", fmt.Errorf("封面图大小超过 %d 字节", s.cfg.Submission.MaxImageSize)
	}
	ext := path.Ext(fileName)
	if !isAllowedImageExt(ext) {
		return "", fmt.Errorf("不支持的图片格式: %s", ext)
	}
	key := fmt.Sprintf("%s%d-%d%s", CoverPrefix, submissionID, time.Now().UnixMilli(), ext)
	_, err := s.minio.PutObject(ctx, s.bucket, key, bytes.NewReader(content), int64(len(content)), minio.PutObjectOptions{
		ContentType: imageContentType(ext),
	})
	if err != nil {
		return "", err
	}
	return key, nil
}

// CoverURL 返回封面在 MinIO 中的完整对象 key
func (s *FileService) CoverURL(coverKey string) string {
	if coverKey == "" {
		return ""
	}
	return coverKey
}

// Exists 检查对象是否存在
func (s *FileService) Exists(ctx context.Context, key string) (bool, error) {
	if key == "" {
		return false, nil
	}
	_, err := s.minio.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{})
	if err != nil {
		resp := minio.ToErrorResponse(err)
		if resp.Code == "NoSuchKey" {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// Get 待审核 TTML 内容
func (s *FileService) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	obj, err := s.minio.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	if _, statErr := obj.Stat(); statErr != nil {
		_ = obj.Close()
		return nil, statErr
	}
	return obj, nil
}

// GetWithStat 返回可 Seek 的对象及其大小/修改时间，用于 HTTP Range 请求（音频流式播放）
func (s *FileService) GetWithStat(ctx context.Context, key string) (io.ReadSeekCloser, int64, time.Time, error) {
	obj, err := s.minio.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, 0, time.Time{}, err
	}
	info, statErr := obj.Stat()
	if statErr != nil {
		_ = obj.Close()
		return nil, 0, time.Time{}, statErr
	}
	return obj, info.Size, info.LastModified, nil
}

// Move 复制对象到新 key 并删除旧对象
func (s *FileService) Move(ctx context.Context, srcKey, dstKey string) error {
	if srcKey == dstKey {
		return nil
	}
	dst := minio.CopyDestOptions{Bucket: s.bucket, Object: dstKey}
	src := minio.CopySrcOptions{Bucket: s.bucket, Object: srcKey}
	if _, err := s.minio.CopyObject(ctx, dst, src); err != nil {
		return fmt.Errorf("copy object: %w", err)
	}
	if err := s.minio.RemoveObject(ctx, s.bucket, srcKey, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("remove source object: %w", err)
	}
	return nil
}

// Delete 删除对象
func (s *FileService) Delete(ctx context.Context, key string) error {
	if key == "" {
		return nil
	}
	err := s.minio.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
	if err != nil {
		resp := minio.ToErrorResponse(err)
		if resp.Code == "NoSuchKey" {
			return nil
		}
		return err
	}
	return nil
}

// PendingLyricKey 拼接待审核 TTML 的完整对象 key
func PendingLyricKey(fileName string) string {
	return PendingLyricsPrefix + fileName
}

// ApprovedLyricKey 拼接已审核 TTML 的完整对象 key
func ApprovedLyricKey(fileName string) string {
	return ApprovedLyricsPrefix + fileName
}

// validateTTMLFileName 校验 TTML 文件名格式。
// 仅允许安全字符集，防止 ../ 等路径穿越进入 MinIO key 与 GitHub 仓库路径
func validateTTMLFileName(name string) error {
	if !strings.HasSuffix(name, ".ttml") {
		return errors.New("文件名必须以 .ttml 结尾")
	}
	if len(name) > 255 {
		return errors.New("文件名过长")
	}
	base := strings.TrimSuffix(name, ".ttml")
	if base == "" {
		return errors.New("文件名不能为空")
	}
	if strings.Contains(base, "..") {
		return errors.New("文件名不能包含连续的点")
	}
	for _, r := range base {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '.', r == '_', r == '-', r == '(', r == ')', r == '[', r == ']':
		case r >= 0x4e00 && r <= 0x9fff: // 常用汉字
		case r >= 0x3040 && r <= 0x30ff: // 日文假名
		case r >= 0xac00 && r <= 0xd7af: // 韩文音节
		default:
			return errors.New("文件名含有非法字符")
		}
	}
	return nil
}

func isAllowedAudioExt(ext string) bool {
	switch strings.ToLower(ext) {
	case ".mp3", ".flac", ".wav", ".m4a", ".ogg", ".aac":
		return true
	}
	return false
}

func isAllowedImageExt(ext string) bool {
	switch strings.ToLower(ext) {
	case ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp":
		return true
	}
	return false
}

func audioContentType(ext string) string {
	switch strings.ToLower(ext) {
	case ".mp3":
		return "audio/mpeg"
	case ".flac":
		return "audio/flac"
	case ".wav":
		return "audio/wav"
	case ".m4a":
		return "audio/mp4"
	case ".ogg":
		return "audio/ogg"
	case ".aac":
		return "audio/aac"
	}
	return "application/octet-stream"
}

func imageContentType(ext string) string {
	switch strings.ToLower(ext) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".bmp":
		return "image/bmp"
	}
	return "application/octet-stream"
}
