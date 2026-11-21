package qqbot

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/service"
	"golang.org/x/image/font"
)

// 列表类指令（搜索 / 最新收录 / 排行榜）渲染成一张竖图，
// 消息正文只保留标题和精简链接，避免刷屏。
const (
	listWidth  = 900
	listMargin = 30
	listPad    = 44

	listX = listMargin + listPad
	listW = listWidth - 2*listX

	listThumb    = 150
	listThumbGap = 28

	listTitleLine  = 44
	listDetailLine = 36

	listHeaderTitleH = 46
	listHeaderSubH   = 34
	listHeaderGap    = 12

	listSepTopGap = 24
	listSepHeight = 1
	listSepBotGap = 24

	listFooterH = 30
)

var (
	listBG      = color.RGBA{240, 241, 244, 255}  // 页面底色
	listPanel   = color.NRGBA{255, 255, 255, 238} // 卡片面板
	listInk     = color.RGBA{29, 29, 31, 255}
	listInk2    = color.RGBA{83, 83, 89, 255}
	listInk3    = color.RGBA{120, 120, 128, 255}
	listDot     = color.RGBA{198, 200, 206, 255}
	listDivider = color.RGBA{214, 216, 221, 255}
)

type listCardRowData struct {
	title        string
	details      []string
	cover        image.Image
	reserveCover bool
}

type listCardData struct {
	title    string
	subtitle string
	rows     []listCardRowData
}

type listCardRowLayout struct {
	data        listCardRowData
	titleLines  []string
	detailLines []string
	height      int
}

// renderSearchCard 把搜索结果渲染成长图。
func (b *Bot) renderSearchCard(resultRows []listCardRowData, query string, total int64, shown int) ([]byte, int, int, error) {
	subtitle := "共 " + strconv.FormatInt(total, 10) + " 条结果"
	if int64(shown) < total {
		subtitle += " · 显示前 " + strconv.Itoa(shown) + " 条"
	}
	return b.renderListCard(listCardData{
		title:    "搜索「" + query + "」",
		subtitle: subtitle,
		rows:     resultRows,
	})
}

// renderLatestCard 把最新收录渲染成长图。
func (b *Bot) renderLatestCard(rows []listCardRowData, total int) ([]byte, int, int, error) {
	return b.renderListCard(listCardData{
		title:    "最新收录",
		subtitle: "共 " + strconv.Itoa(total) + " 首",
		rows:     rows,
	})
}

// renderRankingCard 把无歌词排行榜渲染成长图。
func (b *Bot) renderRankingCard(rows []listCardRowData, total int64) ([]byte, int, int, error) {
	return b.renderListCard(listCardData{
		title:    "无歌词排行榜",
		subtitle: "近 7 天 · 共 " + strconv.FormatInt(total, 10) + " 条缺失记录",
		rows:     rows,
	})
}

func buildSearchRows(hits []service.SearchHitResult) []listCardRowData {
	rows := make([]listCardRowData, 0, len(hits))
	for i, hit := range hits {
		name := strings.Join(nonEmpty(hit.MusicNames), " / ")
		if name == "" {
			name = "未知歌曲"
		}

		details := make([]string, 0, 6)
		if artist := strings.Join(nonEmpty(hit.Artists), " / "); artist != "" {
			details = append(details, "歌手："+artist)
		}
		if album := strings.Join(nonEmpty(hit.Albums), " / "); album != "" {
			details = append(details, "专辑："+album)
		}
		if platforms := platformIDText(hit.PlatformIds); platforms != "" {
			details = append(details, "平台："+platforms)
		}

		meta := ""
		if hit.WordCount > 0 || hit.LineCount > 0 {
			meta = fmt.Sprintf("%d 字 / %d 行", hit.WordCount, hit.LineCount)
		}
		if author := authorText(hit.TtmlAuthorGithubLogin, hit.TtmlAuthorGithub); author != "" {
			meta = joinMeta(meta, "作者："+author)
		}
		if hit.CommitTimestamp != nil && *hit.CommitTimestamp > 0 {
			meta = joinMeta(meta, time.UnixMilli(*hit.CommitTimestamp).In(siteLoc).Format("2006-01-02 15:04"))
		}
		if meta != "" {
			details = append(details, meta)
		}
		if hit.RawLyricFile != "" {
			details = append(details, "文件："+hit.RawLyricFile)
		}

		rows = append(rows, listCardRowData{
			title:   fmt.Sprintf("%d. %s", i+1, name),
			details: details,
		})
	}
	return rows
}

func buildLatestRows(items []service.LatestSongItem, covers []image.Image) []listCardRowData {
	rows := make([]listCardRowData, 0, len(items))
	for i, item := range items {
		title := firstNonEmpty([]string{item.Title}, "未知歌曲")
		details := make([]string, 0, 3)
		if item.Artist != "" {
			details = append(details, item.Artist)
		}
		if item.NcmID != "" {
			details = append(details, "NCM ID："+item.NcmID)
		}
		if item.RawLyricFile != "" {
			details = append(details, "文件："+item.RawLyricFile)
		}
		row := listCardRowData{
			title:        fmt.Sprintf("%d. %s", i+1, title),
			details:      details,
			reserveCover: item.CoverURL != "",
		}
		if i < len(covers) {
			row.cover = covers[i]
		}
		rows = append(rows, row)
	}
	return rows
}

func buildRankingRows(items []service.RankingItem, covers []image.Image) []listCardRowData {
	rows := make([]listCardRowData, 0, len(items))
	for i, item := range items {
		name := firstNonEmpty([]string{item.SongName}, "未知歌曲")
		details := make([]string, 0, 3)
		if artist := strings.Join(nonEmpty(item.Artists), " / "); artist != "" {
			details = append(details, artist)
		}
		details = append(details, fmt.Sprintf("%d 次缺失", item.RequestCount))
		if item.Album != "" {
			details = append(details, "专辑："+item.Album)
		}
		row := listCardRowData{
			title:        fmt.Sprintf("%d. %s", i+1, name),
			details:      details,
			reserveCover: item.Cover != "",
		}
		if i < len(covers) {
			row.cover = covers[i]
		}
		rows = append(rows, row)
	}
	return rows
}

func joinMeta(left, right string) string {
	if left == "" {
		return right
	}
	if right == "" {
		return left
	}
	return left + " · " + right
}

func (b *Bot) renderListCard(data listCardData) ([]byte, int, int, error) {
	regular, err := b.cardTypeface()
	if err != nil {
		return nil, 0, 0, err
	}
	bold := b.cardBoldTypeface()

	titleFace := newCardFace(bold, 34)
	defer closeFace(titleFace)
	detailFace := newCardFace(regular, 26)
	defer closeFace(detailFace)
	headerFace := newCardFace(bold, 42)
	defer closeFace(headerFace)
	subtitleFace := newCardFace(regular, 26)
	defer closeFace(subtitleFace)
	footerFace := newCardFace(regular, 24)
	defer closeFace(footerFace)

	rows := make([]listCardRowLayout, 0, len(data.rows))
	for _, row := range data.rows {
		textWidth := listW
		if row.reserveCover {
			textWidth -= listThumb + listThumbGap
		}
		layout := listCardRowLayout{data: row}
		layout.titleLines = wrapFaceText(titleFace, row.title, textWidth)
		for _, detail := range row.details {
			if strings.TrimSpace(detail) == "" {
				continue
			}
			layout.detailLines = append(layout.detailLines, wrapFaceText(detailFace, detail, textWidth)...)
		}
		textH := len(layout.titleLines)*listTitleLine + len(layout.detailLines)*listDetailLine
		layout.height = textH
		if row.reserveCover && layout.height < listThumb {
			layout.height = listThumb
		}
		rows = append(rows, layout)
	}

	headerH := listHeaderTitleH + listHeaderGap + listHeaderSubH
	height := listMargin + listPad + headerH +
		listSepTopGap + listSepHeight + listSepBotGap
	for i, row := range rows {
		height += row.height
		if i < len(rows)-1 {
			height += listSepTopGap + listSepHeight + listSepBotGap
		}
	}
	if len(rows) > 0 {
		height += listSepTopGap + listSepHeight + listSepBotGap
	}
	height += listFooterH + listPad + listMargin
	if height < listMargin*2+listPad*2 {
		height = listMargin*2 + listPad*2
	}

	canvas := image.NewRGBA(image.Rect(0, 0, listWidth, height))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{listBG}, image.Point{}, draw.Src)
	panel := image.Rect(listMargin, listMargin, listWidth-listMargin, height-listMargin)
	draw.DrawMask(canvas, panel, &image.Uniform{listPanel}, image.Point{},
		roundedRectMask(panel.Dx(), panel.Dy(), 36), image.Point{}, draw.Over)

	y := listMargin + listPad
	drawText(canvas, headerFace, listX, y+faceAscent(headerFace), fitText(headerFace, data.title, listW), listInk)
	y += listHeaderTitleH + listHeaderGap
	drawText(canvas, subtitleFace, listX, y+faceAscent(subtitleFace), fitText(subtitleFace, data.subtitle, listW), listInk3)
	y += listHeaderSubH + listSepTopGap
	drawListSeparator(canvas, y)
	y += listSepHeight + listSepBotGap

	for i, row := range rows {
		rowTop := y
		textX := listX
		if row.data.reserveCover {
			coverRect := image.Rect(listX, rowTop, listX+listThumb, rowTop+listThumb)
			drawRoundedImage(canvas, coverRect, row.data.cover, 16)
			textX += listThumb + listThumbGap
		}

		textY := rowTop
		for _, line := range row.titleLines {
			drawText(canvas, titleFace, textX, textY+faceAscent(titleFace), line, listInk)
			textY += listTitleLine
		}
		for _, line := range row.detailLines {
			drawText(canvas, detailFace, textX, textY+faceAscent(detailFace), line, listInk2)
			textY += listDetailLine
		}

		y += row.height
		if i < len(rows)-1 {
			y += listSepTopGap
			drawListSeparator(canvas, y)
			y += listSepHeight + listSepBotGap
		}
	}

	if len(rows) > 0 {
		y += listSepTopGap
		drawListSeparator(canvas, y)
		y += listSepHeight + listSepBotGap
	}
	footer := "AMLL Hub"
	footerW := font.MeasureString(footerFace, footer).Round()
	drawText(canvas, footerFace, listX+(listW-footerW)/2, y+faceAscent(footerFace), footer, listInk3)

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, canvas, &jpeg.Options{Quality: 92}); err != nil {
		return nil, 0, 0, err
	}
	return buf.Bytes(), listWidth, height, nil
}

func drawListSeparator(dst *image.RGBA, y int) {
	for x := listX + 2; x <= listX+listW-2; x += 16 {
		drawDot(dst, x, y, 2, listDot)
	}
}

// fetchListCovers 并发下载列表缩略图，单张失败不影响整体。
func (b *Bot) fetchListCovers(ctx context.Context, urls []string) []image.Image {
	out := make([]image.Image, len(urls))
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for i, rawURL := range urls {
		if strings.TrimSpace(rawURL) == "" {
			continue
		}
		wg.Add(1)
		go func(index int, link string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			material, err := b.fetchMaterialImage(ctx, link)
			if err != nil {
				return
			}
			img, _, err := image.Decode(bytes.NewReader(material.Data))
			if err != nil {
				return
			}
			out[index] = img
		}(i, rawURL)
	}
	wg.Wait()
	return out
}
