package service

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"

	ttml "github.com/xiaowumin-mark/amll-ttml"
)

// LyricViewWord 逐字歌词单元（毫秒）
type LyricViewWord struct {
	StartTime float64 `json:"startTime"`
	EndTime   float64 `json:"endTime"`
	Word      string  `json:"word"`
	RomanWord string  `json:"romanWord,omitempty"`
	EmptyBeat float64 `json:"emptyBeat,omitempty"`
}

// LyricViewLine 歌词查看页单行
type LyricViewLine struct {
	StartTime       float64         `json:"startTime"`
	EndTime         float64         `json:"endTime"`
	Text            string          `json:"text"`
	TranslatedLyric string          `json:"translatedLyric,omitempty"`
	RomanLyric      string          `json:"romanLyric,omitempty"`
	IsBG            bool            `json:"isBg"`
	IsDuet          bool            `json:"isDuet"`
	Key             string          `json:"key,omitempty"`
	Words           []LyricViewWord `json:"words,omitempty"`
}

// LyricViewResponse 歌词查看页响应
type LyricViewResponse struct {
	Metadata map[string][]string `json:"metadata"`
	Lines    []LyricViewLine     `json:"lines"`
}

// toViewResponse 将 amll-ttml 解析结果转为前端友好的响应结构
func toViewResponse(parsed ttml.TTMLLyric, lineKeys []string) *LyricViewResponse {
	resp := &LyricViewResponse{
		Metadata: make(map[string][]string),
		Lines:    make([]LyricViewLine, 0, len(parsed.LyricLines)),
	}
	for _, m := range parsed.Metadata {
		resp.Metadata[m.Key] = append(resp.Metadata[m.Key], m.Value...)
	}
	keyIdx := 0
	currentKey := ""
	for _, line := range parsed.LyricLines {
		if !line.IsBG {
			currentKey = ""
			if keyIdx < len(lineKeys) {
				currentKey = lineKeys[keyIdx]
			}
			keyIdx++
		}
		var text strings.Builder
		// 逐字透传
		words := make([]LyricViewWord, 0, len(line.Words))
		for _, w := range line.Words {
			text.WriteString(w.Word)
			words = append(words, LyricViewWord{
				StartTime: w.StartTime,
				EndTime:   w.EndTime,
				Word:      w.Word,
				RomanWord: w.RomanWord,
				EmptyBeat: w.EmptyBeat,
			})
		}
		resp.Lines = append(resp.Lines, LyricViewLine{
			StartTime:       line.StartTime,
			EndTime:         line.EndTime,
			Text:            text.String(),
			TranslatedLyric: line.TranslatedLyric,
			RomanLyric:      line.RomanLyric,
			IsBG:            line.IsBG,
			IsDuet:          line.IsDuet,
			Key:             currentKey,
			Words:           words,
		})
	}
	return resp
}

// itunesKeyNamespace 是 amll-ttml 识别的 itunes:key 属性命名空间。
// 未声明 xmlns 的 TTML 里，encoding/xml 会把前缀字面量 "itunes" 留在 Name.Space。
const itunesKeyNamespace = "http://itunes.apple.com/lyric-ttml-internal"

// extractTTMLLineKeys 按顺序提取 body 内每个带时间轴的【主歌词行】的 itunes:key。
// 判定口径必须与 toViewResponse 对齐：后者只对非 BG 行推进 keyIdx，因此这里
// 要跳过无 begin/end 的节点和 x-bg 背景行，否则从该行起 Key 锚点会整体错位。
func extractTTMLLineKeys(ttmlText string) []string {
	decoder := xml.NewDecoder(strings.NewReader(ttmlText))
	keys := make([]string, 0)
	inBody := false
	for {
		tok, err := decoder.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "body":
				inBody = true
			case "p":
				if !inBody {
					continue
				}
				var key string
				hasBegin, hasEnd, isBG := false, false, false
				for _, attr := range t.Attr {
					switch {
					case attr.Name.Local == "begin":
						hasBegin = true
					case attr.Name.Local == "end":
						hasEnd = true
					case attr.Name.Local == "role" && strings.Contains(attr.Value, "x-bg"):
						isBG = true
					// amll-ttml 只认 itunes:key；无前缀/无命名空间的 key 不当作行锚点
					case attr.Name.Local == "key" &&
						(attr.Name.Space == "itunes" || attr.Name.Space == itunesKeyNamespace):
						key = strings.TrimSpace(attr.Value)
					}
				}
				if hasBegin && hasEnd && !isBG {
					keys = append(keys, key)
				}
			}
		case xml.EndElement:
			if t.Name.Local == "body" {
				inBody = false
			}
		}
	}
	return keys
}

// parseTTML 解析 TTML
func parseTTML(ttmlText string) (ttml.TTMLLyric, error) {
	return ttml.ParseLyric(dedupeTransliterations(ttmlText))
}

// ExtractTTMLAuthorGithubID 从 TTML 元数据中提取歌词作者 GitHub 数字 ID
func ExtractTTMLAuthorGithubID(content []byte) (int64, bool) {
	parsed, err := parseTTML(string(content))
	if err != nil {
		return 0, false
	}
	for _, meta := range parsed.Metadata {
		if meta.Key != "ttmlAuthorGithub" {
			continue
		}
		for _, value := range meta.Value {
			id, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
			if err == nil && id > 0 {
				return id, true
			}
		}
	}
	return 0, false
}

// MaxViewLyricBytes 查看歌词时允许读入的最大字节数。
// 5,000 行的 TTML 约 2MB，10MB 已经非常宽松；超过就是异常数据，
// 应明确报错而不是截断后伪装成 XML 格式错误。
const MaxViewLyricBytes = 10 << 20

// ErrLyricTooLarge 歌词文件超过查看上限。
// 单独用 sentinel 与「解析失败」区分，handler 才能返回 400 而不是笼统的 500。
var ErrLyricTooLarge = errors.New("lyric file too large")

// ViewLyric 解析 raw-lyrics 下的 TTML 文件为结构化歌词数据，
// 供搜索页「查看歌词」使用。
func (s *LyricsService) ViewLyric(ctx context.Context, filename string) (*LyricViewResponse, error) {
	resolved, err := s.ResolveLyric(ctx, "raw-lyrics", filename)
	if err != nil {
		return nil, err
	}

	var content []byte
	err = s.StreamLyric(ctx, resolved.MinioPath, func(reader io.Reader) error {
		// 用 ReadTTMLLimited 而不是 io.Copy + LimitReader：后者会把超过上限的
		// 文件静默切成半截，XML 解析器随后报 "unexpected EOF"，用户看到的是
		// 「解析失败」这种无法归因的错误。真超限就该明确提示文件过大。
		data, err := ReadTTMLLimited(reader, MaxViewLyricBytes)
		if err != nil {
			// ReadTTMLLimited 对超限返回 ErrInvalidInput，转成专用 sentinel 交给 handler 映射 400
			if errors.Is(err, ErrInvalidInput) {
				return fmt.Errorf("%w: 歌词文件超过 %dMB 上限", ErrLyricTooLarge, MaxViewLyricBytes>>20)
			}
			return err
		}
		content = data
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("read lyric content: %w", err)
	}

	parsed, err := parseTTML(string(content))
	if err != nil {
		return nil, fmt.Errorf("parse ttml: %w", err)
	}
	return toViewResponse(parsed, extractTTMLLineKeys(string(content))), nil
}

// ParseLyric 解析任意 TTML 文本为结构化歌词数据，
func (s *LyricsService) ParseLyric(ctx context.Context, ttmlText string) (*LyricViewResponse, error) {
	parsed, err := parseTTML(ttmlText)
	if err != nil {
		return nil, fmt.Errorf("parse ttml: %w", err)
	}
	return toViewResponse(parsed, extractTTMLLineKeys(ttmlText)), nil
}
