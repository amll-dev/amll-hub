package infrastructure

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/config"
	"github.com/golang-jwt/jwt/v5"
)

// GitHubAppClient GitHub App 客户端
type GitHubAppClient struct {
	cfg           config.GitHubAppConfig
	privateKey    []byte
	http          *http.Client
	tokenMu       sync.Mutex
	cachedToken   string
	tokenExpireAt time.Time
}

// 创建 GitHub App 客户端
func NewGitHubAppClient(cfg config.GitHubAppConfig) (*GitHubAppClient, error) {
	client := &GitHubAppClient{
		cfg:  cfg,
		http: &http.Client{Timeout: 15 * time.Second},
	}
	if cfg.PrivateKeyPath != "" {
		key, err := os.ReadFile(cfg.PrivateKeyPath)
		if err != nil {
			return nil, fmt.Errorf("read github app private key: %w", err)
		}
		client.privateKey = key
	}
	return client, nil
}

// Enabled 是否启用
func (c *GitHubAppClient) Enabled() bool {
	return c.cfg.AppID != 0 && c.cfg.InstallationID != 0 && len(c.privateKey) > 0
}

// installationToken 获取 installation access token，
func (c *GitHubAppClient) installationToken(ctx context.Context) (string, error) {
	if !c.Enabled() {
		return "", fmt.Errorf("github app not configured (need GITHUB_APP_ID, GITHUB_INSTALLATION_ID, GITHUB_PRIVATE_KEY_PATH)")
	}

	c.tokenMu.Lock()
	defer c.tokenMu.Unlock()

	// 缓存有效则直接返回
	if c.cachedToken != "" && time.Now().Before(c.tokenExpireAt.Add(-5*time.Minute)) {
		return c.cachedToken, nil
	}

	// 签发 JWT
	jwtStr, err := c.appJWT()
	if err != nil {
		return "", fmt.Errorf("sign app jwt: %w", err)
	}

	// 换取 installation token
	url := fmt.Sprintf("https://api.github.com/app/installations/%d/access_tokens", c.cfg.InstallationID)
	req, err := http.NewRequestWithContext(ctx, "POST", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+jwtStr)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("create installation token: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read token response: %w", err)
	}
	if resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("create installation token failed: status=%d body=%s", resp.StatusCode, string(body))
	}

	var tokenResp struct {
		Token      string          `json:"token"`
		ExpiresAt  time.Time       `json:"expires_at"`
		Permission json.RawMessage `json:"permissions"`
	}
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return "", fmt.Errorf("decode token response: %w", err)
	}
	if tokenResp.Token == "" {
		return "", fmt.Errorf("installation token empty, body=%s", string(body))
	}

	c.cachedToken = tokenResp.Token
	c.tokenExpireAt = tokenResp.ExpiresAt
	return tokenResp.Token, nil
}

// appJWT 生成 GitHub App 的 JWT
func (c *GitHubAppClient) appJWT() (string, error) {
	now := time.Now()
	claims := jwt.RegisteredClaims{
		IssuedAt:  jwt.NewNumericDate(now.Add(-60 * time.Second)),
		ExpiresAt: jwt.NewNumericDate(now.Add(9 * time.Minute)),
		Issuer:    fmt.Sprintf("%d", c.cfg.AppID),
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	key, err := jwt.ParseRSAPrivateKeyFromPEM(c.privateKey)
	if err != nil {
		return "", fmt.Errorf("parse rsa private key: %w", err)
	}
	return tok.SignedString(key)
}

// InstallationToken 暴露给 service 层使用
func (c *GitHubAppClient) InstallationToken(ctx context.Context) (string, error) {
	return c.installationToken(ctx)
}

// RepoInfo 返回上传目标 owner/repo/folder
func (c *GitHubAppClient) RepoInfo() (owner, repo, folder string) {
	return c.cfg.RepoOwner, c.cfg.RepoName, c.cfg.UploadFolder
}
