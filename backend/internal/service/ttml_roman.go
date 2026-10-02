package service

import (
	"encoding/xml"
	"regexp"
	"strings"

	ttml "github.com/xiaowumin-mark/amll-ttml"
)

var (
	transliterationsRe = regexp.MustCompile(`(?s)<transliterations\b[^>]*>.*?</transliterations>`)
	translitTextRe     = regexp.MustCompile(`(?s)<text\b([^>]*)>(.*?)</text>`)
	translitForRe      = regexp.MustCompile(`\bfor="([^"]*)"`)
	bodySpanBeginRe    = regexp.MustCompile(`<span\b[^>]*\bbegin="([^"]*)"`)
)

// romanSpan 逐字音译片段，保留原始时间字符串，避免二次格式化引入误差
type romanSpan struct {
	begin string
	end   string
	text  string
}

// romanBlock <transliterations> 下单个 <text for="..."> 候选
type romanBlock struct {
	key   string
	raw   string
	spans []romanSpan
}

func dedupeTransliterations(doc string) string {
	region := transliterationsRe.FindStringIndex(doc)
	if region == nil {
		return doc
	}
	block := doc[region[0]:region[1]]

	blocks := parseRomanBlocks(block)
	if len(blocks) == 0 {
		return doc
	}

	keyCount := make(map[string]int, len(blocks))
	for _, b := range blocks {
		keyCount[b.key]++
	}
	duplicated := false
	for _, c := range keyCount {
		if c > 1 {
			duplicated = true
			break
		}
	}
	if !duplicated {
		return doc
	}

	bodyTimes := bodySpanTimes(doc)

	best := make(map[string]romanBlock, len(blocks))
	bestScore := make(map[string]int, len(blocks))
	for _, b := range blocks {
		score := b.matchScore(bodyTimes)
		if s, ok := bestScore[b.key]; !ok || score > s {
			bestScore[b.key] = score
			best[b.key] = b
		}
	}

	// 解析器按 iTunesMetadata > transliterations > transliteration > text 路径查找，
	// 重建时必须保留 <transliteration> 这层包裹
	var kept strings.Builder
	seen := make(map[string]bool, len(blocks))
	for _, b := range blocks {
		if seen[b.key] {
			continue
		}
		seen[b.key] = true
		kept.WriteString("<transliteration>")
		kept.WriteString(best[b.key].raw)
		kept.WriteString("</transliteration>")
	}

	return doc[:region[0]] + "<transliterations>" + kept.String() + "</transliterations>" + doc[region[1]:]
}

// parseRomanBlocks 抽出 <transliterations> 下的全部 <text for="..."> 候选
func parseRomanBlocks(region string) []romanBlock {
	matches := translitTextRe.FindAllStringSubmatchIndex(region, -1)
	blocks := make([]romanBlock, 0, len(matches))
	for _, m := range matches {
		raw := region[m[0]:m[1]]
		attrs := region[m[2]:m[3]]
		inner := region[m[4]:m[5]]
		key := translitForRe.FindStringSubmatch(attrs)
		if key == nil || key[1] == "" {
			continue
		}
		blocks = append(blocks, romanBlock{
			key:   key[1],
			raw:   raw,
			spans: parseRomanSpans(inner),
		})
	}
	return blocks
}

// parseRomanSpans 取出候选内所有带时间的 span 文本
func parseRomanSpans(inner string) []romanSpan {
	if !strings.Contains(inner, "<span") {
		return nil
	}
	decoder := xml.NewDecoder(strings.NewReader("<x>" + inner + "</x>"))
	var (
		spans   []romanSpan
		cur     *romanSpan
		content strings.Builder
	)
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch t := token.(type) {
		case xml.StartElement:
			if t.Name.Local == "span" {
				begin, end := "", ""
				for _, attr := range t.Attr {
					switch attr.Name.Local {
					case "begin":
						begin = attr.Value
					case "end":
						end = attr.Value
					}
				}
				if begin != "" && end != "" {
					cur = &romanSpan{begin: begin, end: end}
					content.Reset()
				}
			}
		case xml.CharData:
			if cur != nil {
				content.Write(t)
			}
		case xml.EndElement:
			if t.Name.Local == "span" && cur != nil {
				cur.text = content.String()
				spans = append(spans, *cur)
				cur = nil
				content.Reset()
			}
		}
	}
	return spans
}

// matchScore 统计候选中有多少逐字起始时间能在正文里找到对应
func (b romanBlock) matchScore(bodyTimes map[float64]bool) int {
	score := 0
	for _, s := range b.spans {
		if begin, err := ttml.ParseTimespan(s.begin); err == nil && bodyTimes[begin] {
			score++
		}
	}
	return score
}

// bodySpanTimes 正文（body）中出现过的所有逐字起始时间
func bodySpanTimes(doc string) map[float64]bool {
	times := make(map[float64]bool)
	body := doc
	if idx := strings.Index(doc, "<body"); idx >= 0 {
		body = doc[idx:]
	}
	for _, m := range bodySpanBeginRe.FindAllStringSubmatch(body, -1) {
		if ms, err := ttml.ParseTimespan(m[1]); err == nil {
			times[ms] = true
		}
	}
	return times
}
