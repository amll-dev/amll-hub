package mail

import (
	"bytes"
	"embed"
	"fmt"
	"html/template"
	"strings"
	texttemplate "text/template"
	"time"
)

//go:embed templates/*.html templates/*.txt
var templateFS embed.FS

// Renderer 模板渲染器
type Renderer struct {
	htmlTmpl *template.Template
	textTmpl *texttemplate.Template
}

// NewRenderer 解析内嵌模板
func NewRenderer() (*Renderer, error) {
	htmlTmpl, err := template.ParseFS(templateFS, "templates/*.html")
	if err != nil {
		return nil, fmt.Errorf("parse html templates: %w", err)
	}
	textTmpl, err := texttemplate.ParseFS(templateFS, "templates/*.txt")
	if err != nil {
		return nil, fmt.Errorf("parse text templates: %w", err)
	}
	return &Renderer{htmlTmpl: htmlTmpl, textTmpl: textTmpl}, nil
}

// ReviewResultParams 审核结果邮件的数据
type ReviewResultParams struct {
	DisplayName  string // 收件人昵称
	Username     string
	Title        string // 稿件标题
	Artist       string // 艺术家
	SubmissionID int64
	Result       string // approved / rejected / need_revision / missing_audio / closed
	ResultLabel  string // 「已通过」等中文标签
	Subject      string
	Headline     string // 正文大标题
	Lead         string // 开场白
	Tip          string // 后续动作提示
	Preheader    string // 收件箱预览文本
	Comment      string // 审核意见
	ReviewedAt   string
	DetailURL    string
	SiteURL      string
	LogoURL      string
	Accent       string // 结果主色
	BadgeBG      string
	BadgeFG      string
	ButtonText   string
	Year         int
}

// resultStyle 各审核结果的文案与配色
type resultStyle struct {
	Label     string
	Headline  string
	Lead      string
	Tip       string
	Preheader string
	Button    string
	Accent    string
	BadgeBG   string
	BadgeFG   string
}

var resultStyles = map[string]resultStyle{
	"approved": {
		Label:     "审核通过",
		Headline:  "你的投稿已通过审核",
		Lead:      "你提交的歌词已通过审核并成功收录，感谢你的贡献！",
		Tip:       "歌词已收录，稍后即可在 AMLL Hub 中检索到。若发现信息有误，可在详情页更新后重新提交。",
		Preheader: "歌词已通过审核并收录，详情见邮件。",
		Button:    "查看稿件详情",
		Accent:    "#1a9e5e",
		BadgeBG:   "#e8f6ef",
		BadgeFG:   "#1a9e5e",
	},
	"rejected": {
		Label:     "未通过",
		Headline:  "你的投稿未通过审核",
		Lead:      "很遗憾，你提交的歌词未通过本次审核。",
		Tip:       "你可以根据审核意见修改后重新投稿；如有疑问可在稿件详情页留言与审核员沟通。",
		Preheader: "稿件未通过审核，审核意见见邮件正文。",
		Button:    "查看审核意见",
		Accent:    "#d12d2d",
		BadgeBG:   "#fbeaea",
		BadgeFG:   "#d12d2d",
	},
	"need_revision": {
		Label:     "需要修改",
		Headline:  "你的投稿需要修改",
		Lead:      "你提交的歌词需要按审核意见修改后重新提交。",
		Tip:       "修改完成后在详情页重新提交即可进入下一轮审核，超时未处理稿件会被自动关闭。",
		Preheader: "稿件需要修改，请按审核意见调整后重新提交。",
		Button:    "前往修改",
		Accent:    "#c97a0e",
		BadgeBG:   "#fdf3e3",
		BadgeFG:   "#c97a0e",
	},
	"missing_audio": {
		Label:     "缺少音频",
		Headline:  "你的投稿缺少音频文件",
		Lead:      "你提交的歌词缺少配套音频文件，暂时无法完成审核。",
		Tip:       "请在详情页上传对应音频后重新提交，超时未处理稿件会被自动关闭。",
		Preheader: "稿件缺少音频文件，请补充后重新提交。",
		Button:    "前往补充音频",
		Accent:    "#c97a0e",
		BadgeBG:   "#fdf3e3",
		BadgeFG:   "#c97a0e",
	},
	// revised：审核员已改好，等投稿者确认。
	"revised": {
		Label:     "待确认",
		Headline:  "审核员已提交修订版歌词",
		Lead:      "你的投稿已完成审核修订，审核员提交了一版修订歌词。",
		Tip:       "请在详情页查看修订内容与审核报告，确认后即可直接采用；如需保留原版可以选择不采用。",
		Preheader: "歌词修订版已提交，请确认是否采用。",
		Button:    "查看并确认",
		Accent:    "#7c4dbe",
		BadgeBG:   "#f1ebfa",
		BadgeFG:   "#7c4dbe",
	},
	"closed": {
		Label:     "已关闭",
		Headline:  "你的投稿已超时关闭",
		Lead:      "你提交的歌词超过处理时限，已自动关闭。",
		Tip:       "如仍需投稿，请重新提交一份新的稿件。",
		Preheader: "稿件超过处理时限已自动关闭。",
		Button:    "查看稿件详情",
		Accent:    "#8a8a90",
		BadgeBG:   "#f2f2f4",
		BadgeFG:   "#535359",
	},
}

// fallbackStyle 未知结果时的兜底样式
var fallbackStyle = resultStyle{
	Label:     "审核结果更新",
	Headline:  "你的投稿有新的审核结果",
	Lead:      "你提交的歌词审核状态已更新。",
	Tip:       "可在详情页查看完整审核记录。",
	Preheader: "投稿审核状态已更新，详情见邮件。",
	Button:    "查看稿件详情",
	Accent:    "#e0303f",
	BadgeBG:   "#fbe7e9",
	BadgeFG:   "#e0303f",
}

const (
	subjectPrefix = "【AMLL Hub】"
	commentMax    = 1000 // 审核意见在邮件里的最长字符数
)

// RenderReviewResult 渲染审核结果邮件
func (r *Renderer) RenderReviewResult(p ReviewResultParams) (string, string, string, error) {
	st, ok := resultStyles[p.Result]
	if !ok {
		st = fallbackStyle
	}
	p.ResultLabel = firstNonEmpty(p.ResultLabel, st.Label)
	p.Headline = firstNonEmpty(p.Headline, st.Headline)
	p.Lead = firstNonEmpty(p.Lead, st.Lead)
	p.Tip = firstNonEmpty(p.Tip, st.Tip)
	p.Preheader = firstNonEmpty(p.Preheader, st.Preheader)
	p.ButtonText = firstNonEmpty(p.ButtonText, st.Button)
	p.Accent = st.Accent
	p.BadgeBG = st.BadgeBG
	p.BadgeFG = st.BadgeFG
	if p.DisplayName == "" {
		p.DisplayName = p.Username
	}
	if p.Year == 0 {
		p.Year = time.Now().Year()
	}
	if p.LogoURL == "" && p.SiteURL != "" {
		p.LogoURL = p.SiteURL + "/logo.png"
	}
	p.Comment = truncateRunes(strings.TrimSpace(p.Comment), commentMax)
	if p.Subject == "" {
		p.Subject = subjectPrefix + "投稿《" + p.Title + "》" + p.ResultLabel
	}

	var htmlBuf, textBuf bytes.Buffer
	if err := r.htmlTmpl.ExecuteTemplate(&htmlBuf, "review_result.html", p); err != nil {
		return "", "", "", fmt.Errorf("render html: %w", err)
	}
	if err := r.textTmpl.ExecuteTemplate(&textBuf, "review_result.txt", p); err != nil {
		return "", "", "", fmt.Errorf("render text: %w", err)
	}
	return p.Subject, htmlBuf.String(), textBuf.String(), nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// truncateRunes 按 rune 截断，超出部分加省略号
func truncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}
