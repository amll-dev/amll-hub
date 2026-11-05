package service

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

var (
	qrcLineRe = regexp.MustCompile(`^\[(\d+),(\d+)\](.*)$`)
	qrcWordRe = regexp.MustCompile(`^(.*?)\((\d+),(\d+)\)`)
)

var lrcTagRe = regexp.MustCompile(`\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]`)

func BuildOnlineLyric(lrc, qrc, translation, romaji string) *OnlineLyric {
	lines := parseQRCLines(qrc)
	if len(lines) == 0 {
		lines = parseLRCLines(lrc)
		fillDurations(lines)
	}

	trans := parseLRCLines(translation)
	roma := parseLRCLines(romaji)
	fillDurations(trans)
	fillDurations(roma)

	if len(lines) == 0 && len(trans) == 0 && len(roma) == 0 {
		return nil
	}

	out := &OnlineLyric{
		Lines:        lines,
		Translation:  trans,
		Romanization: roma,
	}
	if len(lines) > 0 {
		out.Raw = firstNonEmptyText(qrc, lrc)
	}
	return out
}

func sanitizeLyricText(s string) string {
	if s == "" || !utf8.ValidString(s) {
		return ""
	}
	for _, r := range s {
		switch r {
		case '\n', '\r', '\t':
			continue
		}
		if r < 0x20 || r == 0x7f {
			return ""
		}
	}
	return s
}

func parseQRCLines(text string) []OnlineLyricLine {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}

	var out []OnlineLyricLine
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(strings.TrimSuffix(raw, "\r"))
		m := qrcLineRe.FindStringSubmatch(line)
		if m == nil {
			continue // 头部标签（[ti:] 等）或非法行
		}

		start, _ := strconv.ParseInt(m[1], 10, 64)
		dur, _ := strconv.ParseInt(m[2], 10, 64)

		rest := m[3]
		var (
			syllables []OnlineSyllable
			builder   strings.Builder
		)
		for {
			wm := qrcWordRe.FindStringSubmatch(rest)
			if wm == nil {
				break
			}
			if wm[1] != "" {
				st, _ := strconv.ParseInt(wm[2], 10, 64)
				d, _ := strconv.ParseInt(wm[3], 10, 64)
				syllables = append(syllables, OnlineSyllable{Time: st, Duration: d, Text: wm[1]})
				builder.WriteString(wm[1])
			}
			rest = rest[len(wm[0]):]
		}

		if len(syllables) == 0 {
			if t := strings.TrimSpace(rest); t != "" {
				builder.WriteString(t)
			}
		} else if t := rest; strings.TrimSpace(t) != "" {
			builder.WriteString(t)
			syllables = append(syllables, OnlineSyllable{
				Time:     lastEnd(syllables),
				Duration: 0,
				Text:     t,
			})
		}

		lineText := builder.String()
		if strings.TrimSpace(lineText) == "" {
			continue // 纯时间标记行（间奏/空行）
		}
		if dur <= 0 {
			dur = lastEnd(syllables) - start
		}
		if dur < 0 {
			dur = 0
		}

		out = append(out, OnlineLyricLine{
			Time:      start,
			Duration:  dur,
			Text:      lineText,
			Syllables: syllables,
		})
	}
	return out
}

func parseLRCLines(text string) []OnlineLyricLine {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}

	var out []OnlineLyricLine
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(strings.TrimSuffix(raw, "\r"))
		if line == "" {
			continue
		}
		tags := lrcTagRe.FindAllStringSubmatchIndex(line, -1)
		if len(tags) == 0 {
			continue
		}
		content := strings.TrimSpace(lrcTagRe.ReplaceAllString(line, ""))
		if content == "" {
			continue
		}

		for _, t := range tags {
			mm, _ := strconv.ParseInt(line[t[2]:t[3]], 10, 64)
			ss, _ := strconv.ParseInt(line[t[4]:t[5]], 10, 64)
			var ms int64
			if t[6] >= 0 {
				frac := line[t[6]:t[7]]
				v, _ := strconv.ParseInt(frac, 10, 64)
				switch len(frac) {
				case 1:
					v *= 100
				case 2:
					v *= 10
				}
				ms = v
			}
			out = append(out, OnlineLyricLine{
				Time: mm*60_000 + ss*1_000 + ms,
				Text: content,
			})
		}
	}

	sort.SliceStable(out, func(i, j int) bool { return out[i].Time < out[j].Time })
	return out
}

func fillDurations(lines []OnlineLyricLine) {
	for i := range lines {
		if lines[i].Duration > 0 {
			continue
		}
		if i+1 < len(lines) && lines[i+1].Time > lines[i].Time {
			lines[i].Duration = lines[i+1].Time - lines[i].Time
		}
	}
}

// lastEnd 返回最后一个逐字段的结束时间
func lastEnd(syllables []OnlineSyllable) int64 {
	if len(syllables) == 0 {
		return 0
	}
	last := syllables[len(syllables)-1]
	return last.Time + last.Duration
}

// firstNonEmptyText 返回第一个非空字符串
func firstNonEmptyText(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
