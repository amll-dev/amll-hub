package service

import (
	"bytes"
	stdhtml "html"
	"regexp"
	"strings"

	"github.com/microcosm-cc/bluemonday"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/renderer/html"
)

// 公告正文的 Markdown 渲染
var (
	announcementMarkdown = goldmark.New(
		goldmark.WithExtensions(extension.GFM),
		// 与前端 marked 的 breaks:true 对齐：单个换行即换行
		goldmark.WithRendererOptions(html.WithHardWraps()),
	)
	announcementSanitizer = bluemonday.UGCPolicy()

	htmlBlockEndRe = regexp.MustCompile(`(?i)</(p|div|li|h[1-6]|blockquote|tr|pre)>`)
	htmlBrRe       = regexp.MustCompile(`(?i)<br\s*/?>`)
	htmlTagRe      = regexp.MustCompile(`<[^>]*>`)
	htmlBlankRe    = regexp.MustCompile(`\n{3,}`)
)

// renderAnnouncementHTML 把 Markdown 渲染成邮件正文 HTML
func renderAnnouncementHTML(markdown string) string {
	if strings.TrimSpace(markdown) == "" {
		return ""
	}
	var buf bytes.Buffer
	if err := announcementMarkdown.Convert([]byte(markdown), &buf); err != nil {
		return "<p>" + stdhtml.EscapeString(markdown) + "</p>"
	}
	return announcementSanitizer.Sanitize(buf.String())
}

// announcementPlainText 取纯文本版正文，供站内信展示 / 邮件 text/plain 部分。
// 块级元素结束补换行，保留原来的分段结构。
func announcementPlainText(markdown string) string {
	htmlBody := renderAnnouncementHTML(markdown)
	if htmlBody == "" {
		return ""
	}
	s := htmlBlockEndRe.ReplaceAllString(htmlBody, "\n")
	s = htmlBrRe.ReplaceAllString(s, "\n")
	s = htmlTagRe.ReplaceAllString(s, "")
	s = stdhtml.UnescapeString(s)
	s = htmlBlankRe.ReplaceAllString(s, "\n\n")
	return strings.TrimSpace(s)
}
