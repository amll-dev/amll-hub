package service

import (
	"context"
	"fmt"
	"io"
	"strings"

	ttml "github.com/xiaowumin-mark/amll-ttml"
)

// LyricViewLine 歌词查看页单行
type LyricViewLine struct {
	StartTime       float64 `json:"startTime"`
	EndTime         float64 `json:"endTime"`
	Text            string  `json:"text"`
	TranslatedLyric string  `json:"translatedLyric,omitempty"`
	RomanLyric      string  `json:"romanLyric,omitempty"`
	IsBG            bool    `json:"isBg"`
	IsDuet          bool    `json:"isDuet"`
}

// LyricViewResponse 歌词查看页响应
type LyricViewResponse struct {
	Metadata map[string][]string `json:"metadata"`
	Lines    []LyricViewLine     `json:"lines"`
}

// toViewResponse 将 amll-ttml 解析结果转为前端友好的响应结构
func toViewResponse(parsed ttml.TTMLLyric) *LyricViewResponse {
	resp := &LyricViewResponse{
		Metadata: make(map[string][]string),
		Lines:    make([]LyricViewLine, 0, len(parsed.LyricLines)),
	}
	for _, m := range parsed.Metadata {
		resp.Metadata[m.Key] = append(resp.Metadata[m.Key], m.Value...)
	}
	for _, line := range parsed.LyricLines {
		var text strings.Builder
		for _, w := range line.Words {
			text.WriteString(w.Word)
		}
		resp.Lines = append(resp.Lines, LyricViewLine{
			StartTime:       line.StartTime,
			EndTime:         line.EndTime,
			Text:            text.String(),
			TranslatedLyric: line.TranslatedLyric,
			RomanLyric:      line.RomanLyric,
			IsBG:            line.IsBG,
			IsDuet:          line.IsDuet,
		})
	}
	return resp
}

// ViewLyric 解析 raw-lyrics 下的 TTML 文件为结构化歌词数据，
// 供搜索页「查看歌词」使用。
func (s *LyricsService) ViewLyric(ctx context.Context, filename string) (*LyricViewResponse, error) {
	resolved, err := s.ResolveLyric(ctx, "raw-lyrics", filename)
	if err != nil {
		return nil, err
	}

	var content strings.Builder
	err = s.StreamLyric(ctx, resolved.MinioPath, func(reader io.Reader) error {
		_, err := io.Copy(&content, io.LimitReader(reader, 10*1024*1024))
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("read lyric content: %w", err)
	}

	parsed, err := ttml.ParseLyric(content.String())
	if err != nil {
		return nil, fmt.Errorf("parse ttml: %w", err)
	}
	return toViewResponse(parsed), nil
}

// ParseLyric 解析任意 TTML 文本为结构化歌词数据，
func (s *LyricsService) ParseLyric(ctx context.Context, ttmlText string) (*LyricViewResponse, error) {
	parsed, err := ttml.ParseLyric(ttmlText)
	if err != nil {
		return nil, fmt.Errorf("parse ttml: %w", err)
	}
	return toViewResponse(parsed), nil
}
