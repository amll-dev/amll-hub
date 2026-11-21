package qqbot

import (
	"strings"
	"testing"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/service"
)

func TestParseCommand(t *testing.T) {
	now := time.Now().In(siteLoc)
	yesterday := now.AddDate(0, 0, -1).Format(dateLayout)

	cases := []struct {
		name  string
		input string
		kind  commandKind
		query string
		field string
		date  string
	}{
		{name: "帮助", input: "帮助", kind: cmdHelp},
		{name: "空消息", input: "   ", kind: cmdHelp},
		{name: "搜索", input: "搜索 晴天", kind: cmdSearch, query: "晴天", field: "all"},
		{name: "点歌", input: "/点歌 晴天", kind: cmdSearch, query: "晴天", field: "all"},
		{name: "平台指令 search", input: "/search 晴天", kind: cmdSearch, query: "晴天", field: "all"},
		{name: "平台指令 search 无参数", input: "/search", kind: cmdSearch, query: "", field: "all"},
		{name: "歌词", input: "歌词 晴天", kind: cmdSearch, query: "晴天", field: "lyric"},
		{name: "搜歌词不被搜索截走", input: "搜歌词 晴天", kind: cmdSearch, query: "晴天", field: "lyric"},
		{name: "默认搜索", input: "晴天", kind: cmdSearch, query: "晴天", field: "all"},
		{name: "去掉 at 残留", input: "<@!123456> 搜索 晴天", kind: cmdSearch, query: "晴天", field: "all"},
		{name: "今日推荐", input: "每日推荐", kind: cmdDailyToday},
		{name: "平台指令 dailyrec", input: "/dailyrec", kind: cmdDailyToday},
		{name: "平台指令 dailyrec 带日期", input: "/dailyrec 2026-11-20", kind: cmdDailyByDate, date: "2026-11-20"},
		{name: "推荐日期", input: "推荐 2026-11-20", kind: cmdDailyByDate, date: "2026-11-20"},
		{name: "推荐昨天", input: "推荐 昨天", kind: cmdDailyByDate, date: yesterday},
		{name: "最新收录", input: "最新", kind: cmdLatest},
		{name: "平台指令 latest", input: "/latest", kind: cmdLatest},
		{name: "无歌词排行", input: "无歌词排行", kind: cmdRanking},
		{name: "平台指令 nolyrics", input: "/nolyrics", kind: cmdRanking},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseCommand(tc.input)
			if got.kind != tc.kind {
				t.Fatalf("kind = %d, want %d", got.kind, tc.kind)
			}
			if got.query != tc.query {
				t.Errorf("query = %q, want %q", got.query, tc.query)
			}
			if got.field != tc.field {
				t.Errorf("field = %q, want %q", got.field, tc.field)
			}
			if got.date != tc.date {
				t.Errorf("date = %q, want %q", got.date, tc.date)
			}
		})
	}
}

func TestParseDateArg(t *testing.T) {
	now := time.Date(2026, 11, 21, 10, 0, 0, 0, siteLoc)

	cases := []struct {
		input string
		want  string
		ok    bool
	}{
		{input: "2026-11-20", want: "2026-11-20", ok: true},
		{input: "2026/11/20", want: "2026-11-20", ok: true},
		{input: "11-20", want: "2026-11-20", ok: true},
		{input: "11月20日", want: "2026-11-20", ok: true},
		{input: "今天", want: "2026-11-21", ok: true},
		{input: "昨天", want: "2026-11-20", ok: true},
		{input: "前天", want: "2026-11-19", ok: true},
		{input: "2026-13-01", ok: false},
		{input: "随便聊聊", ok: false},
	}

	for _, tc := range cases {
		t.Run(tc.input, func(t *testing.T) {
			got, ok := parseDateArg(tc.input, now)
			if ok != tc.ok {
				t.Fatalf("ok = %v, want %v", ok, tc.ok)
			}
			if got != tc.want {
				t.Errorf("date = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestFormatDailySummary(t *testing.T) {
	now := time.Date(2026, 11, 21, 10, 0, 0, 0, siteLoc)
	rec := &model.DailyRecommendation{
		Date:          model.DateOnly(time.Date(2026, 11, 20, 0, 0, 0, 0, siteLoc)),
		SongName:      "晴天",
		Artist:        "周杰伦",
		Comment:       "不应该出现在摘要里",
		LikeCount:     3,
		Submitter:     "alice",
		SubmitterInfo: model.JSONObject{"displayName": "爱丽丝"},
	}

	got := formatDailySummary(rec, now)
	for _, want := range []string{"**往期推荐 · 2026-11-20**", "《晴天》 - 周杰伦", "推荐人：@爱丽丝"} {
		if !strings.Contains(got, want) {
			t.Errorf("缺少 %q，实际输出：\n%s", want, got)
		}
	}
	for _, unexpected := range []string{"不应该出现在摘要里", "点赞", "查看详情"} {
		if strings.Contains(got, unexpected) {
			t.Errorf("不应包含 %q，实际输出：\n%s", unexpected, got)
		}
	}
	if caption := dailyCaption(rec); !strings.Contains(caption, "推荐人：@爱丽丝") {
		t.Errorf("dailyCaption = %q", caption)
	}
}

func TestFormatSearchResult(t *testing.T) {
	commit := time.Date(2026, 11, 20, 12, 34, 0, 0, siteLoc).UnixMilli()
	res := &service.SearchResult{
		TotalHits: 2,
		Hits: []service.SearchHitResult{{
			ID:         "song-1",
			MusicNames: []string{"晴天", "Sunny"},
			Artists:    []string{"周杰伦", "杨瑞代"},
			Albums:     []string{"叶惠美", "叶惠美 (Deluxe)"},
			PlatformIds: map[string][]string{
				"ncm":   {"186016", "186017"},
				"qq":    {"0039MnYb0qxYhV"},
				"kugou": {"abc123"},
			},
			RawLyricFile:          "晴天 - 周杰伦.ttml",
			LyricSnippet:          "故事的小黄花",
			WordCount:             320,
			LineCount:             42,
			CommitTimestamp:       &commit,
			TtmlAuthorGithubLogin: "alice",
			TtmlAuthorGithub:      "Alice",
		}},
	}

	got := formatSearchResult(res, "晴天", "https://beta.amllhub.bikonoo.com")
	for _, want := range []string{
		"**「晴天」共 2 条",
		"**1. 晴天 / Sunny**",
		"- 歌手：周杰伦 / 杨瑞代",
		"- 专辑：叶惠美 / 叶惠美 (Deluxe)",
		"- 平台：kugou:abc123 · ncm:186016 · ncm:186017 · qq:0039MnYb0qxYhV",
		"- 歌词：320 字 / 42 行",
		"- 作者：alice（Alice）",
		"- 提交时间：2026-11-20 12:34",
		"- 文件：晴天 - 周杰伦.ttml",
		"[查看歌词](https://beta.amllhub.bikonoo.com/lyric/",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("缺少 %q，实际输出：\n%s", want, got)
		}
	}
	if strings.Contains(got, "记录 ID") {
		t.Errorf("搜索结果不应包含记录 ID，实际输出：\n%s", got)
	}
	if strings.Contains(got, "故事的小黄花") {
		t.Errorf("搜索结果不应包含歌词片段，实际输出：\n%s", got)
	}
}

func TestFormatLatestWithCovers(t *testing.T) {
	items := []service.LatestSongItem{{
		Title:        "晴天",
		Artist:       "周杰伦",
		NcmID:        "186016",
		RawLyricFile: "晴天 - 周杰伦.ttml",
		CoverURL:     "https://cover.example.com/1.jpg",
	}}

	got, images := formatLatestWithCovers(items, "https://beta.amllhub.bikonoo.com")
	for _, want := range []string{
		"**最新收录（1 首）**",
		"**1. 晴天** - 周杰伦",
		"- NCM ID：186016",
		"[查看歌词](https://beta.amllhub.bikonoo.com/lyric/",
		"{{cover:0}}",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("缺少 %q，实际输出：\n%s", want, got)
		}
	}
	if strings.Contains(got, "/online-lyric/") {
		t.Errorf("最新收录不应再使用在线歌词链接：\n%s", got)
	}
	if len(images) != 1 || images[0].URL != "https://cover.example.com/1.jpg" {
		t.Fatalf("封面列表 = %#v", images)
	}
	if images[0].Caption != "1. 晴天 - 周杰伦" || images[0].Width != 600 {
		t.Errorf("封面信息 = %#v", images[0])
	}
}

func TestFormatRankingWithCovers(t *testing.T) {
	items := []service.RankingItem{
		{SongName: "晴天", Artists: []string{"周杰伦"}, RequestCount: 12, Cover: "https://cover.example.com/1.jpg"},
		{SongName: "夜曲", Artists: []string{"周杰伦"}, RequestCount: 5},
	}

	got, images := formatRankingWithCovers(123, items, "https://beta.amllhub.bikonoo.com")
	for _, want := range []string{
		"**无歌词排行榜（近 7 天）**",
		"共 123 条缺失记录",
		"1. **晴天** - 周杰伦 · 12 次",
		"2. **夜曲** - 周杰伦 · 5 次",
		"{{cover:0}}",
		"[查看完整榜单](https://beta.amllhub.bikonoo.com/ranking)",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("缺少 %q，实际输出：\n%s", want, got)
		}
	}
	if len(images) != 1 || images[0].URL != "https://cover.example.com/1.jpg" {
		t.Fatalf("封面列表 = %#v", images)
	}
}

func TestPlainFromMarkdown(t *testing.T) {
	got := plainFromMarkdown("**标题**\n![封面](https://example.com/cover.jpg)\n[查看歌词](https://example.com/lyric/a)")
	want := "标题\n封面：https://example.com/cover.jpg\n查看歌词：https://example.com/lyric/a"
	if got != want {
		t.Errorf("plainFromMarkdown = %q, want %q", got, want)
	}
}
