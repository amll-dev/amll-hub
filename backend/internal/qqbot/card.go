package qqbot

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png"
	"io"
	"math"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	logrus "github.com/sirupsen/logrus"
	"github.com/skip2/go-qrcode"
	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
	_ "golang.org/x/image/webp"
)

const (
	cardWidth     = 900
	cardMinHeight = 900 // min-h-[520px]

	cardMargin  = 28 // m-4 = 16px
	cardPadding = 28 // p-4 = 16px
	contentX    = cardMargin + cardPadding
	contentW    = cardWidth - 2*contentX
	contentR    = cardWidth - contentX

	panelRadius = 35 // rounded-[20px]
	coverRadius = 21 // rounded-[12px]

	coverGap    = 21 // mb-3
	titleLineH  = 40 // text-lg leading-[1.3]
	titleGap    = 10 // mb-1.5
	artistLineH = 31 // text-xs leading-[1.5]
	titleRowGap = 21 // mb-3

	qrSize = 97 // h-14 w-14

	sepTopGap     = 26 // my-[15px]
	sepDotRadius  = 3  // 1.5px 半径
	sepDotSpacing = 23 // 13px 间距
	sepBottomGap  = 35 // mb-5

	dateBlockW   = 138 // w-20
	dateIndent   = 17  // pl-2.5
	monthLineH   = 35  // text-[20px] leading-none
	monthGap     = 9   // mb-[5px]
	commentGap   = 35  // gap-5
	commentRPad  = 87  // pr-[50px]
	commentLineH = 47  // 17px × 1.6
	smallLineH   = 38  // 0.8em 小字
	emptyLineH   = 16  // 空行
	attrGap      = 17  // mt-2.5
	attrLineH    = 34  // 13px × 1.5
	dateMinH     = 173 // min-h-[100px]

	bottomGap      = 35 // mb-5
	bottomInnerGap = 9  // mt-[5px]
	bottomSepGap   = 21 // mb-3

	maxCommentLines = 14
)

var (
	foreground  = color.RGBA{29, 29, 31, 255}     // #1d1d1f
	ink2        = color.RGBA{83, 83, 89, 255}     // #535359
	ink3Sep     = color.NRGBA{110, 110, 118, 128} // #6e6e76 @ 50%
	ink3Quote   = color.NRGBA{110, 110, 118, 153} // #6e6e76 @ 60%
	panelWhite  = color.NRGBA{255, 255, 255, 204} // bg-card/80
	qrInk       = color.NRGBA{0, 0, 0, 153}       // QR 容器 opacity-60
	cardBG      = color.RGBA{251, 251, 253, 255}  // #fbfbfd
	placeholder = color.RGBA{211, 211, 211, 255}  // #D3D3D3
)

var (
	cardFontOnce  sync.Once
	cardFont      *opentype.Font
	cardBoldFont  *opentype.Font
	cardSerifFont *opentype.Font
	cardFontErr   error
)

// renderDailyCard
func (b *Bot) renderDailyCard(ctx context.Context, rec *model.DailyRecommendation) ([]byte, int, int, error) {
	cover, _ := b.loadDailyCover(ctx, rec)
	return b.renderCard(rec, cover)
}

type cardCommentLine struct {
	text    string
	align   string
	small   bool
	divider bool
	height  int
}

// renderCard 纯绘制：布局、动态高度与封面都由本函数处理。
func (b *Bot) renderCard(rec *model.DailyRecommendation, cover image.Image) ([]byte, int, int, error) {
	regular, err := b.cardTypeface()
	if err != nil {
		return nil, 0, 0, err
	}
	bold := b.cardBoldTypeface()
	serif := b.cardSerifTypeface()

	titleFace := newCardFace(bold, 31)
	defer closeFace(titleFace)
	artistFace := newCardFace(bold, 21)
	defer closeFace(artistFace)
	monthFace := newCardFace(regular, monthLineH)
	defer closeFace(monthFace)
	dayFace := newCardFace(regular, 78)
	defer closeFace(dayFace)
	commentFace := newCardFace(regular, 29)
	defer closeFace(commentFace)
	commentSmallFace := newCardFace(regular, 23)
	defer closeFace(commentSmallFace)
	attrFace := newCardFace(regular, 23)
	defer closeFace(attrFace)
	footerFace := newCardFace(regular, 28)
	defer closeFace(footerFace)
	quoteFace := newCardFace(serif, 87)
	if quoteFace != nil {
		if _, ok := quoteFace.GlyphAdvance('❞'); !ok {
			// 西文字体通常不含引号字符，回退到中文字体
			closeFace(quoteFace)
			quoteFace = newCardFace(regular, 87)
		}
	}
	defer closeFace(quoteFace)

	commentX := contentX + dateBlockW + commentGap
	commentW := contentR - commentRPad - commentX

	lines := buildCommentLines(rec, commentFace, commentSmallFace, commentW)
	commentH := 0
	for _, line := range lines {
		commentH += line.height
	}
	attribution := fmt.Sprintf("--来自 @%s 的评论", dailySubmitter(rec))
	attrLines := wrapFaceText(attrFace, attribution, commentW)
	attrH := len(attrLines) * attrLineH
	blockH := commentH + attrGap + attrH
	if blockH < dateMinH {
		blockH = dateMinH
	}

	y := cardMargin + cardPadding
	coverTop := y
	y = coverTop + contentW + coverGap

	rowTop := y
	titleBlockH := titleLineH + titleGap + artistLineH
	rowH := titleBlockH
	if rowH < qrSize {
		rowH = qrSize
	}
	y += rowH + titleRowGap

	sep1Y := y + sepTopGap + sepDotRadius
	y += sepTopGap + sepDotRadius*2 + sepBottomGap

	commentTop := y
	y += blockH + bottomGap

	sep2Y := y + bottomInnerGap + sepDotRadius
	y += bottomInnerGap + sepDotRadius*2 + bottomSepGap

	footerTop := y
	y += faceLineHeight(footerFace)

	height := y + cardPadding + cardMargin
	if height < cardMinHeight {
		height = cardMinHeight
	}

	canvas := image.NewRGBA(image.Rect(0, 0, cardWidth, height))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{cardBG}, image.Point{}, draw.Src)
	if cover != nil {
		drawBlurredCover(canvas, cover)
	}

	panel := image.Rect(cardMargin, cardMargin, cardWidth-cardMargin, height-cardMargin)
	panelMask := roundedRectMask(panel.Dx(), panel.Dy(), panelRadius)
	draw.DrawMask(canvas, panel, &image.Uniform{panelWhite}, image.Point{}, panelMask, image.Point{}, draw.Over)

	drawRoundedImage(canvas, image.Rect(contentX, coverTop, contentR, coverTop+contentW), cover, coverRadius)

	// 标题行：左侧歌名/歌手，右侧二维码
	titleRight := contentR - qrSize - 22
	song := fitText(titleFace, firstNonEmpty([]string{rec.SongName}, "未知歌曲"), titleRight)
	artist := fitText(artistFace, firstNonEmpty([]string{rec.Artist}, "未知歌手"), titleRight)
	drawText(canvas, titleFace, contentX, rowTop+faceAscent(titleFace), song, foreground)
	drawText(canvas, artistFace, contentX, rowTop+titleLineH+titleGap+faceAscent(artistFace), artist, ink2)

	date := recDate(rec)
	if b.cfg.SiteURL != "" && date != "" {
		qrContent := strings.TrimRight(b.cfg.SiteURL, "/") + "/daily?date=" + url.QueryEscape(date)
		drawQRCode(canvas, qrContent, contentR-qrSize, rowTop, qrSize)
	}

	drawDottedLine(canvas, contentX, contentR, sep1Y, ink3Sep)

	month, dayText := "未知", "--"
	at := time.Time{}
	if rec != nil {
		at = time.Time(rec.Date)
	}
	if !at.IsZero() {
		month = at.Format("Jan")
		dayText = fmt.Sprintf("%d", at.Day())
	}
	dateX := contentX + dateIndent
	drawText(canvas, monthFace, dateX, commentTop+faceAscent(monthFace), month, ink2)
	drawText(canvas, dayFace, dateX, commentTop+monthLineH+monthGap+faceAscent(dayFace), dayText, foreground)

	drawCommentLines(canvas, lines, commentFace, commentSmallFace, commentX, commentW, commentTop, ink2)

	// 右下角引号
	if quoteFace != nil {
		if _, ok := quoteFace.GlyphAdvance('❞'); ok {
			quote := "❞"
			qw := font.MeasureString(quoteFace, quote).Round()
			drawText(canvas, quoteFace, contentR-qw, commentTop+blockH+attrGap, quote, ink3Quote)
		}
	}

	// 推荐人按容器宽度折行后右对齐
	attrRight := contentR - commentRPad
	for i, line := range attrLines {
		lineW := font.MeasureString(attrFace, line).Round()
		baseline := commentTop + commentH + attrGap + i*attrLineH + faceAscent(attrFace)
		drawText(canvas, attrFace, attrRight-lineW, baseline, line, ink2)
	}

	drawDottedLine(canvas, contentX, contentR, sep2Y, ink3Sep)
	footer := "AMLL Hub | 今日推荐"
	footerW := font.MeasureString(footerFace, footer).Round()
	drawText(canvas, footerFace, contentX+(contentW-footerW)/2, footerTop+faceAscent(footerFace), footer, ink2)

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, canvas, &jpeg.Options{Quality: 92}); err != nil {
		return nil, 0, 0, err
	}
	return buf.Bytes(), cardWidth, height, nil
}

func (b *Bot) cardTypeface() (*opentype.Font, error) {
	cardFontOnce.Do(func() {
		regularPaths := make([]string, 0, 9)
		if path := strings.TrimSpace(b.cfg.FontPath); path != "" {
			regularPaths = append(regularPaths, path)
		}
		regularPaths = append(regularPaths,
			`C:\Windows\Fonts\msyh.ttc`,
			`C:\Windows\Fonts\msyh.ttf`,
			`C:\Windows\Fonts\simhei.ttf`,
			`/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`,
			`/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc`,
			`/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf`,
			`/usr/share/fonts/truetype/wqy/wqy-microhei.ttc`,
			`/System/Library/Fonts/PingFang.ttc`,
		)
		boldPaths := []string{
			`C:\Windows\Fonts\msyhbd.ttc`,
			`C:\Windows\Fonts\msyhbd.ttf`,
			`/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc`,
			`/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc`,
			`/usr/share/fonts/opentype/noto/NotoSansCJKsc-Bold.otf`,
			`/System/Library/Fonts/PingFang.ttc`,
		}
		serifPaths := []string{
			`C:\Windows\Fonts\seguisym.ttf`,
			`C:\Windows\Fonts\georgia.ttf`,
			`C:\Windows\Fonts\times.ttf`,
			`/System/Library/Fonts/Times.ttc`,
			`/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf`,
			`/usr/share/fonts/truetype/noto/NotoSerifCJK-Regular.ttc`,
		}

		cardFont, cardFontErr = loadFirstFont(regularPaths)
		cardBoldFont, _ = loadFirstFont(boldPaths)
		if cardBoldFont == nil {
			cardBoldFont = cardFont
		}
		cardSerifFont, _ = loadFirstFont(serifPaths)
		if cardSerifFont == nil {
			cardSerifFont = cardFont
		}
	})
	return cardFont, cardFontErr
}

func (b *Bot) cardBoldTypeface() *opentype.Font {
	if _, err := b.cardTypeface(); err != nil {
		return nil
	}
	if cardBoldFont != nil {
		return cardBoldFont
	}
	return cardFont
}

func (b *Bot) cardSerifTypeface() *opentype.Font {
	if _, err := b.cardTypeface(); err != nil {
		return nil
	}
	if cardSerifFont != nil {
		return cardSerifFont
	}
	return cardFont
}

func loadFirstFont(paths []string) (*opentype.Font, error) {
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		collection, err := opentype.ParseCollection(data)
		if err != nil || collection.NumFonts() == 0 {
			continue
		}
		firstFont, err := collection.Font(0)
		if err != nil {
			continue
		}
		logrus.WithField("font", path).Info("[qqbot] 每日推荐卡片字体已加载")
		return firstFont, nil
	}
	return nil, errors.New("未找到可用中文字体，请配置 QQ_BOT_FONT_PATH")
}

func (b *Bot) loadDailyCover(ctx context.Context, rec *model.DailyRecommendation) (image.Image, error) {
	if rec == nil || rec.CoverKey == "" {
		return nil, errors.New("没有封面")
	}
	img, err := b.daily.GetThumb(ctx, rec.CoverKey)
	if err != nil {
		return nil, err
	}
	defer img.Content.Close()

	data, err := io.ReadAll(io.LimitReader(img.Content, 16<<20))
	if err != nil {
		return nil, err
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	return decoded, err
}

var markupLinePattern = regexp.MustCompile(`^\[([:_-]+)\](.*)$`)

type markupLine struct {
	text    string
	align   string
	small   bool
	divider bool
}

// parseMarkupLines 解析每日推荐卡片的轻量标记：[:-:] 居中、[-:] 右对齐、[:_:] 小字等。
func parseMarkupLines(comment string) []markupLine {
	if strings.TrimSpace(comment) == "" {
		return nil
	}
	rawLines := strings.Split(comment, "\n")
	lines := make([]markupLine, 0, len(rawLines))
	for _, raw := range rawLines {
		line := strings.TrimSpace(raw)
		if line == "" {
			lines = append(lines, markupLine{})
			continue
		}
		match := markupLinePattern.FindStringSubmatch(line)
		if match == nil {
			lines = append(lines, markupLine{text: line, align: "left"})
			continue
		}
		spec := match[1]
		content := strings.TrimSpace(match[2])
		if spec == "-" {
			lines = append(lines, markupLine{divider: true, text: content})
			continue
		}
		normalized := strings.ReplaceAll(spec, "_", "-")
		align := "left"
		if strings.Contains(normalized, ":-:") {
			align = "center"
		} else if strings.Contains(normalized, "-:") {
			align = "right"
		}
		lines = append(lines, markupLine{
			text:  content,
			align: align,
			small: strings.Contains(spec, "_"),
		})
	}
	return lines
}

// buildCommentLines 将标记文本按卡片栏宽折行，行为与浏览器 break-words 一致。
func buildCommentLines(rec *model.DailyRecommendation, normal, small font.Face, width int) []cardCommentLine {
	if rec == nil {
		return nil
	}
	parsed := parseMarkupLines(rec.Comment)
	lines := make([]cardCommentLine, 0, len(parsed))
	for _, item := range parsed {
		switch {
		case item.divider:
			if item.text == "" {
				lines = append(lines, cardCommentLine{divider: true, height: emptyLineH})
			} else {
				lines = append(lines, cardCommentLine{divider: true, text: item.text, height: commentLineH})
			}
		case item.text == "":
			lines = append(lines, cardCommentLine{height: emptyLineH})
		default:
			face := normal
			lineH := commentLineH
			if item.small {
				face = small
				lineH = smallLineH
			}
			for _, segment := range wrapFaceText(face, item.text, width) {
				lines = append(lines, cardCommentLine{
					text:   segment,
					align:  item.align,
					small:  item.small,
					height: lineH,
				})
			}
		}
	}
	if len(lines) > maxCommentLines {
		lines = lines[:maxCommentLines]
		last := &lines[maxCommentLines-1]
		last.text = fitText(commentFaceOf(last, normal, small), last.text+"…", width)
	}
	return lines
}

func commentFaceOf(line *cardCommentLine, normal, small font.Face) font.Face {
	if line.small {
		return small
	}
	return normal
}

// wrapFaceText 按浏览器习惯折行：西文单词整体不拆，中文逐字折行，
// 行首避免出现句号、逗号等收尾标点。
func wrapFaceText(face font.Face, text string, maxWidth int) []string {
	if face == nil || text == "" {
		return []string{text}
	}
	tokens := tokenizeForWrap(text)
	var out []string
	line := ""
	for _, token := range tokens {
		if token == " " {
			if line != "" && font.MeasureString(face, line+" ").Round() <= maxWidth {
				line += " "
			}
			continue
		}
		candidate := line + token
		if line != "" &&
			font.MeasureString(face, candidate).Round() > maxWidth &&
			!isClosingPunct([]rune(token)[0]) {
			out = append(out, strings.TrimRight(line, " "))
			line = token
		} else {
			line = candidate
		}
	}
	if strings.TrimSpace(line) != "" {
		out = append(out, strings.TrimRight(line, " "))
	}
	if len(out) == 0 {
		out = append(out, "")
	}
	return out
}

// tokenizeForWrap 将文本切成折行单元：连续西文字符保持为整体，空格单独保留。
func tokenizeForWrap(text string) []string {
	var tokens []string
	var word []rune
	flush := func() {
		if len(word) > 0 {
			tokens = append(tokens, string(word))
			word = word[:0]
		}
	}
	for _, r := range text {
		switch {
		case r == ' ':
			flush()
			tokens = append(tokens, " ")
		case r < 128 && (unicode.IsLetter(r) || unicode.IsDigit(r) || strings.ContainsRune("_@.-'&+", r)):
			word = append(word, r)
		default:
			flush()
			tokens = append(tokens, string(r))
		}
	}
	flush()
	return tokens
}

func isClosingPunct(r rune) bool {
	return strings.ContainsRune("。，、！？；：）》」』】”’…—,.!?;:)]}", r)
}

func drawCommentLines(
	dst *image.RGBA,
	lines []cardCommentLine,
	normal, small font.Face,
	x, width, top int,
	col color.Color,
) {
	y := top
	for _, line := range lines {
		if line.divider {
			if line.text != "" {
				drawDivider(dst, small, line.text, x, width, y+line.height/2)
			}
			y += line.height
			continue
		}
		if line.text == "" {
			y += line.height
			continue
		}

		face := normal
		if line.small {
			face = small
		}
		if face == nil {
			y += line.height
			continue
		}
		textWidth := font.MeasureString(face, line.text).Round()
		tx := x
		switch line.align {
		case "center":
			tx = x + (width-textWidth)/2
		case "right":
			tx = x + width - textWidth
		}
		drawText(dst, face, tx, y+faceAscent(face), line.text, col)
		y += line.height
	}
}

func drawDivider(dst *image.RGBA, face font.Face, text string, x, width, centerY int) {
	textWidth := 0
	if face != nil {
		textWidth = font.MeasureString(face, text).Round()
		drawText(dst, face, x+(width-textWidth)/2, centerY+faceAscent(face)/2-4, text, color.RGBA{74, 74, 74, 255})
	}
	gap := textWidth/2 + 18
	leftStart := x + width/4
	leftEnd := x + width/2 - gap
	rightStart := x + width/2 + gap
	rightEnd := x + width*3/4
	drawDashedLine(dst, leftStart, leftEnd, centerY, ink3Sep)
	drawDashedLine(dst, rightStart, rightEnd, centerY, ink3Sep)
}

func drawQRCode(dst *image.RGBA, content string, x, y, size int) {
	qr, err := qrcode.New(content, qrcode.Medium)
	if err != nil {
		return
	}
	bitmap := qr.Bitmap()
	modules := len(bitmap)
	if modules == 0 {
		return
	}

	moduleSize := size / modules
	if moduleSize < 1 {
		moduleSize = 1
	}
	qrPixels := moduleSize * modules
	offsetX := x + (size-qrPixels)/2
	offsetY := y + (size-qrPixels)/2

	ink := image.NewUniform(qrInk)
	for row := 0; row < modules; row++ {
		for col := 0; col < modules; col++ {
			if !bitmap[row][col] {
				continue
			}
			rect := image.Rect(
				offsetX+col*moduleSize,
				offsetY+row*moduleSize,
				offsetX+(col+1)*moduleSize,
				offsetY+(row+1)*moduleSize,
			)
			draw.Draw(dst, rect, ink, image.Point{}, draw.Over)
		}
	}
}

// drawBlurredCover 模拟前端 scale-110 + brightness-75 + blur(100px) + opacity-90 的背景。
func drawBlurredCover(dst *image.RGBA, src image.Image) {
	bounds := src.Bounds()
	sw, sh := bounds.Dx(), bounds.Dy()
	if sw <= 0 || sh <= 0 {
		return
	}

	// 取居中裁剪后的源区域，保持卡片比例
	aspect := float64(cardWidth) / float64(dst.Bounds().Dy())
	cropW, cropH := float64(sw), float64(sh)
	if float64(sw)/float64(sh) > aspect {
		cropW = float64(sh) * aspect
	} else {
		cropH = float64(sw) / aspect
	}
	crop := image.Rect(
		bounds.Min.X+int((float64(sw)-cropW)/2),
		bounds.Min.Y+int((float64(sh)-cropH)/2),
		bounds.Min.X+int((float64(sw)+cropW)/2),
		bounds.Min.Y+int((float64(sh)+cropH)/2),
	)

	// 缩到极小再放大 ≈ 前端 blur(100px)，只保留大色块，不出现可辨认的图案
	smallW := 4
	smallH := int(math.Round(float64(dst.Bounds().Dy()) * float64(smallW) / cardWidth))
	if smallH < 1 {
		smallH = 1
	}
	small := image.NewRGBA(image.Rect(0, 0, smallW, smallH))
	xdraw.ApproxBiLinear.Scale(small, small.Bounds(), src, crop, draw.Src, nil)

	// brightness(0.75) + opacity(0.9)；RGBA 为预乘 alpha，需同步缩放
	const alpha = 230.0 / 255.0
	factor := 0.75 * alpha
	for i := 0; i < len(small.Pix); i += 4 {
		small.Pix[i] = uint8(float64(small.Pix[i]) * factor)
		small.Pix[i+1] = uint8(float64(small.Pix[i+1]) * factor)
		small.Pix[i+2] = uint8(float64(small.Pix[i+2]) * factor)
		small.Pix[i+3] = 230
	}

	scaled := image.NewRGBA(dst.Bounds())
	xdraw.ApproxBiLinear.Scale(scaled, scaled.Bounds(), small, small.Bounds(), draw.Src, nil)
	draw.Draw(dst, dst.Bounds(), scaled, image.Point{}, draw.Over)
}

func drawRoundedImage(dst *image.RGBA, area image.Rectangle, src image.Image, radius int) {
	tmp := image.NewRGBA(image.Rect(0, 0, area.Dx(), area.Dy()))
	if src != nil {
		if !drawImageCover(tmp, src) {
			draw.Draw(tmp, tmp.Bounds(), &image.Uniform{placeholder}, image.Point{}, draw.Src)
		}
	} else {
		draw.Draw(tmp, tmp.Bounds(), &image.Uniform{placeholder}, image.Point{}, draw.Src)
	}

	mask := roundedRectMask(area.Dx(), area.Dy(), radius)
	draw.DrawMask(dst, area, tmp, image.Point{}, mask, image.Point{}, draw.Over)
}

func drawImageCover(dst *image.RGBA, src image.Image) bool {
	bounds := src.Bounds()
	sw, sh := bounds.Dx(), bounds.Dy()
	if sw <= 0 || sh <= 0 {
		return false
	}

	dw, dh := dst.Bounds().Dx(), dst.Bounds().Dy()
	scale := math.Max(float64(dw)/float64(sw), float64(dh)/float64(sh))
	w := int(math.Round(float64(sw) * scale))
	h := int(math.Round(float64(sh) * scale))
	if w < dw {
		w = dw
	}
	if h < dh {
		h = dh
	}

	scaled := image.NewRGBA(image.Rect(0, 0, w, h))
	xdraw.CatmullRom.Scale(scaled, scaled.Bounds(), src, bounds, draw.Src, nil)
	offset := image.Pt((w-dw)/2, (h-dh)/2)
	draw.Draw(dst, dst.Bounds(), scaled, offset, draw.Src)
	return true
}

func roundedRectMask(w, h, radius int) *image.Alpha {
	mask := image.NewAlpha(image.Rect(0, 0, w, h))
	if radius > w/2 {
		radius = w / 2
	}
	if radius > h/2 {
		radius = h / 2
	}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if insideRoundedRect(x, y, w, h, radius) {
				mask.SetAlpha(x, y, color.Alpha{A: 255})
			}
		}
	}
	return mask
}

func insideRoundedRect(x, y, w, h, radius int) bool {
	if radius <= 0 {
		return true
	}
	cx, cy := x, y
	if x < radius {
		cx = radius
	} else if x >= w-radius {
		cx = w - radius - 1
	}
	if y < radius {
		cy = radius
	} else if y >= h-radius {
		cy = h - radius - 1
	}
	dx, dy := x-cx, y-cy
	return dx*dx+dy*dy <= radius*radius
}

func drawDottedLine(dst *image.RGBA, x1, x2, y int, col color.Color) {
	for x := x1 + sepDotRadius; x <= x2-sepDotRadius; x += sepDotSpacing {
		drawDot(dst, x, y, sepDotRadius, col)
	}
}

func drawDashedLine(dst *image.RGBA, x1, x2, y int, col color.Color) {
	const dash, gap = 6, 6
	for x := x1; x < x2; x += dash + gap {
		end := x + dash
		if end > x2 {
			end = x2
		}
		draw.Draw(dst, image.Rect(x, y-1, end, y+1), &image.Uniform{col}, image.Point{}, draw.Over)
	}
}

func drawDot(dst *image.RGBA, cx, cy, radius int, col color.Color) {
	for y := -radius; y <= radius; y++ {
		for x := -radius; x <= radius; x++ {
			if x*x+y*y <= radius*radius {
				dst.Set(cx+x, cy+y, col)
			}
		}
	}
}

func newCardFace(typeface *opentype.Font, size float64) font.Face {
	if typeface == nil {
		return nil
	}
	face, err := opentype.NewFace(typeface, &opentype.FaceOptions{
		Size:    size,
		DPI:     72,
		Hinting: font.HintingFull,
	})
	if err != nil {
		return nil
	}
	return face
}

func closeFace(face font.Face) {
	if face != nil {
		_ = face.Close()
	}
}

func faceAscent(face font.Face) int {
	if face == nil {
		return 0
	}
	return face.Metrics().Ascent.Round()
}

func faceLineHeight(face font.Face) int {
	if face == nil {
		return 0
	}
	m := face.Metrics()
	return (m.Ascent + m.Descent).Round()
}

func drawText(dst draw.Image, face font.Face, x, baseline int, text string, col color.Color) {
	if face == nil || text == "" {
		return
	}
	drawer := &font.Drawer{
		Dst:  dst,
		Src:  image.NewUniform(col),
		Face: face,
		Dot:  fixed.P(x, baseline),
	}
	drawer.DrawString(text)
}

func fitText(face font.Face, text string, maxWidth int) string {
	text = strings.TrimSpace(strings.ReplaceAll(text, "\n", " "))
	if face == nil || text == "" {
		return ""
	}
	if font.MeasureString(face, text).Round() <= maxWidth {
		return text
	}

	runes := []rune(text)
	for len(runes) > 1 {
		runes = runes[:len(runes)-1]
		candidate := string(runes) + "…"
		if font.MeasureString(face, candidate).Round() <= maxWidth {
			return candidate
		}
	}
	return string(runes[:1]) + "…"
}
