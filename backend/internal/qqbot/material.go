package qqbot

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	logrus "github.com/sirupsen/logrus"
)

const (
	materialMaxBytes = 10 << 20
	// 素材删除延后执行，避免消息刚发出、客户端还没渲染图片就被删掉
	materialDeleteDelay = 5 * time.Minute
)

type materialImage struct {
	Data        []byte
	FileName    string
	ContentType string
}

// markdownReplyWithCovers 把正文和封面合并成一条 Markdown 消息。
// 封面按正文里的 {{cover:i}} 占位符原位插入；单张失败只移除该占位符。
func (b *Bot) markdownReplyWithCovers(ctx context.Context, rep reply) (string, []string, bool) {
	ids := make([]string, 0, len(rep.Images))
	rendered := make([]string, len(rep.Images))

	for i, image := range rep.Images {
		if b.materialBroken.Load() {
			break
		}
		qqURL, imageID, err := b.uploadMarkdownImage(ctx, image)
		if err != nil {
			logrus.WithError(err).WithField("url", image.URL).
				Warn("[qqbot] 上传 Markdown 封面失败，跳过该封面")
			continue
		}
		ids = append(ids, imageID)
		rendered[i] = imageMarkdown(image, qqURL)
	}

	content := rep.Text
	for i, md := range rendered {
		content = strings.ReplaceAll(content, coverMarker(i), md)
	}
	content = coverMarkerPattern.ReplaceAllString(content, "")
	content = strings.TrimSpace(content)

	// 正文没有占位符时（例如每日推荐卡片），图片统一追加在末尾
	if !coverMarkerPattern.MatchString(rep.Text) {
		for _, md := range rendered {
			if md == "" {
				continue
			}
			if content != "" {
				content += "\n\n"
			}
			content += md
		}
	}

	content = tidyMarkdown(content)
	if content == "" {
		return "", ids, false
	}
	return content, ids, true
}

func imageMarkdown(image coverImage, qqURL string) string {
	caption := image.Caption
	if caption == "" {
		caption = "封面"
	}
	width, height := image.Width, image.Height
	if width <= 0 {
		width = 600
	}
	if height <= 0 {
		height = 600
	}
	// QQ 的 Markdown 图片必须带尺寸，否则客户端只显示 alt 文本
	return fmt.Sprintf("![%s #%dpx #%dpx](%s)",
		escapeMarkdown(caption), width, height, qqURL)
}

func tidyMarkdown(content string) string {
	for strings.Contains(content, "\n\n\n") {
		content = strings.ReplaceAll(content, "\n\n\n", "\n\n")
	}
	return strings.TrimSpace(content)
}

func (b *Bot) uploadMarkdownImage(ctx context.Context, image coverImage) (string, string, error) {
	img, err := b.materialImageFor(ctx, image)
	if err != nil {
		return "", "", err
	}

	md5sum := md5.Sum(img.Data)
	sha1sum := sha1.Sum(img.Data)
	md5hex := hex.EncodeToString(md5sum[:])

	prepareData, err := b.postJSON(ctx, "/v2/media-images/prepare", map[string]any{
		"file_name":    img.FileName,
		"file_size":    len(img.Data),
		"content_type": img.ContentType,
		"md5":          md5hex,
		"sha1":         hex.EncodeToString(sha1sum[:]),
	})
	if err != nil {
		if isClientError(err) {
			// 机器人没有素材管理权限，本次进程内不再尝试
			b.materialBroken.Store(true)
		}
		return "", "", fmt.Errorf("申请上传: %w", err)
	}

	var prepared struct {
		UploadID     string `json:"upload_id"`
		PresignedURL string `json:"presigned_url"`
	}
	if err := json.Unmarshal(prepareData, &prepared); err != nil {
		return "", "", err
	}
	if prepared.UploadID == "" || prepared.PresignedURL == "" {
		return "", "", fmt.Errorf("申请上传返回缺少字段: %s", clip(string(prepareData), 200))
	}

	if err := b.putBinary(ctx, prepared.PresignedURL, img.ContentType, img.Data); err != nil {
		return "", "", fmt.Errorf("上传图片: %w", err)
	}

	completeData, err := b.postJSON(ctx, "/v2/media-images/complete", map[string]any{
		"upload_id": prepared.UploadID,
		"md5":       md5hex,
	})
	if err != nil {
		return "", "", fmt.Errorf("完成上传: %w", err)
	}

	var completed struct {
		ImageID string `json:"image_id"`
		URL     string `json:"url"`
	}
	if err := json.Unmarshal(completeData, &completed); err != nil {
		return "", "", err
	}
	if completed.ImageID == "" || completed.URL == "" {
		return "", "", fmt.Errorf("完成上传返回缺少字段: %s", clip(string(completeData), 200))
	}
	logrus.WithFields(logrus.Fields{
		"image_id": completed.ImageID,
		"file":     img.FileName,
	}).Info("[qqbot] 素材图片上传完成")
	return completed.URL, completed.ImageID, nil
}

// scheduleMarkdownImageDeletion 延迟释放素材配额，保证消息有足够时间渲染。
func (b *Bot) scheduleMarkdownImageDeletion(imageIDs []string) {
	if len(imageIDs) == 0 {
		return
	}
	pkg.GoSafe("qqbot-media-cleanup", func() {
		timer := time.NewTimer(materialDeleteDelay)
		defer timer.Stop()
		<-timer.C

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		b.deleteMarkdownImages(ctx, imageIDs)
	})
}

// deleteMarkdownImages 发送完成后释放素材配额。
// 已发送消息在发送时已转存副本，删除素材不影响历史消息。
func (b *Bot) deleteMarkdownImages(ctx context.Context, imageIDs []string) {
	for _, imageID := range imageIDs {
		if imageID == "" {
			continue
		}
		if err := b.deleteJSON(ctx, "/v2/media-images/"+url.PathEscape(imageID)+"/delete"); err != nil {
			logrus.WithError(err).WithField("image_id", imageID).
				Warn("[qqbot] 删除素材图片失败")
		}
	}
}

func (b *Bot) materialImageFor(ctx context.Context, image coverImage) (*materialImage, error) {
	if len(image.Data) > 0 {
		return buildMaterialImage(image.Data, image.FileName, image.ContentType)
	}
	return b.fetchMaterialImage(ctx, image.URL)
}

func (b *Bot) fetchMaterialImage(ctx context.Context, imageURL string) (*materialImage, error) {
	imageURL = normalizeImageURL(imageURL)
	if imageURL == "" {
		return nil, fmt.Errorf("封面 URL 为空")
	}

	candidates := make([]string, 0, 4)
	if strings.Contains(imageURL, "music.126.net") && !strings.Contains(imageURL, "?") {
		// 网易云原图可能是 20MB 级别，优先取 600x600 缩略图
		candidates = append(candidates, imageURL+"?param=600y600", imageURL)
	} else {
		candidates = append(candidates, imageURL)
		if !strings.Contains(imageURL, "?") {
			candidates = append(candidates, imageURL+"?param=600y600")
		}
	}
	if strings.HasPrefix(imageURL, "https://") {
		candidates = append(candidates, "http://"+strings.TrimPrefix(imageURL, "https://"))
	} else if strings.HasPrefix(imageURL, "http://") {
		candidates = append(candidates, "https://"+strings.TrimPrefix(imageURL, "http://"))
	}

	var lastErr error
	for _, candidate := range candidates {
		data, contentType, err := b.downloadImage(ctx, candidate)
		if err != nil {
			lastErr = err
			continue
		}
		return buildMaterialImage(data, "", contentType)
	}
	return nil, lastErr
}

func (b *Bot) downloadImage(ctx context.Context, imageURL string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return nil, "", err
	}
	// 部分 CDN 对无 UA/Referer 的请求返回空响应
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
	req.Header.Set("Referer", "https://music.163.com/")

	resp, err := b.mediaHTTP.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	finalURL := imageURL
	if resp.Request != nil && resp.Request.URL != nil {
		finalURL = resp.Request.URL.String()
	}
	if resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("下载封面 HTTP %d url=%s", resp.StatusCode, finalURL)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, materialMaxBytes+1))
	if err != nil {
		return nil, "", err
	}
	if len(data) == 0 {
		return nil, "", fmt.Errorf("封面响应为空 status=%d content-type=%q content-length=%q url=%s",
			resp.StatusCode, resp.Header.Get("Content-Type"), resp.Header.Get("Content-Length"), finalURL)
	}
	if len(data) > materialMaxBytes {
		return nil, "", fmt.Errorf("封面超过 10MB: %d bytes url=%s", len(data), finalURL)
	}
	return data, resp.Header.Get("Content-Type"), nil
}

func buildMaterialImage(data []byte, fileName, contentType string) (*materialImage, error) {
	if len(data) == 0 || len(data) > materialMaxBytes {
		return nil, fmt.Errorf("图片为空或超过 10MB")
	}

	contentType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = http.DetectContentType(data)
	}

	var ext string
	switch contentType {
	case "image/png":
		ext = ".png"
	case "image/jpeg", "image/jpg", "image/pjpeg":
		// 网易云等 CDN 会返回非标准 image/jpg，统一成 image/jpeg
		contentType = "image/jpeg"
		ext = ".jpg"
	case "image/gif":
		ext = ".gif"
	case "image/webp":
		ext = ".webp"
	default:
		return nil, fmt.Errorf("不支持的图片类型 %q", contentType)
	}
	if fileName == "" {
		fileName = "cover" + ext
	}
	return &materialImage{Data: data, FileName: fileName, ContentType: contentType}, nil
}

func (b *Bot) putBinary(ctx context.Context, presignedURL, contentType string, data []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, presignedURL, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)

	resp, err := b.mediaHTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, clip(string(body), 200))
	}
	return nil
}

// normalizeImageURL 清理封面 URL 中混入的空白/反引号，并补全协议相对地址。
func normalizeImageURL(raw string) string {
	imageURL := strings.TrimSpace(raw)
	imageURL = strings.ReplaceAll(imageURL, "`", "")
	imageURL = strings.Trim(imageURL, " \t\r\n\"'<>\u200b\ufeff")
	if strings.HasPrefix(imageURL, "//") {
		imageURL = "https:" + imageURL
	}
	return imageURL
}
