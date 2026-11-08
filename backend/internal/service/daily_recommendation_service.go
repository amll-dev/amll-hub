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
	"regexp"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/minio/minio-go/v7"
	logrus "github.com/sirupsen/logrus"
	"gorm.io/gorm"
)

// DailyRecImagePrefix 每日推荐图片在 MinIO 中的前缀
const DailyRecImagePrefix = "daily-rec/"

// DailyRecTempPrefix 每日推荐临时图片前缀
const DailyRecTempPrefix = "daily-rec/tmp/"

// DailyRecTempTTL 临时文件存活时长
const DailyRecTempTTL = time.Hour

// 每日推荐输入长度上限，与前端表单保持一致
const (
	maxDailyRecNameLen    = 100
	maxDailyRecIDLen      = 50
	maxDailyRecCommentLen = 7000
)

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
	QQID         string
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
	songName := strings.TrimSpace(input.SongName)
	artist := strings.TrimSpace(input.Artist)
	comment := strings.TrimSpace(input.Comment)
	ncmID := strings.TrimSpace(input.NcmID)
	qqID := strings.TrimSpace(input.QQID)

	if songName == "" || artist == "" || input.Date == "" || comment == "" {
		return nil, invalidInput("必填字段缺失")
	}
	if pkg.UTF16Len(songName) > maxDailyRecNameLen || pkg.UTF16Len(artist) > maxDailyRecNameLen {
		return nil, invalidInput("音乐名称和歌手不能超过 %d 个字符", maxDailyRecNameLen)
	}
	if pkg.UTF16Len(ncmID) > maxDailyRecIDLen || pkg.UTF16Len(qqID) > maxDailyRecIDLen {
		return nil, invalidInput("平台歌曲 ID 不能超过 %d 个字符", maxDailyRecIDLen)
	}
	if ncmID != "" && !digitIDPattern.MatchString(ncmID) {
		return nil, invalidInput("网易云音乐 ID 应为纯数字，请先解析链接")
	}
	if qqID != "" && !digitIDPattern.MatchString(qqID) {
		return nil, invalidInput("QQ 音乐 ID 应为纯数字，请先解析链接")
	}
	if pkg.UTF16Len(comment) > maxDailyRecCommentLen {
		return nil, invalidInput("推荐语不能超过 %d 个字符", maxDailyRecCommentLen)
	}
	if input.CoverTempKey == "" {
		return nil, invalidInput("封面未上传")
	}

	// 解析日期字符串为 time.Time
	parsedDate, err := time.Parse("2006-01-02", input.Date)
	if err != nil {
		return nil, invalidInput("日期格式错误，应为 YYYY-MM-DD")
	}

	// 检查日期是否已被占用
	exists, err := s.repo.CheckDate(ctx, input.Date)
	if err != nil {
		return nil, fmt.Errorf("检查日期失败: %w", err)
	}
	if exists {
		return nil, invalidInput("该日期已有推荐，请更换日期")
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
		SongName:      songName,
		Artist:        artist,
		CoverKey:      coverKey,
		NcmID:         ncmID,
		QQID:          qqID,
		Comment:       comment,
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
	if err := validateImageUpload(fileName, content); err != nil {
		return "", err
	}
	ext := strings.ToLower(path.Ext(fileName))
	key := fmt.Sprintf("%s%d-%d%s", DailyRecTempPrefix, time.Now().UnixNano(), len(content), ext)
	_, err := s.minio.PutObject(ctx, s.bucket, key, bytes.NewReader(content), int64(len(content)), minio.PutObjectOptions{
		ContentType: imageContentType(ext),
	})
	if err != nil {
		return "", err
	}
	return key, nil
}

// ssrfSafeTransport 在建立 TCP 连接时校验目标 IP 是否为公网地址
var ssrfSafeTransport = &http.Transport{
	Proxy: nil, // 禁止通过环境变量代理绕过校验
	DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, fmt.Errorf("解析域名失败: %w", err)
		}
		// 优先走 IPv4
		var v4, v6 string
		for _, item := range ips {
			if !isPublicIP(item.IP) {
				return nil, fmt.Errorf("blocked non-public address: %s", host)
			}
			if item.IP.To4() != nil && v4 == "" {
				v4 = net.JoinHostPort(item.IP.String(), port)
			} else if v6 == "" {
				v6 = net.JoinHostPort(item.IP.String(), port)
			}
		}
		dialAddr := v4
		if dialAddr == "" {
			dialAddr = v6
		}
		if dialAddr == "" {
			return nil, fmt.Errorf("无法解析地址: %s", host)
		}
		d := &net.Dialer{Timeout: 10 * time.Second}
		return d.DialContext(ctx, network, dialAddr)
	},
}

// normalizeImageURL 规整图片 URL
func normalizeImageURL(imageURL string) (string, error) {
	raw := strings.TrimSpace(imageURL)
	raw = strings.Trim(raw, "\"'")
	raw = strings.ReplaceAll(raw, "&amp;", "&")
	if raw == "" {
		return "", errors.New("图片 URL 为空")
	}
	switch {
	case strings.HasPrefix(raw, "//"):
		return "https:" + raw, nil
	case schemeRe.MatchString(raw):
		return raw, nil
	case strings.HasPrefix(raw, "/"):
		return "", fmt.Errorf("图片 URL 需要完整的 http(s) 地址，不能是站点相对路径：%s", clipURL(raw))
	default:
		return "https://" + raw, nil
	}
}

// clipURL 截断 URL 用于错误提示
func clipURL(raw string) string {
	if len(raw) > 120 {
		return raw[:120] + "..."
	}
	return raw
}

// refererForHost 按图片域名选择 Referer，避免第三方图床拒绝外链
func refererForHost(host string) string {
	switch {
	case strings.Contains(host, "gtimg.cn"), strings.Contains(host, "qq.com"):
		return "https://y.qq.com/"
	case strings.Contains(host, "126.net"), strings.Contains(host, "127.net"):
		return "https://music.163.com/"
	default:
		return ""
	}
}

// schemeRe 匹配形如 https:// 的协议前缀
var schemeRe = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.-]*://`)

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
	raw, err := normalizeImageURL(imageURL)
	if err != nil {
		return "", invalidInput("%v", err)
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", invalidInput("无效的图片 URL: %v", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", invalidInput("不支持的 URL 协议: %s（%s）", u.Scheme, clipURL(raw))
	}
	referer := refererForHost(u.Hostname())
	if host := u.Hostname(); host != "" {
		if ips, err := net.DefaultResolver.LookupIPAddr(ctx, host); err == nil {
			for _, ip := range ips {
				if !isPublicIP(ip.IP) {
					return "", invalidInput("不允许访问内网地址: %s", host)
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
				return invalidInput("重定向到不支持的协议: %s", req.URL.Scheme)
			}
			// 跟随重定向时保留 Referer
			req.Header.Set("Referer", referer)
			return nil
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return "", invalidInput("无效的图片 URL: %v", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
	req.Header.Set("Accept", "image/webp,image/apng,image/*,*/*;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		var validationErr *ValidationError
		if errors.As(err, &validationErr) {
			return "", err
		}
		return "", fmt.Errorf("%w: 下载图片失败: %v", ErrUpstreamUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("%w: 下载图片失败: HTTP %d", ErrUpstreamUnavailable, resp.StatusCode)
	}

	// 限制最大读取 100MB
	limited := io.LimitReader(resp.Body, 100<<20)
	content, err := io.ReadAll(limited)
	if err != nil {
		return "", fmt.Errorf("%w: 读取图片内容失败: %v", ErrUpstreamUnavailable, err)
	}
	if len(content) == 0 {
		return "", invalidInput("图片内容为空")
	}

	// 校验 Content-Length（如果响应头有提供）
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		var expected int64
		if _, err := fmt.Sscanf(cl, "%d", &expected); err == nil && expected > 0 {
			if int64(len(content)) != expected {
				if expected > 100<<20 {
					return "", invalidInput("图片过大: %d 字节 (上限 100MB)", expected)
				}
				return "", fmt.Errorf("%w: 图片下载不完整: 读取 %d 字节, 预期 %d 字节", ErrUpstreamUnavailable, len(content), expected)
			}
		}
	}

	// 只用真实内容判定格式，避免 URL / Content-Type 与实际内容不一致
	ext := sniffImageExt(content)
	if ext == "" {
		return "", invalidInput("下载的内容不是有效的图片")
	}
	if !isAllowedImageExt(ext) {
		return "", invalidInput("不支持的图片格式: %s", ext)
	}
	fileName := fmt.Sprintf("cover-%d%s", time.Now().UnixNano(), ext)
	return s.UploadTemp(ctx, fileName, content)
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
	pkg.GoSafe("daily-rec-temp-cleaner", func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := s.CleanTempFiles(ctx); err != nil {
					logrus.WithError(err).Warn("clean daily rec temp files failed")
				}
			}
		}
	})
}

// ListAll 返回所有已通过的推荐（公开展示用）
func (s *DailyRecommendationService) ListAll(ctx context.Context) ([]model.DailyRecommendation, error) {
	return s.repo.ListApproved(ctx)
}

// GetByDate 按日期查询单条
func (s *DailyRecommendationService) GetByDate(ctx context.Context, date string) (*model.DailyRecommendation, error) {
	rec, err := s.repo.GetByDate(ctx, date)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	return rec, err
}

// GetToday 查询今天的推荐；若今天没有则回退到往期最新一期
func (s *DailyRecommendationService) GetToday(ctx context.Context) (*model.DailyRecommendation, error) {
	rec, err := s.repo.GetToday(ctx)
	if err == nil {
		return rec, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	rec, err = s.repo.GetLatestApproved(ctx)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	return rec, err
}

// CheckDate 检查日期是否可用（返回 true 表示可用）
func (s *DailyRecommendationService) CheckDate(ctx context.Context, date string) (bool, error) {
	exists, err := s.repo.CheckDate(ctx, date)
	return !exists, err
}

// ListBySubmitter 按提交人分页查询列表
func (s *DailyRecommendationService) ListBySubmitter(ctx context.Context, submitter string, page, size int) (*DailyRecListResult, error) {
	recs, total, err := s.repo.ListBySubmitter(ctx, submitter, page, size)
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
	return &DailyRecListResult{Total: total, Items: items}, nil
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

// DailyRecImage 流式图片读取结果
type DailyRecImage struct {
	Content     io.ReadCloser
	ContentType string
	ETag        string
	Size        int64
}

// GetImage 从 MinIO 流式读取图片。
func (s *DailyRecommendationService) GetImage(ctx context.Context, key string) (*DailyRecImage, error) {
	if !strings.HasPrefix(key, DailyRecImagePrefix) {
		return nil, ErrDailyRecNotFound
	}
	obj, err := s.minio.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}

	info, statErr := obj.Stat()
	if statErr != nil {
		_ = obj.Close()
		resp := minio.ToErrorResponse(statErr)
		if resp.Code == "NoSuchKey" {
			return nil, ErrDailyRecNotFound
		}
		return nil, statErr
	}

	return &DailyRecImage{
		Content:     obj,
		ContentType: imageContentType(path.Ext(key)),
		ETag:        info.ETag,
		Size:        info.Size,
	}, nil
}
