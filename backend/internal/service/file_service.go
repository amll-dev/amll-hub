package service

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
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
	RevisionLyricsPrefix = "tg-lyrics-review/"
	// ProfileBannerPrefix 用户主页背景图，需在 handler 的匿名可读白名单里
	ProfileBannerPrefix = "profile-banner/"
	// DocsImagePrefix 文档图片，需在 handler 的匿名可读白名单里
	DocsImagePrefix = "docs/"
)

// TempLyricsPrefix 临时 TTML 对象前缀：tg-lyrics/.tmp-<nano>-<fileName>。
// 投稿保存事务成功后会被 Move 到正式 key；进程崩溃/中断时残留的对象
// 由 job.TempObjectCleanupJob 按 TTL 回收。
const TempLyricsPrefix = PendingLyricsPrefix + ".tmp-"

// MaxProfileBannerSize 主页背景图大小上限（前端压缩后远小于此值）
const MaxProfileBannerSize = 5 << 20

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
		return invalidInput("%v", err)
	}
	if len(content) > int(s.cfg.Submission.MaxTTMLSize) {
		return invalidInput("TTML 文件大小超过 %d 字节", s.cfg.Submission.MaxTTMLSize)
	}
	key := PendingLyricsPrefix + fileName
	_, err := s.minio.PutObject(ctx, s.bucket, key, bytes.NewReader(content), int64(len(content)), minio.PutObjectOptions{
		ContentType: "application/xml; charset=utf-8",
	})
	return err
}

// UploadTTMLTemp 上传到临时对象，事务成功后再 Move 到正式 key，避免事务失败覆盖正式文件
func (s *FileService) UploadTTMLTemp(ctx context.Context, fileName string, content []byte) (string, error) {
	if err := validateTTMLFileName(fileName); err != nil {
		return "", invalidInput("%v", err)
	}
	if len(content) > int(s.cfg.Submission.MaxTTMLSize) {
		return "", invalidInput("TTML 文件大小超过 %d 字节", s.cfg.Submission.MaxTTMLSize)
	}
	key := fmt.Sprintf("%s.tmp-%d-%s", PendingLyricsPrefix, time.Now().UnixNano(), fileName)
	_, err := s.minio.PutObject(ctx, s.bucket, key, bytes.NewReader(content), int64(len(content)), minio.PutObjectOptions{
		ContentType: "application/xml; charset=utf-8",
	})
	if err != nil {
		return "", err
	}
	return key, nil
}

// UploadAudio 上传音频附件
func (s *FileService) UploadAudio(ctx context.Context, submissionID int64, fileName string, content []byte) (string, error) {
	if len(content) > int(s.cfg.Submission.MaxAudioSize) {
		return "", invalidInput("音频文件大小超过 %d 字节", s.cfg.Submission.MaxAudioSize)
	}
	ext := path.Ext(fileName)
	if !isAllowedAudioExt(ext) {
		return "", invalidInput("不支持的音频格式: %s", ext)
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
		return "", invalidInput("封面图大小超过 %d 字节", s.cfg.Submission.MaxImageSize)
	}
	if err := validateImageUpload(fileName, content); err != nil {
		return "", err
	}
	ext := strings.ToLower(path.Ext(fileName))
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

// UploadProfileBanner 上传用户主页背景图，返回对象 key
func (s *FileService) UploadProfileBanner(ctx context.Context, username string, content []byte, ext string) (string, error) {
	if len(content) == 0 {
		return "", ErrInvalidInput
	}
	if len(content) > MaxProfileBannerSize {
		return "", fmt.Errorf("背景图大小超过 %d 字节", MaxProfileBannerSize)
	}
	ext = strings.ToLower(ext)
	switch ext {
	case ".jpg", ".jpeg", ".png", ".webp":
	default:
		return "", fmt.Errorf("不支持的背景图格式: %s", ext)
	}
	key := fmt.Sprintf("%s%s-%d%s", ProfileBannerPrefix, sanitizeObjectNameSegment(username), time.Now().UnixMilli(), ext)
	if _, err := s.minio.PutObject(ctx, s.bucket, key, bytes.NewReader(content), int64(len(content)), minio.PutObjectOptions{
		ContentType: imageContentType(ext),
	}); err != nil {
		return "", err
	}
	return key, nil
}

// UploadDocImage 上传文档图片，返回对象 key
func (s *FileService) UploadDocImage(ctx context.Context, relPath string, content []byte) (string, error) {
	if len(content) == 0 {
		return "", invalidInput("图片内容为空")
	}
	if len(content) > MaxDocImageSize {
		return "", invalidInput("图片大小超过 %d 字节", MaxDocImageSize)
	}
	clean, ext, err := sanitizeDocImagePath(relPath)
	if err != nil {
		return "", err
	}
	if err := validateDocImage(ext, content); err != nil {
		return "", err
	}
	key := DocsImagePrefix + clean
	if _, err := s.minio.PutObject(ctx, s.bucket, key, bytes.NewReader(content), int64(len(content)), minio.PutObjectOptions{
		ContentType: imageContentType(ext),
	}); err != nil {
		return "", err
	}
	return key, nil
}

// sanitizeDocImagePath 逐段清洗文档图片的相对路径，拒绝路径穿越与空段
func sanitizeDocImagePath(relPath string) (string, string, error) {
	relPath = strings.ReplaceAll(strings.TrimSpace(relPath), "\\", "/")
	relPath = strings.TrimPrefix(relPath, "/")
	parts := strings.Split(relPath, "/")
	if len(parts) == 0 || len(parts) > 3 {
		return "", "", invalidInput("图片路径非法")
	}
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p == "" || p == "." || p == ".." {
			return "", "", invalidInput("图片路径非法")
		}
		out = append(out, sanitizeObjectNameSegment(p))
	}
	ext := strings.ToLower(path.Ext(out[len(out)-1]))
	if ext == "" {
		return "", "", invalidInput("缺少文件扩展名")
	}
	return strings.Join(out, "/"), ext, nil
}

// validateDocImage 文档图片校验：SVG 单独判断（魔数嗅探不适用），其余走图片嗅探
func validateDocImage(ext string, content []byte) error {
	if ext == ".svg" {
		return validateSVGContent(content)
	}
	return validateImageUpload("image"+ext, content)
}

// validateSVGContent 按 XML 逐节点白名单校验文档 SVG。
//
// 真正兜住 XSS 的是 ServeFile 给 .svg 加的 CSP sandbox，但那是「两层里只有
// 一层是真的」：一旦图片改走 CDN 直链、或新增一个不设响应头的文件服务，
// 上传侧原来只看 <svg / <script 的粗筛就形同虚设（onload、<animate onbegin>、
// foreignObject 里的 iframe 都能过）。这里让上传侧自己也站得住：
// 拒绝事件属性、脚本/外链载体与 javascript:/data: 值，合法 SVG 不受影响。
func validateSVGContent(content []byte) error {
	decoder := xml.NewDecoder(bytes.NewReader(content))
	seenRoot := false
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return invalidInput("SVG 内容无法解析")
		}
		start, ok := token.(xml.StartElement)
		if !ok {
			continue
		}
		name := strings.ToLower(start.Name.Local)
		if !seenRoot {
			if name != "svg" {
				return invalidInput("SVG 缺少根元素")
			}
			seenRoot = true
		}
		switch name {
		case "script", "foreignobject", "iframe", "object", "embed", "handler":
			return invalidInput("SVG 含不允许的元素 %s", name)
		}
		for _, attr := range start.Attr {
			attrName := strings.ToLower(attr.Name.Local)
			value := strings.ToLower(strings.TrimSpace(attr.Value))
			if strings.HasPrefix(attrName, "on") {
				return invalidInput("SVG 含事件属性")
			}
			if strings.Contains(value, "javascript:") || strings.Contains(value, "expression(") || strings.HasPrefix(value, "data:") {
				return invalidInput("SVG 含不安全的属性值")
			}
			// <use xlink:href> 的片段引用是合法且常见的；外部链接一律拒绝，
			// 否则 SVG 可以自己拉起跨域请求或加载脚本载体。
			if attrName == "href" && value != "" && !strings.HasPrefix(value, "#") {
				return invalidInput("SVG 含外部链接")
			}
		}
	}
	if !seenRoot {
		return invalidInput("SVG 内容无法识别")
	}
	return nil
}

// sanitizeObjectNameSegment 把用户名收敛成安全的 key 片段，
// 避免分隔符 / 路径穿越字符进入对象名。
func sanitizeObjectNameSegment(name string) string {
	out := make([]rune, 0, len(name))
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '_', r == '-':
			out = append(out, r)
		default:
			out = append(out, '_')
		}
	}
	if len(out) == 0 {
		return "user"
	}
	return string(out)
}

// TempObject 临时对象的最小描述，避免把 minio 类型泄漏到 job 层
type TempObject struct {
	Key          string
	Size         int64
	LastModified time.Time
}

// ListTempObjects 列出 TempLyricsPrefix 下的临时对象
func (s *FileService) ListTempObjects(ctx context.Context) ([]TempObject, error) {
	objCh := s.minio.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{
		Prefix:    TempLyricsPrefix,
		Recursive: true,
	})
	out := make([]TempObject, 0, 16)
	for obj := range objCh {
		if obj.Err != nil {
			return nil, fmt.Errorf("list temp objects: %w", obj.Err)
		}
		out = append(out, TempObject{Key: obj.Key, Size: obj.Size, LastModified: obj.LastModified})
	}
	return out, nil
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

// RevisionLyricKey 拼接审核员修订版 TTML 的完整对象 key
func RevisionLyricKey(fileName string) string {
	return RevisionLyricsPrefix + fileName
}

// UploadRevisionTTML 上传审核员修订版 TTML 到修订区
func (s *FileService) UploadRevisionTTML(ctx context.Context, fileName string, content []byte) (string, error) {
	if err := validateTTMLFileName(fileName); err != nil {
		return "", invalidInput("%v", err)
	}
	if len(content) > int(s.cfg.Submission.MaxTTMLSize) {
		return "", invalidInput("TTML 文件大小超过 %d 字节", s.cfg.Submission.MaxTTMLSize)
	}
	key := RevisionLyricKey(fileName)
	_, err := s.minio.PutObject(ctx, s.bucket, key, bytes.NewReader(content), int64(len(content)), minio.PutObjectOptions{
		ContentType: "application/xml; charset=utf-8",
	})
	if err != nil {
		return "", err
	}
	return key, nil
}

// GenerateTTMLFileName 按歌词仓库的命名规范生成 TTML 文件名
func GenerateTTMLFileName(githubID int64) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	suffix := make([]byte, 8)
	for i := range suffix {
		suffix[i] = charset[rand.IntN(len(charset))]
	}
	return fmt.Sprintf("%d-%d-%s.ttml", time.Now().UnixMilli(), githubID, string(suffix))
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

// validateImageUpload 校验图片扩展名与真实内容是否一致。
// 仅信任文件内容嗅探结果，避免把任意内容改名成图片后写入对象存储。
func validateImageUpload(fileName string, content []byte) error {
	ext := strings.ToLower(path.Ext(fileName))
	if !isAllowedImageExt(ext) {
		return invalidInput("不支持的图片格式: %s", ext)
	}
	actual := sniffImageExt(content)
	if actual == "" {
		return invalidInput("无法识别的图片内容")
	}
	if ext == ".jpeg" {
		ext = ".jpg"
	}
	if actual != ext {
		return invalidInput("图片内容与扩展名不匹配")
	}
	return nil
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
	case ".svg":
		return "image/svg+xml"
	}
	return "application/octet-stream"
}
