// Package mail 站内事件的邮件通知
package mail

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"mime"
	"mime/multipart"
	"net"
	"net/smtp"
	"net/textproto"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/config"
)

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

// Send 发送一封邮件
func (s *Sender) Send(ctx context.Context, to, subject, htmlBody, textBody string) error {
	if !s.Enabled() {
		return fmt.Errorf("mail disabled")
	}
	msg, err := s.buildMessage(to, subject, htmlBody, textBody)
	if err != nil {
		return err
	}

	c, err := s.dial(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = c.Quit() }()

	if s.cfg.Username != "" {
		auth := smtp.PlainAuth("", s.cfg.Username, s.cfg.Password, s.cfg.Host)
		if err := c.Auth(auth); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}
	if err := c.Mail(s.cfg.From); err != nil {
		return fmt.Errorf("smtp mail from: %w", err)
	}
	if err := c.Rcpt(to); err != nil {
		return fmt.Errorf("smtp rcpt: %w", err)
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
