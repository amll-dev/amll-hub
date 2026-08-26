package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/minio/minio-go/v7"
	"gorm.io/gorm"
)

// DailyRecImagePrefix 每日推荐图片在 MinIO 中的前缀
const DailyRecImagePrefix = "daily-rec/"

// DailyRecTempPrefix 每日推荐临时图片前缀
const DailyRecTempPrefix = "daily-rec/tmp/"

// DailyRecTempTTL 临时文件存活时长
const DailyRecTempTTL = time.Hour

// DailyRecommendationService 每日推荐服务
type DailyRecommendationService struct {
	repo   *repository.DailyRecommendationRepo
	minio  *minio.Client
	bucket string
}

// NewDailyRecommendationService 创建 DailyRecommendationService
func NewDailyRecommendationService(repo *repository.DailyRecommendationRepo, minioClient *minio.Client, bucket string) *DailyRecommendationService {
	return &DailyRecommendationService{repo: repo, minio: minioClient, bucket: bucket}
}

// CreateDailyRecInput 创建每日推荐入参
type CreateDailyRecInput struct {
	SongName     string
	Artist       string
	CoverTempKey string // 临时封面 key
	Date         string // YYYY-MM-DD
	Comment      string
	NcmID        string
}

// CreateDailyRecResult 创建结果
type CreateDailyRecResult struct {
	ID int64 `json:"id"`
}

// DailyRecListItem 列表项
type DailyRecListItem struct {
	ID        int64  `json:"id"`
	Date      string `json:"date"`
	SongName  string `json:"songName"`
	Artist    string `json:"artist"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
}

// DailyRecListResult 列表结果
type DailyRecListResult struct {
	Total int64              `json:"total"`
	Items []DailyRecListItem `json:"items"`
}

// CreateRecommendation 创建每日推荐
func (s *DailyRecommendationService) CreateRecommendation(ctx context.Context, submitter string, submitterInfo model.JSONObject, input *CreateDailyRecInput) (*CreateDailyRecResult, error) {
	if input.SongName == "" || input.Artist == "" || input.Date == "" || input.Comment == "" {
		return nil, errors.New("必填字段缺失")
	}
	if input.CoverTempKey == "" {
		return nil, errors.New("封面未上传")
	}

	// 解析日期字符串为 time.Time
	parsedDate, err := time.Parse("2006-01-02", input.Date)
	if err != nil {
		return nil, errors.New("日期格式错误，应为 YYYY-MM-DD")
	}

	// 检查日期是否已被占用
	exists, err := s.repo.CheckDate(ctx, input.Date)
	if err != nil {
		return nil, fmt.Errorf("检查日期失败: %w", err)
	}
	if exists {
		return nil, errors.New("该日期已有推荐，请更换日期")
	}

	// 将临时封面转为正式
	coverKey, err := s.promoteTemp(ctx, input.CoverTempKey)
	if err != nil {
		return nil, fmt.Errorf("转存封面失败: %w", err)
	}
	// 删除临时对象
	_ = s.minio.RemoveObject(ctx, s.bucket, input.CoverTempKey, minio.RemoveObjectOptions{})

	rec := &model.DailyRecommendation{
		Date:          model.DateOnly(parsedDate),
		SongName:      input.SongName,
		Artist:        input.Artist,
		CoverKey:      coverKey,
		NcmID:         input.NcmID,
		Comment:       input.Comment,
		Submitter:     submitter,
		SubmitterInfo: submitterInfo,
		Status:        "approved",
	}

	if err := s.repo.Create(ctx, rec); err != nil {
		return nil, fmt.Errorf("创建推荐失败: %w", err)
	}

	return &CreateDailyRecResult{ID: rec.ID}, nil
}

// UploadTemp 上传图片到 MinIO 临时区，返回临时 key
func (s *DailyRecommendationService) UploadTemp(ctx context.Context, fileName string, content []byte) (string, error) {
	ext := path.Ext(fileName)
	if !isAllowedImageExt(ext) {
		return "", fmt.Errorf("不支持的图片格式: %s", ext)
	}
	key := fmt.Sprintf("%s%d-%d%s", DailyRecTempPrefix, time.Now().UnixNano(), len(content), ext)
	_, err := s.minio.PutObject(ctx, s.bucket, key, bytes.NewReader(content), int64(len(content)), minio.PutObjectOptions{
		ContentType: imageContentType(ext),
	})
	if err != nil {
		return "", err
	}
	return key, nil
}

// ssrfSafeTransport 在建立 TCP 连接时校验目标 IP 是否为公网地址，
var ssrfSafeTransport = &http.Transport{
	Proxy: nil, // 禁止通过环境变量代理绕过校验
	DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		ip := net.ParseIP(host)
		if ip == nil {
			return nil, fmt.Errorf("invalid address: %s", host)
		}
		if !isPublicIP(ip) {
			return nil, fmt.Errorf("blocked non-public address: %s", host)
		}
		d := &net.Dialer{Timeout: 10 * time.Second}
		return d.DialContext(ctx, network, net.JoinHostPort(host, port))
	},
}

// isPublicIP 判断 IP 是否为公网地址（拒绝回环/私网/链路本地/组播/未指定/CGNAT）
func isPublicIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast() {
		return false
	}
	// 运营商级 NAT 100.64.0.0/10
	if ip4 := ip.To4(); ip4 != nil && ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
		return false
	}
	return true
}

// UploadTempFromURL 服务端下载图片 URL 并转存到临时区，返回临时 key。
func (s *DailyRecommendationService) UploadTempFromURL(ctx context.Context, imageURL string) (string, error) {
	// SSRF 防护：仅允许 http(s) 且解析到公网 IP 的 URL
	u, err := url.Parse(imageURL)
	if err != nil {
		return "", fmt.Errorf("无效的图片 URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("不支持的 URL 协议: %s", u.Scheme)
	}
	if host := u.Hostname(); host != "" {
		if ips, err := net.DefaultResolver.LookupIPAddr(ctx, host); err == nil {
			for _, ip := range ips {
				if !isPublicIP(ip.IP) {
					return "", fmt.Errorf("不允许访问内网地址: %s", host)
				}
			}
		}
	}

	// 使用自定义 HTTP 客户端，确保正确处理重定向和超时
	client := &http.Client{
		Timeout:   30 * time.Second,
		Transport: ssrfSafeTransport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			// 重定向目标同样只允许 http(s)
			if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
				return fmt.Errorf("重定向到不支持的协议: %s", req.URL.Scheme)
			}
			// 跟随重定向时保留 Referer
			req.Header.Set("Referer", "https://music.163.com/")
			return nil
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return "", fmt.Errorf("无效的图片 URL: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Referer", "https://music.163.com/")
	req.Header.Set("Accept", "image/webp,image/apng,image/*,*/*;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("下载图片失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("下载图片失败: HTTP %d", resp.StatusCode)
	}

	// 限制最大读取 100MB
	limited := io.LimitReader(resp.Body, 100<<20)
	content, err := io.ReadAll(limited)
	if err != nil {
		return "", fmt.Errorf("读取图片内容失败: %w", err)
	}
	if len(content) == 0 {
		return "", errors.New("图片内容为空")
	}

	// 校验 Content-Length（如果响应头有提供）
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		var expected int64
		if _, err := fmt.Sscanf(cl, "%d", &expected); err == nil && expected > 0 {
			if int64(len(content)) != expected {
				if expected > 100<<20 {
					return "", fmt.Errorf("图片过大: %d 字节 (上限 100MB)", expected)
				}
				return "", fmt.Errorf("图片下载不完整: 读取 %d 字节, 预期 %d 字节", len(content), expected)
			}
		}
	}

	// 校验图片 magic bytes
	if !isValidImageContent(content) {
		return "", errors.New("下载的内容不是有效的图片")
	}

	// 优先从 Content-Type 推断扩展名，回退到 magic bytes，再回退到 URL 路径
	ext := extFromContentType(resp.Header.Get("Content-Type"))
	if ext == "" {
		ext = extFromMagicBytes(content)
	}
	if ext == "" {
		ext = path.Ext(path.Base(imageURL))
	}
	// 兜底为 .jpg
	if !isAllowedImageExt(ext) {
		ext = ".jpg"
	}
	fileName := fmt.Sprintf("cover-%d%s", time.Now().UnixNano(), ext)
	return s.UploadTemp(ctx, fileName, content)
}

// isValidImageContent 通过 magic bytes 校验是否为有效图片
func isValidImageContent(content []byte) bool {
	if len(content) < 4 {
		return false
	}
	// JPEG: FF D8 FF
	if content[0] == 0xFF && content[1] == 0xD8 && content[2] == 0xFF {
		return true
	}
	// PNG: 89 50 4E 47
	if content[0] == 0x89 && content[1] == 0x50 && content[2] == 0x4E && content[3] == 0x47 {
		return true
	}
	// GIF: 47 49 46 38
	if content[0] == 0x47 && content[1] == 0x49 && content[2] == 0x46 && content[3] == 0x38 {
		return true
	}
	// WebP: RIFF....WEBP
	if len(content) >= 12 && string(content[0:4]) == "RIFF" && string(content[8:12]) == "WEBP" {
		return true
	}
	// BMP: 42 4D
	if content[0] == 0x42 && content[1] == 0x4D {
		return true
	}
	return false
}

// extFromMagicBytes 通过 magic bytes 推断图片扩展名
func extFromMagicBytes(content []byte) string {
	if len(content) < 4 {
		return ""
	}
	if content[0] == 0xFF && content[1] == 0xD8 && content[2] == 0xFF {
		return ".jpg"
	}
	if content[0] == 0x89 && content[1] == 0x50 && content[2] == 0x4E && content[3] == 0x47 {
		return ".png"
	}
	if content[0] == 0x47 && content[1] == 0x49 && content[2] == 0x46 && content[3] == 0x38 {
		return ".gif"
	}
	if len(content) >= 12 && string(content[0:4]) == "RIFF" && string(content[8:12]) == "WEBP" {
		return ".webp"
	}
	if content[0] == 0x42 && content[1] == 0x4D {
		return ".bmp"
	}
	return ""
}

// extFromContentType 根据 Content-Type 返回图片扩展名（含点号），非图片返回空串
func extFromContentType(ct string) string {
	ct = strings.ToLower(strings.TrimSpace(strings.Split(ct, ";")[0]))
	switch ct {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "image/bmp":
		return ".bmp"
	}
	return ""
}

// promoteTemp 将临时对象转存为正式对象，返回正式 key
func (s *DailyRecommendationService) promoteTemp(ctx context.Context, tempKey string) (string, error) {
	if !strings.HasPrefix(tempKey, DailyRecTempPrefix) {
		return "", fmt.Errorf("非法的临时 key: %s", tempKey)
	}
	ext := path.Ext(tempKey)
	formalKey := fmt.Sprintf("%s%d-%d%s", DailyRecImagePrefix, time.Now().UnixNano(), len(tempKey), ext)

	// 读取临时对象完整内容后重新上传，避免 CopyObject 可能的数据不完整
	obj, err := s.minio.GetObject(ctx, s.bucket, tempKey, minio.GetObjectOptions{})
	if err != nil {
		return "", fmt.Errorf("读取临时对象失败: %w", err)
	}
	defer obj.Close()

	info, err := obj.Stat()
	if err != nil {
		return "", fmt.Errorf("获取临时对象信息失败: %w", err)
	}

	content, err := io.ReadAll(obj)
	if err != nil {
		return "", fmt.Errorf("读取临时对象内容失败: %w", err)
	}
	if int64(len(content)) != info.Size {
		return "", fmt.Errorf("临时对象内容不完整: 读取 %d 字节, 预期 %d 字节", len(content), info.Size)
	}

	_, err = s.minio.PutObject(ctx, s.bucket, formalKey, bytes.NewReader(content), int64(len(content)), minio.PutObjectOptions{
		ContentType: imageContentType(ext),
	})
	if err != nil {
		return "", fmt.Errorf("上传正式对象失败: %w", err)
	}
	return formalKey, nil
}

// CleanTempFiles 清理超过 TTL 的临时文件
func (s *DailyRecommendationService) CleanTempFiles(ctx context.Context) error {
	cutoff := time.Now().Add(-DailyRecTempTTL)
	objectCh := s.minio.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{
		Prefix:    DailyRecTempPrefix,
		Recursive: true,
	})
	var delErr error
	for obj := range objectCh {
		if obj.Err != nil {
			delErr = obj.Err
			continue
		}
		if obj.LastModified.Before(cutoff) {
			if err := s.minio.RemoveObject(ctx, s.bucket, obj.Key, minio.RemoveObjectOptions{}); err != nil {
				delErr = err
			}
		}
	}
	return delErr
}

// StartTempCleaner 启动临时文件清理定时任务
func (s *DailyRecommendationService) StartTempCleaner(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = s.CleanTempFiles(ctx)
			}
		}
	}()
}

// ListAll 返回所有已通过的推荐（公开展示用）
func (s *DailyRecommendationService) ListAll(ctx context.Context) ([]model.DailyRecommendation, error) {
	return s.repo.ListApproved(ctx)
}

// GetByDate 按日期查询单条
func (s *DailyRecommendationService) GetByDate(ctx context.Context, date string) (*model.DailyRecommendation, error) {
	return s.repo.GetByDate(ctx, date)
}

// GetToday 查询今天的推荐；若今天没有则回退到往期最新一期
func (s *DailyRecommendationService) GetToday(ctx context.Context) (*model.DailyRecommendation, error) {
	rec, err := s.repo.GetToday(ctx)
	if err == nil {
		return rec, nil
	}
	return s.repo.GetLatestApproved(ctx)
}

// CheckDate 检查日期是否可用（返回 true 表示可用）
func (s *DailyRecommendationService) CheckDate(ctx context.Context, date string) (bool, error) {
	exists, err := s.repo.CheckDate(ctx, date)
	return !exists, err
}

// ListBySubmitter 按提交人查询列表
func (s *DailyRecommendationService) ListBySubmitter(ctx context.Context, submitter string) (*DailyRecListResult, error) {
	recs, err := s.repo.ListBySubmitter(ctx, submitter)
	if err != nil {
		return nil, err
	}
	items := make([]DailyRecListItem, 0, len(recs))
	for _, rec := range recs {
		items = append(items, DailyRecListItem{
			ID:        rec.ID,
			Date:      time.Time(rec.Date).Format("2006-01-02"),
			SongName:  rec.SongName,
			Artist:    rec.Artist,
			Status:    rec.Status,
			CreatedAt: rec.CreatedAt.Format("2006-01-02 15:04"),
		})
	}
	return &DailyRecListResult{Total: int64(len(items)), Items: items}, nil
}

// GetByID 查询详情
func (s *DailyRecommendationService) GetByID(ctx context.Context, id int64) (*model.DailyRecommendation, error) {
	return s.repo.GetByID(ctx, id)
}

// LikeStatus 用户对推荐的点赞状态
type LikeStatus struct {
	Liked     bool `json:"liked"`
	LikeCount int  `json:"likeCount"`
}

// GetLikeStatus 查询用户点赞状态
func (s *DailyRecommendationService) GetLikeStatus(ctx context.Context, recID int64, username string) (*LikeStatus, error) {
	rec, err := s.repo.GetByID(ctx, recID)
	if err != nil {
		return nil, ErrDailyRecNotFound
	}
	liked, err := s.repo.GetLikeStatus(ctx, recID, username)
	if err != nil {
		return nil, err
	}
	return &LikeStatus{Liked: liked, LikeCount: rec.LikeCount}, nil
}

// ToggleLike 切换点赞，返回切换后的状态与最新计数
func (s *DailyRecommendationService) ToggleLike(ctx context.Context, recID int64, username string) (*LikeStatus, error) {
	liked, count, err := s.repo.ToggleLike(ctx, recID, username)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDailyRecNotFound
		}
		return nil, err
	}
	return &LikeStatus{Liked: liked, LikeCount: count}, nil
}

// GetImage 从 MinIO 读取图片，返回完整内容、Content-Type
func (s *DailyRecommendationService) GetImage(ctx context.Context, key string) ([]byte, string, error) {
	if !strings.HasPrefix(key, DailyRecImagePrefix) {
		return nil, "", ErrDailyRecNotFound
	}
	obj, err := s.minio.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, "", err
	}
	defer obj.Close()

	info, statErr := obj.Stat()
	if statErr != nil {
		resp := minio.ToErrorResponse(statErr)
		if resp.Code == "NoSuchKey" {
			return nil, "", ErrDailyRecNotFound
		}
		return nil, "", statErr
	}

	content, err := io.ReadAll(obj)
	if err != nil {
		return nil, "", fmt.Errorf("读取图片内容失败: %w", err)
	}
	if int64(len(content)) != info.Size {
		return nil, "", fmt.Errorf("图片内容不完整: 读取 %d 字节, 预期 %d 字节", len(content), info.Size)
	}

	contentType := imageContentType(path.Ext(key))
	return content, contentType, nil
}
