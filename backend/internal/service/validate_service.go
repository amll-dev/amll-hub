package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	logrus "github.com/sirupsen/logrus"
)

// TtmlValidateResult Worker 校验返回结果
type TtmlValidateResult struct {
	Valid           bool           `json:"valid"`
	Errors          []string       `json:"errors"`
	ParseError      string         `json:"parseError"`
	RegeneratedTtml string         `json:"regeneratedTtml"`
	Metadata        map[string]any `json:"metadata"`
}

const (
	// validateAttempts 单次校验最多尝试次数（含首次）
	validateAttempts = 3
	// validateAttemptTimeout 单次请求 Worker 的超时。
	// Worker 正常几百毫秒返回，15s 足以覆盖大文件解析。
	validateAttemptTimeout = 15 * time.Second
)

// validateRetryBackoff 每次重试前的等待。
//
// 重试次数和总预算必须一起算：handler 侧给的是 longTimeout(60s)，
// 这里最坏路径 = 15s + 0.5s + 15s + 1s + 15s = 46.5s，还剩十几秒余量给请求体
// 读取与响应序列化，保证最后一次重试真的能跑完。
// 反过来（单次 10s + 1s/2s/4s 退避 + 外层只有 10s）时，第 2 次重试刚发出就会
// 撞上 ctx 超时，剩下两次和退避全是死代码 —— 所以调大预算不等于调小单次超时，
// 三个数字必须同时满足：attempts*attemptTimeout + sum(backoff) < 外层预算。
// 长度必须为 validateAttempts-1，改重试次数时两者一起改。
var validateRetryBackoff = []time.Duration{500 * time.Millisecond, 1 * time.Second}

// ValidateService 调用 Worker 进行 TTML 校验
type ValidateService struct {
	workerURL string
	client    *http.Client
}

// NewValidateService 创建校验服务
func NewValidateService(workerURL string) *ValidateService {
	return &ValidateService{
		workerURL: workerURL,
		client: &http.Client{
			Timeout: validateAttemptTimeout,
		},
	}
}

// Validate 调用 Worker /validate 端点
func (s *ValidateService) Validate(ctx context.Context, ttmlContent []byte) (*TtmlValidateResult, error) {
	url := s.workerURL + "/validate"

	var lastErr error

	for attempt := 0; attempt < validateAttempts; attempt++ {
		if attempt > 0 {
			delay := validateRetryBackoff[attempt-1]
			logrus.Debugf("validate retry attempt %d after %v", attempt+1, delay)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(delay):
			}
		}

		result, err := s.doValidate(ctx, url, ttmlContent)
		if err == nil {
			return result, nil
		}
		lastErr = err
		logrus.WithError(err).Warnf("validate attempt %d failed", attempt+1)
		// 外层 ctx 已结束（客户端断开或预算耗尽）：下一次必然立刻失败，
		// 再等一个退避周期没有意义。
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, ctxErr
		}
	}

	return nil, fmt.Errorf("%w: 校验服务不可用: %v", ErrUpstreamUnavailable, lastErr)
}

// maxValidateResponseBytes 限制 Worker 校验响应体大小（含重排后的 TTML）
const maxValidateResponseBytes = 16 << 20

func (s *ValidateService) doValidate(ctx context.Context, url string, body []byte) (*TtmlValidateResult, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "text/plain; charset=utf-8")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call worker: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxValidateResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("worker returned status %d: %s", resp.StatusCode, truncateBody(raw, upstreamErrBodyLimit))
	}

	var result TtmlValidateResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &result, nil
}
