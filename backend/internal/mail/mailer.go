// Package mail 站内事件的邮件通知
package mail

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"html"
	"mime"
	"mime/multipart"
	"net"
	"net/smtp"
	"net/textproto"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/config"
)

// defaultBatchChunkSize 单个 SMTP 连接默认最多投递的封数。
// 服务商对「一条连接能发多少封 / 能活多久」普遍有软限制，超限后直接断连，
// 所以批量发送时按这个数量主动 Quit 后重连继续。
const defaultBatchChunkSize = 50

// BatchChunkSize 单连接投递上限，可按服务商策略调整；<= 0 时使用默认值。
var BatchChunkSize = defaultBatchChunkSize

// Sender 邮件发送器（无状态，可并发使用）
type Sender struct {
	cfg      config.EmailConfig
	renderer *Renderer
}

// NewSender 创建发送器；模板解析失败直接返回错误
func NewSender(cfg config.EmailConfig) (*Sender, error) {
	r, err := NewRenderer()
	if err != nil {
		return nil, err
	}
	return &Sender{cfg: cfg, renderer: r}, nil
}

// Enabled 总开关
func (s *Sender) Enabled() bool {
	return s != nil && s.cfg.Enabled && s.cfg.Host != "" && s.cfg.From != ""
}

// Timeout 单次发送超时
func (s *Sender) Timeout() time.Duration {
	if s.cfg.TimeoutSec <= 0 {
		return 15 * time.Second
	}
	return time.Duration(s.cfg.TimeoutSec) * time.Second
}

// RenderReviewResult 渲染审核结果邮件
func (s *Sender) RenderReviewResult(p ReviewResultParams) (subject, html, text string, err error) {
	return s.renderer.RenderReviewResult(p)
}

// RenderPetition 渲染歌词请愿通知邮件
func (s *Sender) RenderPetition(p PetitionParams) (subject, html, text string, err error) {
	return s.renderer.RenderPetition(p)
}

// RenderAnnouncement 渲染系统公告邮件
func (s *Sender) RenderAnnouncement(p AnnouncementParams) (subject, html, text string, err error) {
	return s.renderer.RenderAnnouncement(p)
}

// Send 发送一封邮件
func (s *Sender) Send(ctx context.Context, to, subject, htmlBody, textBody string) error {
	if !s.Enabled() {
		return fmt.Errorf("mail disabled")
	}

	c, err := s.dial(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = c.Quit() }()

	if err := s.auth(c); err != nil {
		return err
	}
	return s.sendOne(c, to, subject, htmlBody, textBody)
}

// SendBatch 把同一封邮件发给多个收件人，连接按批次复用，避免逐封重建 TCP/TLS/AUTH 握手。
//
// 每封投递前用 RSET 复位上一封的会话状态；单条连接最多投递 BatchChunkSize 封，
// 达到上限后主动 Quit 并在下一封重新建连，避免单连接过长被服务商掐断。
// 单个收件人被拒（RCPT 5xx）只影响本人；连接级失败（MAIL/DATA/写失败、
// RSET 失败、连接被断）会重连一次并重发当前封，仍失败才按该错误回调，
// 剩余收件人同样以该错误回调，函数随后返回该错误。
// onResult 按 recipients 下标回调逐封结果（err == nil 表示投递成功）。
func (s *Sender) SendBatch(
	ctx context.Context, recipients []string, subject, htmlBody, textBody string,
	onResult func(index int, err error),
) error {
	if !s.Enabled() {
		return fmt.Errorf("mail disabled")
	}
	if len(recipients) == 0 {
		return nil
	}

	// 连接级失败时把当前及剩余收件人都以同一错误回调
	reportFrom := func(from int, err error) {
		if onResult == nil {
			return
		}
		for j := from; j < len(recipients); j++ {
			onResult(j, err)
		}
	}

	batch := BatchChunkSize
	if batch <= 0 {
		batch = defaultBatchChunkSize
	}

	var c *smtp.Client
	// sentOnConn 当前连接已投递的封数（含被收件人自身拒绝的，同样消耗了连接）
	sentOnConn := 0
	closeConn := func() {
		if c != nil {
			_ = c.Quit()
			c = nil
		}
		sentOnConn = 0
	}
	defer closeConn()

	connect := func() error {
		nc, err := s.dial(ctx)
		if err != nil {
			return err
		}
		if err := s.auth(nc); err != nil {
			_ = nc.Quit()
			return err
		}
		c = nc
		sentOnConn = 0
		return nil
	}

	for i, to := range recipients {
		var sendErr error
		// 最多两轮：首轮失败且判定为连接级问题 → 重连后重发当前封，
		// 保证单封的连接抖动不会让整批剩下的收件人全部丢失。
		for attempt := 0; attempt < 2; attempt++ {
			if c == nil {
				if err := connect(); err != nil {
					sendErr = fmt.Errorf("smtp connect: %w", err)
					reportFrom(i, sendErr)
					return sendErr
				}
			} else if sentOnConn > 0 {
				// 同一连接内的后续邮件先用 RSET 复位上一封留下的 MAIL/RCPT 状态
				// （含 RCPT 被拒的情况）；失败说明连接已不可用，交给下一轮重连。
				if err := c.Reset(); err != nil {
					closeConn()
					sendErr = fmt.Errorf("smtp reset: %w", err)
					continue
				}
			}

			sendErr = s.sendOne(c, to, subject, htmlBody, textBody)
			if sendErr == nil {
				break
			}
			var rejected *rcptRejectedError
			if errors.As(sendErr, &rejected) {
				// 收件人自身被拒：连接仍可用，不重连也不重发
				break
			}
			closeConn()
		}

		if onResult != nil {
			onResult(i, sendErr)
		}
		if c != nil {
			sentOnConn++
			if sentOnConn >= batch {
				// 达到单连接上限：主动结束，下一封重新建连继续
				closeConn()
			}
		}
	}
	return nil
}

// SendPlain 发送一封纯文本邮件（HTML 部分用等宽 <pre> 呈现同一份文本），
// 供不需要 HTML 模板的内部通知使用。
func (s *Sender) SendPlain(ctx context.Context, to, subject, textBody string) error {
	escaped := html.EscapeString(textBody)
	htmlBody := `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">` + escaped + `</pre>`
	return s.Send(ctx, to, subject, htmlBody, textBody)
}

// auth 按配置完成 SMTP 认证（未配置用户名时跳过）
func (s *Sender) auth(c *smtp.Client) error {
	if s.cfg.Username == "" {
		return nil
	}
	auth := smtp.PlainAuth("", s.cfg.Username, s.cfg.Password, s.cfg.Host)
	if err := c.Auth(auth); err != nil {
		return fmt.Errorf("smtp auth: %w", err)
	}
	return nil
}

// sendOne 在已建立的连接上投递一封邮件
func (s *Sender) sendOne(c *smtp.Client, to, subject, htmlBody, textBody string) error {
	// 收件人地址当前经 Casdoor 校验，实际不可能带换行；但 mailer 是底层组件，
	// 不能把「调用方一定会过滤」当成前提：
	//   - RCPT TO:<...> 里混入 \r\n 等于在 SMTP 会话里插命令；
	//   - To: 头里混入 \r\n 就是标准的邮件头注入（可在其后追加任意头）。
	// 统一在最靠近协议的位置剔除 CR/LF。
	to = stripCRLF(to)
	msg, err := s.buildMessage(to, subject, htmlBody, textBody)
	if err != nil {
		return err
	}
	if err := c.Mail(s.cfg.From); err != nil {
		return fmt.Errorf("smtp mail from: %w", err)
	}
	if err := c.Rcpt(to); err != nil {
		// 收件人本身被拒（不存在 / 拒收），连接仍然可用
		return &rcptRejectedError{err: fmt.Errorf("smtp rcpt: %w", err)}
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp close: %w", err)
	}
	return nil
}

// rcptRejectedError 标记「收件人被拒」：只有该收件人失败，连接无需重连。
type rcptRejectedError struct{ err error }

func (e *rcptRejectedError) Error() string { return e.err.Error() }
func (e *rcptRejectedError) Unwrap() error { return e.err }

// dial 建立 SMTP 连接：465 走隐式 TLS，其余端口先明文再 STARTTLS
func (s *Sender) dial(ctx context.Context) (*smtp.Client, error) {
	addr := net.JoinHostPort(s.cfg.Host, fmt.Sprintf("%d", s.cfg.Port))
	timeout := s.Timeout()
	tlsCfg := &tls.Config{ServerName: s.cfg.Host, MinVersion: tls.VersionTLS12}

	dialer := &net.Dialer{Timeout: timeout}

	if s.cfg.Port == 465 {
		conn, err := dialer.DialContext(ctx, "tcp", addr)
		if err != nil {
			return nil, fmt.Errorf("dial smtp: %w", err)
		}
		tlsConn := tls.Client(conn, tlsCfg)
		connctx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		if err := tlsConn.HandshakeContext(connctx); err != nil {
			_ = conn.Close()
			return nil, fmt.Errorf("smtp tls handshake: %w", err)
		}
		return smtp.NewClient(tlsConn, s.cfg.Host)
	}

	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("dial smtp: %w", err)
	}
	c, err := smtp.NewClient(conn, s.cfg.Host)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("smtp client: %w", err)
	}
	if ok, _ := c.Extension("STARTTLS"); ok {
		if err := c.StartTLS(tlsCfg); err != nil {
			_ = c.Close()
			return nil, fmt.Errorf("smtp starttls: %w", err)
		}
	}
	return c, nil
}

// buildMessage 组装 multipart/alternative 邮件
func (s *Sender) buildMessage(to, subject, htmlBody, textBody string) ([]byte, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)

	// 纯文本
	th := make(textproto.MIMEHeader)
	th.Set("Content-Type", "text/plain; charset=UTF-8")
	th.Set("Content-Transfer-Encoding", "base64")
	tw, err := w.CreatePart(th)
	if err != nil {
		return nil, err
	}
	tw.Write([]byte(base64Chunk(textBody)))

	// HTML
	hh := make(textproto.MIMEHeader)
	hh.Set("Content-Type", "text/html; charset=UTF-8")
	hh.Set("Content-Transfer-Encoding", "base64")
	hw, err := w.CreatePart(hh)
	if err != nil {
		return nil, err
	}
	hw.Write([]byte(base64Chunk(htmlBody)))

	if err := w.Close(); err != nil {
		return nil, err
	}

	fromName := s.cfg.FromName
	if fromName == "" {
		fromName = "AMLL Hub"
	}
	var out bytes.Buffer
	fmt.Fprintf(&out, "From: %s\r\n", encodeAddress(s.cfg.From, fromName))
	fmt.Fprintf(&out, "To: %s\r\n", to)
	fmt.Fprintf(&out, "Subject: %s\r\n", encodeHeader(subject))
	fmt.Fprintf(&out, "Date: %s\r\n", time.Now().Format(time.RFC1123Z))
	fmt.Fprintf(&out, "Message-ID: <%d.amll-hub@%s>\r\n", time.Now().UnixNano(), s.cfg.Host)
	fmt.Fprintf(&out, "Auto-Submitted: auto-generated\r\n")
	fmt.Fprintf(&out, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(&out, "Content-Type: multipart/alternative; boundary=%q\r\n", w.Boundary())
	out.WriteString("\r\n")
	out.Write(buf.Bytes())
	return out.Bytes(), nil
}

// stripCRLF 剔除 CR/LF，防止地址进入 SMTP 命令或邮件头时造成注入
func stripCRLF(s string) string {
	return strings.NewReplacer("\r", "", "\n", "").Replace(s)
}

// encodeHeader RFC2047 编码
func encodeHeader(s string) string {
	if s == "" {
		return ""
	}
	return mime.BEncoding.Encode("utf-8", s)
}

// encodeAddress 发件人带中文显示名时同样需要编码
func encodeAddress(addr, name string) string {
	if name == "" {
		return addr
	}
	return fmt.Sprintf("%s <%s>", mime.BEncoding.Encode("utf-8", name), addr)
}

// base64Chunk 每 76 字符换行，符合 MIME 行长度限制
func base64Chunk(s string) string {
	enc := base64.StdEncoding.EncodeToString([]byte(s))
	var b bytes.Buffer
	for len(enc) > 76 {
		b.WriteString(enc[:76])
		b.WriteString("\r\n")
		enc = enc[76:]
	}
	b.WriteString(enc)
	b.WriteString("\r\n")
	return b.String()
}
