package service

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/draw"
	_ "image/gif" // 注册 GIF 解码器
	"image/jpeg"
	_ "image/png" // 注册 PNG 解码器
	"io"
	"math"
	"path"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/sirupsen/logrus"
)

// 每日推荐封面缩略图

const (
	// DailyRecThumbPrefix 缩略图前缀。
	// 它仍在 DailyRecImagePrefix 之下，所以复用同一条读取路由与前缀校验。
	DailyRecThumbPrefix = "daily-rec/thumb/"

	// thumbMaxSize 缩略图最长边（像素）。卡片最大显示约 520px，640 留足余量。
	thumbMaxSize = 640
	// thumbQuality JPEG 质量。缩略图尺寸小，82 已经肉眼看不出差别。
	thumbQuality = 82
)

// ThumbKey 由原图 key 推导缩略图 key。临时区（tmp/）与缩略图自身不生成缩略图。
func ThumbKey(key string) (string, bool) {
	if !strings.HasPrefix(key, DailyRecImagePrefix) {
		return "", false
	}
	// 临时对象尚未通过审核，不能出现在缩略图里
	if strings.HasPrefix(key, DailyRecTempPrefix) || strings.HasPrefix(key, DailyRecThumbPrefix) {
		return "", false
	}
	base := path.Base(key)
	if base == "" || base == "." || base == "/" {
		return "", false
	}
	return DailyRecThumbPrefix + base + ".jpg", true
}

// GetThumb 返回封面缩略图，必要时先从原图生成。
func (s *DailyRecommendationService) GetThumb(ctx context.Context, key string) (*DailyRecImage, error) {
	thumbKey, ok := ThumbKey(key)
	if !ok {
		return s.GetImage(ctx, key)
	}

	// 已经生成过就直接读
	if img, err := s.getImageObject(ctx, thumbKey); err == nil {
		return img, nil
	}

	if err := s.buildThumb(ctx, key, thumbKey); err != nil {
		logrus.WithError(err).WithField("key", key).Warn("generate daily rec thumbnail failed, fallback to original")
		return s.GetImage(ctx, key)
	}
	img, err := s.getImageObject(ctx, thumbKey)
	if err != nil {
		return s.GetImage(ctx, key)
	}
	return img, nil
}

// getImageObject 读取指定对象（不校验业务前缀）
func (s *DailyRecommendationService) getImageObject(ctx context.Context, key string) (*DailyRecImage, error) {
	obj, err := s.minio.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	info, statErr := obj.Stat()
	if statErr != nil {
		_ = obj.Close()
		return nil, statErr
	}
	return &DailyRecImage{
		Content:     obj,
		ContentType: imageContentType(path.Ext(key)),
		ETag:        info.ETag,
		Size:        info.Size,
	}, nil
}

// buildThumb 从原图生成缩略图并写入 MinIO。
func (s *DailyRecommendationService) buildThumb(ctx context.Context, srcKey, thumbKey string) error {
	obj, err := s.minio.GetObject(ctx, s.bucket, srcKey, minio.GetObjectOptions{})
	if err != nil {
		return fmt.Errorf("读取原图失败: %w", err)
	}
	defer obj.Close()

	raw, err := io.ReadAll(obj)
	if err != nil {
		return fmt.Errorf("读取原图内容失败: %w", err)
	}

	// 标准库解不了 webp / bmp（只注册了 jpeg / png / gif），这种情况直接放弃缩略图
	src, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("解码原图失败（该格式可能不支持缩略图）: %w", err)
	}

	// PNG 可能带透明通道，先铺白底再编码 JPEG，避免透明区变黑
	dst := flattenOnWhite(resizeBilinear(src, thumbMaxSize))

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: thumbQuality}); err != nil {
		return fmt.Errorf("编码缩略图失败: %w", err)
	}
	if buf.Len() >= len(raw) {
		return fmt.Errorf("缩略图 %d 字节不小于原图 %d 字节，跳过", buf.Len(), len(raw))
	}
	if _, err := s.minio.PutObject(ctx, s.bucket, thumbKey, bytes.NewReader(buf.Bytes()), int64(buf.Len()), minio.PutObjectOptions{
		ContentType: "image/jpeg",
	}); err != nil {
		return fmt.Errorf("上传缩略图失败: %w", err)
	}
	return nil
}

// flattenOnWhite 把带透明通道的图合成到白底上
func flattenOnWhite(src image.Image) image.Image {
	b := src.Bounds()
	rgba, ok := src.(*image.RGBA)
	if !ok {
		rgba = image.NewRGBA(b)
		draw.Draw(rgba, b, src, b.Min, draw.Src)
	}
	out := image.NewRGBA(b)
	white := image.NewUniform(image.White)
	draw.Draw(out, b, white, image.Point{}, draw.Src)
	draw.Draw(out, b, rgba, b.Min, draw.Over)
	return out
}

// resizeBilinear 双线性缩放到最长边不超过 maxSize；原图已够小则原样返回。
func resizeBilinear(src image.Image, maxSize int) image.Image {
	b := src.Bounds()
	sw, sh := b.Dx(), b.Dy()
	if sw <= 0 || sh <= 0 {
		return src
	}
	longest := max(sw, sh)
	if longest <= maxSize {
		return src
	}

	scale := float64(maxSize) / float64(longest)
	dw := max(1, int(math.Round(float64(sw)*scale)))
	dh := max(1, int(math.Round(float64(sh)*scale)))

	// 先把源图转成 RGBA，避免在内层循环里反复调 At() 做类型断言
	rgba, ok := src.(*image.RGBA)
	if !ok {
		rgba = image.NewRGBA(b)
		draw.Draw(rgba, b, src, b.Min, draw.Src)
	}

	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	xRatio := float64(sw) / float64(dw)
	yRatio := float64(sh) / float64(dh)

	for y := 0; y < dh; y++ {
		// 采样点对齐到源像素中心，避免整体偏移半个像素导致边缘发虚
		sy := (float64(y)+0.5)*yRatio - 0.5
		y0 := int(math.Floor(sy))
		fy := sy - float64(y0)
		y0 = clampInt(y0, 0, sh-1)
		y1 := clampInt(y0+1, 0, sh-1)
		row0 := rgba.PixOffset(0, y0)
		row1 := rgba.PixOffset(0, y1)

		for x := 0; x < dw; x++ {
			sx := (float64(x)+0.5)*xRatio - 0.5
			x0 := int(math.Floor(sx))
			fx := sx - float64(x0)
			x0 = clampInt(x0, 0, sw-1)
			x1 := clampInt(x0+1, 0, sw-1)

			p00 := rgba.Pix[row0+x0*4 : row0+x0*4+4]
			p01 := rgba.Pix[row0+x1*4 : row0+x1*4+4]
			p10 := rgba.Pix[row1+x0*4 : row1+x0*4+4]
			p11 := rgba.Pix[row1+x1*4 : row1+x1*4+4]
			o := dst.PixOffset(x, y)

			for c := 0; c < 4; c++ {
				top := float64(p00[c])*(1-fx) + float64(p01[c])*fx
				bottom := float64(p10[c])*(1-fx) + float64(p11[c])*fx
				dst.Pix[o+c] = clampByte(top*(1-fy) + bottom*fy)
			}
		}
	}
	return dst
}

func clampInt(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func clampByte(v float64) uint8 {
	rounded := int(v + 0.5)
	if rounded < 0 {
		return 0
	}
	if rounded > 255 {
		return 255
	}
	return uint8(rounded)
}
