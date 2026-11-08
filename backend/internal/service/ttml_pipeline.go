package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
)

// TTMLValidationError 表示 TTML 解析/校验未通过，handler 统一映射为 400
type TTMLValidationError struct {
	Detail string
}

func (e *TTMLValidationError) Error() string {
	if e.Detail == "" {
		return "TTML 校验未通过"
	}
	return "TTML 校验未通过: " + e.Detail
}

// ErrInvalidTTMLFileName 文件名不符合歌词仓库命名规范
var ErrInvalidTTMLFileName = errors.New("TTML 文件名不符合规范")

// ttmlRepoFileNamePattern 匹配 {毫秒时间戳}-{GitHub数字ID}-{8位字母数字}.ttml
var ttmlRepoFileNamePattern = regexp.MustCompile(`^\d+-\d+-[A-Za-z0-9]{8}\.ttml$`)

// ValidateRepoTTMLFileName 校验歌词仓库规范文件名。
// 所有写入待审核区的文件都必须符合该格式，避免任意文件名进入对象存储与 GitHub。
func ValidateRepoTTMLFileName(name string) error {
	if len(name) > 255 {
		return fmt.Errorf("%w: 文件名过长", ErrInvalidTTMLFileName)
	}
	if !ttmlRepoFileNamePattern.MatchString(name) {
		return fmt.Errorf("%w: %s（应为 {毫秒时间戳}-{GitHub数字ID}-{8位字母数字}.ttml）", ErrInvalidTTMLFileName, name)
	}
	parts := strings.Split(strings.TrimSuffix(name, ".ttml"), "-")
	if len(parts) != 3 {
		return fmt.Errorf("%w: %s", ErrInvalidTTMLFileName, name)
	}
	if ts, err := strconv.ParseUint(parts[0], 10, 64); err != nil || ts == 0 {
		return fmt.Errorf("%w: 时间戳段非法", ErrInvalidTTMLFileName)
	}
	if id, err := strconv.ParseInt(parts[1], 10, 64); err != nil || id <= 0 {
		return fmt.Errorf("%w: GitHub ID 段非法", ErrInvalidTTMLFileName)
	}
	return nil
}

// ReadTTMLLimited 读取 TTML 内容并限制最大字节数，超限返回 ErrInvalidInput
func ReadTTMLLimited(r io.Reader, maxBytes int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("读取 TTML 失败: %w", err)
	}
	if int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("%w: TTML 文件大小超过 %d 字节", ErrInvalidInput, maxBytes)
	}
	return data, nil
}

// PrepareTTML 调用 Worker 校验 TTML。
// regenerate 为 true 时返回 Worker 重排后的内容；为 false 时校验通过后返回原始内容，
// 用于「未重排」投稿（仍需解析/校验，但保留原文件）。
func PrepareTTML(ctx context.Context, v *ValidateService, content []byte, regenerate bool) ([]byte, error) {
	if v == nil {
		return nil, errors.New("TTML 校验服务未配置")
	}
	if len(bytes.TrimSpace(content)) == 0 {
		return nil, &TTMLValidationError{Detail: "歌词内容为空"}
	}

	result, err := v.Validate(ctx, content)
	if err != nil {
		return nil, err
	}
	if !result.Valid || result.ParseError != "" {
		detail := strings.TrimSpace(result.ParseError)
		if detail == "" && len(result.Errors) > 0 {
			detail = strings.Join(result.Errors, "; ")
		}
		if detail == "" {
			detail = "未知校验错误"
		}
		return nil, &TTMLValidationError{Detail: detail}
	}
	if !regenerate {
		return content, nil
	}

	regenerated := []byte(result.RegeneratedTtml)
	if len(bytes.TrimSpace(regenerated)) == 0 {
		return nil, &TTMLValidationError{Detail: "校验服务未返回重排后的歌词"}
	}
	return regenerated, nil
}
