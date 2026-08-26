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
			Timeout: 10 * time.Second,
		},
	}
}

// Validate 调用 Worker /validate 端点
func (s *ValidateService) Validate(ctx context.Context, ttmlContent []byte) (*TtmlValidateResult, error) {
	url := s.workerURL + "/validate"

	var lastErr error
	delays := []time.Duration{1 * time.Second, 2 * time.Second, 4 * time.Second}

	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			logrus.Debugf("validate retry attempt %d after %v", attempt+1, delays[attempt-1])
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(delays[attempt-1]):
			}
		}

		result, err := s.doValidate(ctx, url, ttmlContent)
		if err == nil {
			return result, nil
		}
		lastErr = err
		logrus.WithError(err).Warnf("validate attempt %d failed", attempt+1)
	}

	return nil, fmt.Errorf("%w: 校验服务不可用: %v", ErrUpstreamUnavailable, lastErr)
}

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

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("worker returned status %d: %s", resp.StatusCode, string(raw))
	}

	var result TtmlValidateResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &result, nil
}
