package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/sirupsen/logrus"

	"github.com/amll-dev/amll-hub/backend/internal/infrastructure"
)

// GitHub App 上传
type GitHubService struct {
	app  *infrastructure.GitHubAppClient
	http *http.Client
}

// 创建 GitHub 上传服务
func NewGitHubService(app *infrastructure.GitHubAppClient) *GitHubService {
	return &GitHubService{
		app:  app,
		http: &http.Client{Timeout: 30 * time.Second},
	}
}

// 上传文件内容到 GitHub 仓库
func (s *GitHubService) UploadFile(ctx context.Context, fileName string, contentReader io.Reader, reviewer string) error {
	if !s.app.Enabled() {
		logrus.WithField("file", fileName).Warn("github app not enabled, skip upload")
		return errors.New("github app 未配置，无法上传")
	}

	token, err := s.app.InstallationToken(ctx)
	if err != nil {
		return fmt.Errorf("get installation token: %w", err)
	}

	owner, repo, folder := s.app.RepoInfo()
	path := folder + "/" + fileName

	content, err := io.ReadAll(contentReader)
	if err != nil {
		return fmt.Errorf("read content: %w", err)
	}

	// 检查文件是否已存在
	sha, err := s.getFileSHA(ctx, token, owner, repo, path)
	if err != nil {
		return fmt.Errorf("get file sha: %w", err)
	}

	// PUT
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/contents/%s", owner, repo, path)
	body := map[string]any{
		"message": fmt.Sprintf("Upload lyric file: %s (approved by %s)", fileName, reviewer),
		"content": base64.StdEncoding.EncodeToString(content),
		"branch":  "main",
	}
	if sha != "" {
		body["sha"] = sha
	}
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "PUT", url, bytes.NewReader(bodyBytes))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.http.Do(req)
	if err != nil {
		return fmt.Errorf("upload to github: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("upload to github failed: status=%d body=%s", resp.StatusCode, string(respBody))
	}
	return nil
}

// 查询文件当前 SHA
func (s *GitHubService) getFileSHA(ctx context.Context, token, owner, repo, path string) (string, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/contents/%s", owner, repo, path)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := s.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return "", nil
	}
	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("get file sha failed: status=%d body=%s", resp.StatusCode, string(respBody))
	}

	var file struct {
		SHA string `json:"sha"`
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if err := json.Unmarshal(body, &file); err != nil {
		return "", err
	}
	return file.SHA, nil
}
