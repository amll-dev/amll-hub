package qqbot

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	logrus "github.com/sirupsen/logrus"
)

const (
	dateLayout = "2006-01-02"

	searchCacheTTL  = 60 * time.Second
	dailyCacheTTL   = 5 * time.Minute
	latestCacheTTL  = 5 * time.Minute
	rankingCacheTTL = 60 * time.Second

	// QQ 单条消息有长度限制，Markdown 图片直接内嵌，预留余量
	maxReplyRunes = 3000
)

var siteLoc = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.FixedZone("CST", 8*3600)
	}
	return loc
}()

type commandKind int

const (
	cmdHelp commandKind = iota
	cmdSearch
	cmdDailyToday
	cmdDailyByDate
	cmdLatest
	cmdRanking
)

type command struct {
	kind  commandKind
	query string
	field string
	date  string
}

type coverImage struct {
	URL         string
	Data        []byte
	FileName    string
	ContentType string
	Caption     string
	Width       int
	Height      int
}

type reply struct {
	Text         string
	FallbackText string
	Images       []coverImage
}

type rankingSnapshot struct {
	Total int64
	Items []service.RankingItem
}

var mentionPattern = regexp.MustCompile(`<@!?[^>]+>`)

// normalizeText 去掉引用/at 残留与指令前缀符号。
func normalizeText(raw string) string {
	text := mentionPattern.ReplaceAllString(raw, "")
	text = strings.TrimSpace(text)
	text = strings.TrimLeft(text, "/／!！")
	return strings.TrimSpace(text)
}

func parseCommand(raw string) command {
	text := normalizeText(raw)
	if text == "" {
		return command{kind: cmdHelp}
	}

	switch strings.ToLower(text) {
	case "帮助", "help", "指令", "菜单", "?", "？":
		return command{kind: cmdHelp}
	case "每日推荐", "今日推荐", "今天推荐", "推荐", "daily", "dailyrec", "daily-recommend":
		return command{kind: cmdDailyToday}
	case "最新", "最新收录", "最近更新", "latest":
		return command{kind: cmdLatest}
	case "无歌词排行", "无歌词排行榜", "缺失排行", "排行榜", "排行", "notfound", "not-found", "nolyrics", "no-lyrics":
		return command{kind: cmdRanking}
	}

	// /dailyrec <日期>：QQ 开放平台配置的指令名，可带日期参数
	if strings.HasPrefix(strings.ToLower(text), "dailyrec") && len(text) > len("dailyrec") {
		rest := strings.TrimSpace(text[len("dailyrec"):])
		if date, ok := parseDateArg(rest, time.Now().In(siteLoc)); ok {
			return command{kind: cmdDailyByDate, date: date}
		}
		return command{kind: cmdHelp}
	}

	// 推荐 <日期>，解析失败时退回普通搜索
	if strings.HasPrefix(text, "推荐") && len(text) > len("推荐") {
		rest := strings.TrimSpace(text[len("推荐"):])
		if date, ok := parseDateArg(rest, time.Now().In(siteLoc)); ok {
			return command{kind: cmdDailyByDate, date: date}
		}
		return command{kind: cmdSearch, query: rest, field: "all"}
	}

	// 歌词类前缀必须先于普通搜索判断，否则「搜歌词」会被「搜」截走
	for _, prefix := range []string{"搜歌词", "查歌词", "找歌词", "歌词"} {
		if strings.HasPrefix(text, prefix) {
			return command{kind: cmdSearch, query: strings.TrimSpace(text[len(prefix):]), field: "lyric"}
		}
	}

	for _, prefix := range []string{"搜索", "点歌", "查歌", "找歌", "搜歌"} {
		if strings.HasPrefix(text, prefix) {
			return command{kind: cmdSearch, query: strings.TrimSpace(text[len(prefix):]), field: "all"}
		}
	}
	if len(text) >= len("search") && strings.EqualFold(text[:len("search")], "search") {
		return command{kind: cmdSearch, query: strings.TrimSpace(text[len("search"):]), field: "all"}
	}

	// 群聊里 @ 机器人后直接说话，默认当搜索关键词
	return command{kind: cmdSearch, query: text, field: "all"}
}

// parseDateArg 支持 2026-11-20、2026/11/20、11-20、11月20日、今天、昨天、前天。
func parseDateArg(raw string, now time.Time) (string, bool) {
	text := strings.TrimSpace(raw)
	switch text {
	case "今天":
		return now.Format(dateLayout), true
	case "昨天":
		return now.AddDate(0, 0, -1).Format(dateLayout), true
	case "前天":
		return now.AddDate(0, 0, -2).Format(dateLayout), true
	}

	normalized := strings.NewReplacer("年", "-", "月", "-", "日", "").Replace(text)
	normalized = strings.Trim(normalized, "-/ ")
	if normalized == "" {
		return "", false
	}

	for _, layout := range []string{"2006-01-02", "2006-1-2", "2006/1/2"} {
		if t, err := time.ParseInLocation(layout, normalized, now.Location()); err == nil {
			return t.Format(dateLayout), true
		}
	}
	for _, layout := range []string{"1-2", "1/2"} {
		if t, err := time.ParseInLocation(layout, normalized, now.Location()); err == nil {
			return time.Date(now.Year(), t.Month(), t.Day(), 0, 0, 0, 0, now.Location()).Format(dateLayout), true
		}
	}
	return "", false
}

func (b *Bot) buildReply(ctx context.Context, text string) reply {
	cmd := parseCommand(text)
	now := time.Now().In(siteLoc)

	switch cmd.kind {
	case cmdSearch:
		return b.searchReply(ctx, cmd)
	case cmdDailyToday:
		return b.dailyReply(ctx, "today", "", now)
	case cmdDailyByDate:
		return b.dailyReply(ctx, cmd.date, cmd.date, now)
	case cmdLatest:
		return b.latestReply(ctx)
	case cmdRanking:
		return b.rankingReply(ctx)
	default:
		return reply{Text: helpText}
	}
}

func (b *Bot) searchReply(ctx context.Context, cmd command) reply {
	if cmd.query == "" {
		if cmd.field == "lyric" {
			return reply{Text: "请带上关键词，例如：/歌词 晴天"}
		}
		return reply{Text: "请带上关键词，例如：/search 晴天"}
	}

	cacheKey := cmd.field + "\x00" + cmd.query
	result, ok := b.searchCache.Get(cacheKey)
	if !ok {
		var err error
		result, err = b.search.Search(ctx, service.SearchRequest{
			Query: cmd.query,
			Field: cmd.field,
			Limit: 5,
			// 歌词搜索要包含旧版本，与网页端 Search 接口行为一致
			IncludeHistory: cmd.field == "lyric",
		})
		if err != nil {
			logrus.WithError(err).WithField("query", cmd.query).Warn("[qqbot] 搜索失败")
			return reply{Text: "搜索服务暂时不可用，请稍后再试。"}
		}
		b.searchCache.Set(cacheKey, result, searchCacheTTL)
	}

	text := formatSearchResult(result, cmd.query, b.cfg.SiteURL)
	if !b.cfg.Markdown || result == nil || len(result.Hits) == 0 {
		return reply{Text: text}
	}

	card, width, height, err := b.renderSearchCard(
		buildSearchRows(result.Hits), cmd.query, result.TotalHits, len(result.Hits))
	if err != nil {
		logrus.WithError(err).Warn("[qqbot] 渲染搜索结果图失败，改发文字")
		return reply{Text: text}
	}
	return reply{
		Text:         formatSearchCardText(result, cmd.query, b.cfg.SiteURL),
		FallbackText: text,
		Images: []coverImage{{
			Data:        card,
			FileName:    "search-list.jpg",
			ContentType: "image/jpeg",
			Caption:     fmt.Sprintf("搜索「%s」", cmd.query),
			Width:       width,
			Height:      height,
		}},
	}
}

func (b *Bot) dailyReply(ctx context.Context, cacheKey, date string, now time.Time) reply {
	rec, ok := b.dailyCache.Get(cacheKey)
	if !ok {
		var (
			err error
		)
		if date == "" {
			rec, err = b.daily.GetToday(ctx)
		} else {
			rec, err = b.daily.GetByDate(ctx, date)
		}
		if err != nil {
			if errors.Is(err, service.ErrNotFound) {
				if date == "" {
					return reply{Text: "还没有任何每日推荐。"}
				}
				return reply{Text: fmt.Sprintf("%s 没有每日推荐。", date)}
			}
			logrus.WithError(err).WithField("date", date).Warn("[qqbot] 查询每日推荐失败")
			return reply{Text: "查询每日推荐失败，请稍后再试。"}
		}
		b.dailyCache.Set(cacheKey, rec, dailyCacheTTL)
	}

	// 优先渲染成一张推荐卡片，只包含歌曲信息与推荐人
	if card, width, height, err := b.renderDailyCard(ctx, rec); err == nil {
		return reply{
			FallbackText: formatDailySummary(rec, now),
			Images: []coverImage{{
				Data:        card,
				FileName:    "daily-card.jpg",
				ContentType: "image/jpeg",
				Caption:     dailyCaption(rec),
				Width:       width,
				Height:      height,
			}},
		}
	} else {
		logrus.WithError(err).Warn("[qqbot] 渲染每日推荐卡片失败，仅发送文字")
	}

	// 卡片渲染失败时不再发封面，只保留歌曲信息与推荐人
	return reply{Text: formatDailySummary(rec, now)}
}

func (b *Bot) latestReply(ctx context.Context) reply {
	list, ok := b.latestCache.Get("latest")
	if !ok {
		items, err := b.latest.List(ctx)
		if err != nil {
			logrus.WithError(err).Warn("[qqbot] 查询最新收录失败")
			return reply{Text: "查询最新收录失败，请稍后再试。"}
		}
		if len(items) > 5 {
			items = items[:5]
		}
		list = items
		b.latestCache.Set("latest", list, latestCacheTTL)
	}
	text, images := formatLatestWithCovers(list, b.cfg.SiteURL)
	if !b.cfg.Markdown || len(list) == 0 {
		return reply{Text: text, Images: images}
	}

	urls := make([]string, len(list))
	for i, item := range list {
		urls[i] = item.CoverURL
	}
	covers := b.fetchListCovers(ctx, urls)
	card, width, height, err := b.renderLatestCard(buildLatestRows(list, covers), len(list))
	if err != nil {
		logrus.WithError(err).Warn("[qqbot] 渲染最新收录图失败，改发文字")
		return reply{Text: text, Images: images}
	}
	return reply{
		Text:         formatLatestCardText(list, b.cfg.SiteURL),
		FallbackText: text,
		Images: []coverImage{{
			Data:        card,
			FileName:    "latest-list.jpg",
			ContentType: "image/jpeg",
			Caption:     "最新收录",
			Width:       width,
			Height:      height,
		}},
	}
}

func (b *Bot) rankingReply(ctx context.Context) reply {
	snapshot, ok := b.rankingCache.Get("ranking")
	if !ok {
		total, items, err := b.notFound.GetRanking(ctx, 7, "", 10, 0)
		if err != nil {
			logrus.WithError(err).Warn("[qqbot] 查询无歌词排行榜失败")
			return reply{Text: "查询无歌词排行榜失败，请稍后再试。"}
		}
		snapshot = rankingSnapshot{Total: total, Items: items}
		b.rankingCache.Set("ranking", snapshot, rankingCacheTTL)
	}
	text, images := formatRankingWithCovers(snapshot.Total, snapshot.Items, b.cfg.SiteURL)
	if !b.cfg.Markdown || len(snapshot.Items) == 0 {
		return reply{Text: text, Images: images}
	}

	urls := make([]string, len(snapshot.Items))
	for i, item := range snapshot.Items {
		urls[i] = item.Cover
	}
	covers := b.fetchListCovers(ctx, urls)
	card, width, height, err := b.renderRankingCard(buildRankingRows(snapshot.Items, covers), snapshot.Total)
	if err != nil {
		logrus.WithError(err).Warn("[qqbot] 渲染排行榜图片失败，改发文字")
		return reply{Text: text, Images: images}
	}
	return reply{
		Text:         formatRankingCardText(snapshot.Total, b.cfg.SiteURL),
		FallbackText: text,
		Images: []coverImage{{
			Data:        card,
			FileName:    "ranking-list.jpg",
			ContentType: "image/jpeg",
			Caption:     "无歌词排行榜",
			Width:       width,
			Height:      height,
		}},
	}
}

// coverMarker 在正文里标记图片插入位置，上传完成后再替换成真实图片语法。
func coverMarker(index int) string {
	return fmt.Sprintf("{{cover:%d}}", index)
}

var coverMarkerPattern = regexp.MustCompile(`\{\{cover:\d+\}\}`)

const helpText = `**AMLL Hub 机器人指令**
- 搜索 <关键词> / 点歌 <关键词>：搜索歌词
- 歌词 <关键词>：只搜歌词文本
- 每日推荐：今日推荐（没有则显示最近一期）
- 推荐 <日期>：如「推荐 2026-11-20」「推荐 昨天」
- 最新收录：最近收录的歌曲
- 无歌词排行：近 7 天缺失 Top 10`

func formatSearchResult(result *service.SearchResult, query, siteURL string) string {
	if result == nil || len(result.Hits) == 0 {
		return fmt.Sprintf("没有找到「%s」相关结果。", clip(query, 40))
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "**「%s」共 %d 条，显示前 %d 条**\n",
		escapeMarkdown(clip(query, 40)), result.TotalHits, len(result.Hits))

	for i, hit := range result.Hits {
		name := strings.Join(nonEmpty(hit.MusicNames), " / ")
		if name == "" {
			name = "未知歌曲"
		}
		artist := strings.Join(nonEmpty(hit.Artists), " / ")
		album := strings.Join(nonEmpty(hit.Albums), " / ")

		fmt.Fprintf(&sb, "\n**%d. %s**\n", i+1, escapeMarkdown(name))
		if artist != "" {
			fmt.Fprintf(&sb, "- 歌手：%s\n", escapeMarkdown(artist))
		}
		if album != "" {
			fmt.Fprintf(&sb, "- 专辑：%s\n", escapeMarkdown(album))
		}
		if platforms := platformIDText(hit.PlatformIds); platforms != "" {
			fmt.Fprintf(&sb, "- 平台：%s\n", platforms)
		}
		if hit.WordCount > 0 || hit.LineCount > 0 {
			fmt.Fprintf(&sb, "- 歌词：%d 字 / %d 行\n", hit.WordCount, hit.LineCount)
		}
		if author := authorText(hit.TtmlAuthorGithubLogin, hit.TtmlAuthorGithub); author != "" {
			fmt.Fprintf(&sb, "- 作者：%s\n", escapeMarkdown(author))
		}
		if hit.CommitTimestamp != nil && *hit.CommitTimestamp > 0 {
			fmt.Fprintf(&sb, "- 提交时间：%s\n",
				time.UnixMilli(*hit.CommitTimestamp).In(siteLoc).Format("2006-01-02 15:04"))
		}
		if hit.RawLyricFile != "" {
			fmt.Fprintf(&sb, "- 文件：%s\n", escapeMarkdown(hit.RawLyricFile))
			fmt.Fprintf(&sb, "[查看歌词](%s/lyric/%s)\n", siteURL, url.PathEscape(hit.RawLyricFile))
		}
	}
	return clip(sb.String(), maxReplyRunes)
}

// formatSearchCardText 图片版搜索结果的精简正文：标题 + 一张图 + 可直接点的歌词链接。
func formatSearchCardText(result *service.SearchResult, query, siteURL string) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "**搜索「%s」 · 共 %d 条**\n%s\n",
		escapeMarkdown(clip(query, 40)), result.TotalHits, coverMarker(0))
	for i, hit := range result.Hits {
		if hit.RawLyricFile == "" {
			continue
		}
		name := strings.Join(nonEmpty(hit.MusicNames), " / ")
		if name == "" {
			name = "未知歌曲"
		}
		fmt.Fprintf(&sb, "%d. [%s](%s/lyric/%s)\n",
			i+1, escapeMarkdown(clip(name, 30)), siteURL, url.PathEscape(hit.RawLyricFile))
	}
	return clip(sb.String(), maxReplyRunes)
}

// formatLatestCardText 图片版最新收录的精简正文。
func formatLatestCardText(items []service.LatestSongItem, siteURL string) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "**最新收录 · %d 首**\n%s\n", len(items), coverMarker(0))
	for i, item := range items {
		if item.RawLyricFile == "" {
			continue
		}
		fmt.Fprintf(&sb, "%d. [%s](%s/lyric/%s)\n",
			i+1, escapeMarkdown(clip(firstNonEmpty([]string{item.Title}, "未知歌曲"), 30)),
			siteURL, url.PathEscape(item.RawLyricFile))
	}
	return clip(sb.String(), maxReplyRunes)
}

// formatRankingCardText 图片版排行榜的精简正文。
func formatRankingCardText(total int64, siteURL string) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "**无歌词排行榜 · 近 7 天**\n%s\n共 %d 条缺失记录", coverMarker(0), total)
	if siteURL != "" {
		fmt.Fprintf(&sb, "\n[查看完整榜单](%s/ranking)", siteURL)
	}
	return clip(sb.String(), maxReplyRunes)
}

func formatDailySummary(rec *model.DailyRecommendation, now time.Time) string {
	date := recDate(rec)
	title := "每日推荐"
	if date != "" && date != now.Format(dateLayout) {
		title = "往期推荐"
	}

	var sb strings.Builder
	if date != "" {
		fmt.Fprintf(&sb, "**%s · %s**\n", title, date)
	} else {
		fmt.Fprintf(&sb, "**%s**\n", title)
	}
	fmt.Fprintf(&sb, "《%s》 - %s\n",
		clip(firstNonEmpty([]string{rec.SongName}, "未知歌曲"), 60),
		clip(firstNonEmpty([]string{rec.Artist}, "未知歌手"), 60))
	fmt.Fprintf(&sb, "推荐人：@%s", dailySubmitter(rec))
	return clip(sb.String(), maxReplyRunes)
}

func dailyCaption(rec *model.DailyRecommendation) string {
	return fmt.Sprintf("每日推荐 · %s - %s · 推荐人：@%s",
		firstNonEmpty([]string{rec.SongName}, "未知歌曲"),
		firstNonEmpty([]string{rec.Artist}, "未知歌手"),
		dailySubmitter(rec))
}

func dailySubmitter(rec *model.DailyRecommendation) string {
	if rec == nil {
		return "匿名用户"
	}
	for _, key := range []string{"displayName", "name"} {
		if value, ok := rec.SubmitterInfo[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	if value := strings.TrimSpace(rec.Submitter); value != "" {
		return value
	}
	return "匿名用户"
}

func formatLatestWithCovers(items []service.LatestSongItem, siteURL string) (string, []coverImage) {
	if len(items) == 0 {
		return "暂无最新收录。", nil
	}

	var sb strings.Builder
	images := make([]coverImage, 0, len(items))
	fmt.Fprintf(&sb, "**最新收录（%d 首）**\n", len(items))
	for i, item := range items {
		title := firstNonEmpty([]string{item.Title}, "未知歌曲")
		fmt.Fprintf(&sb, "\n**%d. %s**", i+1, escapeMarkdown(clip(title, 60)))
		if item.Artist != "" {
			fmt.Fprintf(&sb, " - %s", escapeMarkdown(clip(item.Artist, 60)))
		}
		sb.WriteString("\n")
		if item.NcmID != "" {
			fmt.Fprintf(&sb, "- NCM ID：%s\n", escapeMarkdown(item.NcmID))
		}
		if item.RawLyricFile != "" {
			// 指向歌词库里的本地文件，而不是在线歌词页
			fmt.Fprintf(&sb, "[查看歌词](%s/lyric/%s)\n", siteURL, url.PathEscape(item.RawLyricFile))
		}
		if item.CoverURL != "" {
			index := len(images)
			images = append(images, coverImage{
				URL:     item.CoverURL,
				Caption: fmt.Sprintf("%d. %s - %s", i+1, title, item.Artist),
				Width:   600,
				Height:  600,
			})
			fmt.Fprintf(&sb, "\n%s\n", coverMarker(index))
		}
	}
	return clip(sb.String(), maxReplyRunes), images
}

func formatRankingWithCovers(total int64, items []service.RankingItem, siteURL string) (string, []coverImage) {
	if total == 0 || len(items) == 0 {
		return "近 7 天暂无无歌词记录。", nil
	}

	var sb strings.Builder
	images := make([]coverImage, 0, len(items))
	fmt.Fprintf(&sb, "**无歌词排行榜（近 7 天）**\n共 %d 条缺失记录\n", total)
	for i, item := range items {
		name := firstNonEmpty([]string{item.SongName}, "未知歌曲")
		artist := strings.Join(nonEmpty(item.Artists), " / ")

		fmt.Fprintf(&sb, "\n%d. **%s**", i+1, escapeMarkdown(clip(name, 50)))
		if artist != "" {
			fmt.Fprintf(&sb, " - %s", escapeMarkdown(clip(artist, 50)))
		}
		fmt.Fprintf(&sb, " · %d 次", item.RequestCount)
		if item.Cover != "" {
			index := len(images)
			caption := fmt.Sprintf("%d. %s", i+1, name)
			if artist != "" {
				caption += " - " + artist
			}
			images = append(images, coverImage{
				URL:     item.Cover,
				Caption: caption,
				Width:   600,
				Height:  600,
			})
			fmt.Fprintf(&sb, "\n%s", coverMarker(index))
		}
	}
	if siteURL != "" {
		fmt.Fprintf(&sb, "\n\n[查看完整榜单](%s/ranking)", siteURL)
	}
	return clip(sb.String(), maxReplyRunes), images
}

// platformIDText 按搜索页的 platform:id 形式输出全部平台 ID。
func platformIDText(ids map[string][]string) string {
	if len(ids) == 0 {
		return ""
	}

	keys := make([]string, 0, len(ids))
	for key := range ids {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	var parts []string
	for _, key := range keys {
		for _, id := range nonEmpty(ids[key]) {
			parts = append(parts, escapeMarkdown(key)+":"+escapeMarkdown(id))
		}
	}
	return strings.Join(parts, " · ")
}

func authorText(login, name string) string {
	login = strings.TrimSpace(login)
	name = strings.TrimSpace(name)
	switch {
	case login != "" && name != "" && login != name:
		return login + "（" + name + "）"
	case login != "":
		return login
	default:
		return name
	}
}

func recDate(rec *model.DailyRecommendation) string {
	if rec == nil {
		return ""
	}
	t := time.Time(rec.Date)
	if t.IsZero() {
		return ""
	}
	return t.Format(dateLayout)
}

func firstNonEmpty(values []string, fallback string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return fallback
}

func nonEmpty(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			out = append(out, strings.TrimSpace(value))
		}
	}
	return out
}

var markdownEscaper = strings.NewReplacer(
	"\\", "\\\\",
	"*", "\\*",
	"_", "\\_",
	"`", "\\`",
	"[", "\\[",
	"]", "\\]",
)

func escapeMarkdown(s string) string {
	return markdownEscaper.Replace(s)
}

var (
	markdownImagePattern = regexp.MustCompile(`!\[[^\]]*\]\(([^)]+)\)`)
	markdownLinkPattern  = regexp.MustCompile(`\[([^\]]+)\]\(([^)]+)\)`)
)

// plainFromMarkdown 把 Markdown 回退成可读纯文本，用于平台不支持 Markdown 时。
func plainFromMarkdown(s string) string {
	s = coverMarkerPattern.ReplaceAllString(s, "")
	s = markdownImagePattern.ReplaceAllString(s, "封面：$1")
	s = markdownLinkPattern.ReplaceAllString(s, "$1：$2")
	s = strings.ReplaceAll(s, "**", "")
	// 去掉转义反斜杠，避免纯文本里出现 song\_name 这类残留
	return strings.ReplaceAll(s, "\\", "")
}

func clip(s string, maxRunes int) string {
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	if maxRunes <= 1 {
		return string(runes[:maxRunes])
	}
	return string(runes[:maxRunes-1]) + "…"
}
