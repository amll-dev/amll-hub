package service

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestRandomTicket(t *testing.T) {
	seen := make(map[string]bool, 100)
	for i := 0; i < 100; i++ {
		ticket, err := randomTicket()
		if err != nil {
			t.Fatalf("randomTicket failed: %v", err)
		}
		if ticket == "" {
			t.Fatal("randomTicket returned empty string")
		}
		// URL 安全字符集：不应出现 + / = 等需要转义的字符
		if strings.ContainsAny(ticket, "+/=") {
			t.Fatalf("ticket %q contains non URL-safe chars", ticket)
		}
		if seen[ticket] {
			t.Fatalf("duplicated ticket generated: %q", ticket)
		}
		seen[ticket] = true
	}
}

// 二维码内容必须是 App 能直接唤起的 deep link
func TestQRTicketContentFormat(t *testing.T) {
	ticket, err := randomTicket()
	if err != nil {
		t.Fatalf("randomTicket failed: %v", err)
	}

	content := qrScheme + "://qrlogin?ticket=" + ticket
	if !strings.HasPrefix(content, "amllhub://qrlogin?ticket=") {
		t.Fatalf("unexpected qr content prefix: %s", content)
	}
	// App 侧按 "ticket=" 切分，取到的不应带查询串残留
	idx := strings.Index(content, "ticket=")
	got := content[idx+len("ticket="):]
	if got != ticket {
		t.Fatalf("ticket mismatch: want %q got %q", ticket, got)
	}
}

func TestQRTicketStateJSONRoundTrip(t *testing.T) {
	profile := UserProfile{
		Name:        "alice",
		DisplayName: "爱丽丝",
		Email:       "alice@example.com",
		IsReviewer:  true,
	}
	state := &QRTicketState{
		Status: QRStatusConfirmed,
		UserID: "org/alice",
		Token:  "jwt-token",
		User:   &profile,
	}

	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	got := &QRTicketState{}
	if err := json.Unmarshal(raw, got); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	if got.Status != QRStatusConfirmed {
		t.Errorf("status = %q, want %q", got.Status, QRStatusConfirmed)
	}
	if got.Token != "jwt-token" {
		t.Errorf("token = %q, want %q", got.Token, "jwt-token")
	}
	if got.User == nil || got.User.DisplayName != "爱丽丝" {
		t.Errorf("user profile not preserved: %+v", got.User)
	}
	if !got.User.IsReviewer {
		t.Error("isReviewer not preserved")
	}
}

// pending 状态下不应带上token 与用户资料
func TestQRTicketPendingStateOmitsSensitiveFields(t *testing.T) {
	raw, err := json.Marshal(&QRTicketState{Status: QRStatusPending})
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	body := string(raw)
	if strings.Contains(body, "token") || strings.Contains(body, "userId") {
		t.Errorf("pending state should omit sensitive fields, got: %s", body)
	}
}
