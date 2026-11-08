package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestValidateRepoTTMLFileName(t *testing.T) {
	tests := []struct {
		name    string
		wantErr bool
	}{
		{"1700000000000-12345678-AbCd1234.ttml", false},
		{"", true},
		{"1700000000000-12345678-AbCd1234", true},
		{"1700000000000-12345678-AbCd1234.xml", true},
		{"1700000000000-12345678-AbCd1234.ttml.bak", true},
		{"1700000000000-12345678.ttml", true},
		{"1700000000000-12345678-AbCd1234-extra.ttml", true},
		{"1700000000000-12345678-AbCd123.ttml", true},
		{"1700000000000-12345678-AbCd12345.ttml", true},
		{"1700000000000-12345678-AbCd_123.ttml", true},
		{"1700000000000-0-AbCd1234.ttml", true},
		{"0-12345678-AbCd1234.ttml", true},
		{"1700000000000--12345678-AbCd1234.ttml", true},
		{"../1700000000000-12345678-AbCd1234.ttml", true},
		{"1700000000000-12345678-歌词歌词歌词歌词.ttml", true},
		{strings.Repeat("1", 300) + "-1-AbCd1234.ttml", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateRepoTTMLFileName(tt.name)
			if tt.wantErr {
				if !errors.Is(err, ErrInvalidTTMLFileName) {
					t.Fatalf("期望 ErrInvalidTTMLFileName，实际: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("期望校验通过，实际: %v", err)
			}
		})
	}
}

func TestReadTTMLLimited(t *testing.T) {
	content := []byte("hello")

	got, err := ReadTTMLLimited(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		t.Fatalf("恰好等于上限应通过: %v", err)
	}
	if !bytes.Equal(got, content) {
		t.Fatalf("内容不一致: %q", got)
	}

	if _, err := ReadTTMLLimited(bytes.NewReader(content), int64(len(content))-1); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("超限应返回 ErrInvalidInput，实际: %v", err)
	}
}

// newValidateTestServer 启动一个固定返回结果的 Worker 模拟服务
func newValidateTestServer(t *testing.T, result TtmlValidateResult) *ValidateService {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(result)
	}))
	t.Cleanup(srv.Close)
	return NewValidateService(srv.URL)
}

func TestPrepareTTML(t *testing.T) {
	original := []byte("<tt><body>raw</body></tt>")
	regenerated := "<tt><body>regen</body></tt>"

	t.Run("正常模式返回重排结果", func(t *testing.T) {
		v := newValidateTestServer(t, TtmlValidateResult{Valid: true, RegeneratedTtml: regenerated})
		got, err := PrepareTTML(context.Background(), v, original, true)
		if err != nil {
			t.Fatalf("不应报错: %v", err)
		}
		if string(got) != regenerated {
			t.Fatalf("期望重排内容，实际: %s", got)
		}
	})

	t.Run("未重排模式保留原内容", func(t *testing.T) {
		v := newValidateTestServer(t, TtmlValidateResult{Valid: true, RegeneratedTtml: regenerated})
		got, err := PrepareTTML(context.Background(), v, original, false)
		if err != nil {
			t.Fatalf("不应报错: %v", err)
		}
		if !bytes.Equal(got, original) {
			t.Fatalf("期望原始内容，实际: %s", got)
		}
	})

	t.Run("校验失败返回 TTMLValidationError", func(t *testing.T) {
		v := newValidateTestServer(t, TtmlValidateResult{Valid: false, Errors: []string{"结构非法"}})
		_, err := PrepareTTML(context.Background(), v, original, true)
		assertTTMLValidationError(t, err, "结构非法")
	})

	t.Run("解析失败返回 TTMLValidationError", func(t *testing.T) {
		v := newValidateTestServer(t, TtmlValidateResult{Valid: true, ParseError: "第 3 行格式错误"})
		_, err := PrepareTTML(context.Background(), v, original, true)
		assertTTMLValidationError(t, err, "第 3 行格式错误")
	})

	t.Run("缺少重排结果时报错", func(t *testing.T) {
		v := newValidateTestServer(t, TtmlValidateResult{Valid: true})
		_, err := PrepareTTML(context.Background(), v, original, true)
		assertTTMLValidationError(t, err, "校验服务未返回重排后的歌词")
	})

	t.Run("空内容返回 TTMLValidationError", func(t *testing.T) {
		v := newValidateTestServer(t, TtmlValidateResult{Valid: true})
		_, err := PrepareTTML(context.Background(), v, []byte("  \n"), true)
		assertTTMLValidationError(t, err, "歌词内容为空")
	})

	t.Run("未配置校验服务时报错", func(t *testing.T) {
		if _, err := PrepareTTML(context.Background(), nil, original, true); err == nil {
			t.Fatal("期望报错，实际为 nil")
		}
	})
}

func assertTTMLValidationError(t *testing.T, err error, wantDetail string) {
	t.Helper()
	var validationErr *TTMLValidationError
	if !errors.As(err, &validationErr) {
		t.Fatalf("期望 *TTMLValidationError，实际: %v", err)
	}
	if validationErr.Detail != wantDetail {
		t.Fatalf("期望 detail=%q，实际=%q", wantDetail, validationErr.Detail)
	}
}
