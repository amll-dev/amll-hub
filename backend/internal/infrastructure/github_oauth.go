package infrastructure

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/config"
)

// GithubOAuthClient 自建 GitHub OAuth 客户端（不依赖 Casdoor 第三方登录）
type GithubOAuthClient struct {
	cfg  config.GitHubOAuthConfig
	http *http.Client
}

// GithubUser GitHub 用户基本信息
type GithubUser struct {
	ID        int64  `json:"id"`
	Login     string `json:"login"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	Email     string `json:"email"`
}

// NewGithubOAuthClient 创建 GithubOAuthClient
func NewGithubOAuthClient(cfg config.GitHubOAuthConfig) *GithubOAuthClient {
	return &GithubOAuthClient{
		cfg:  cfg,
		http: &http.Client{Timeout: 15 * time.Second},
	}
}

// Enabled 是否已配置
func (c *GithubOAuthClient) Enabled() bool { return c.cfg.Enabled() }

// AuthorizeURL 生成 GitHub 授权页跳转地址
func (c *GithubOAuthClient) AuthorizeURL(state string) string {
	q := url.Values{}
	q.Set("client_id", c.cfg.ClientID)
	q.Set("redirect_uri", c.cfg.RedirectURI)
	q.Set("scope", "read:user user:email")
	q.Set("state", state)
	return "https://github.com/login/oauth/authorize?" + q.Encode()
}

// ExchangeCode 用授权码换取 access token
func (c *GithubOAuthClient) ExchangeCode(ctx context.Context, code string) (string, error) {
	if !c.Enabled() {
		return "", fmt.Errorf("github oauth not configured")
	}
	form := url.Values{}
	form.Set("client_id", c.cfg.ClientID)
	form.Set("client_secret", c.cfg.ClientSecret)
	form.Set("code", code)
	form.Set("redirect_uri", c.cfg.RedirectURI)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://github.com/login/oauth/access_token",
		strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("exchange code: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read token response: %w", err)
	}
	var parsed struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
		Description string `json:"error_description"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("decode token response: %w", err)
	}
	if parsed.AccessToken == "" {
		return "", fmt.Errorf("github exchange code failed: %s %s", parsed.Error, parsed.Description)
	}
	return parsed.AccessToken, nil
}

// GetUser 获取当前授权用户信息
func (c *GithubOAuthClient) GetUser(ctx context.Context, accessToken string) (*GithubUser, error) {
	var user GithubUser
	if err := c.getJSON(ctx, accessToken, "https://api.github.com/user", &user); err != nil {
		return nil, err
	}
	return &user, nil
}

// GetPrimaryEmail 取主邮箱（primary && verified）；无可用邮箱返回空串
func (c *GithubOAuthClient) GetPrimaryEmail(ctx context.Context, accessToken string) string {
	var emails []struct {
		Email    string `json:"email"`
		Primary  bool   `json:"primary"`
		Verified bool   `json:"verified"`
	}
	if err := c.getJSON(ctx, accessToken, "https://api.github.com/user/emails", &emails); err != nil {
		return ""
	}
	for _, e := range emails {
		if e.Primary && e.Verified {
			return e.Email
		}
	}
	for _, e := range emails {
		if e.Verified {
			return e.Email
		}
	}
	return ""
}

// getJSON 发送带 token 的 GET 请求并解析 JSON
func (c *GithubOAuthClient) getJSON(ctx context.Context, accessToken, apiURL string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "amll-hub")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("github api %s: %w", apiURL, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read github api response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("github api %s status=%d body=%s", apiURL, resp.StatusCode, string(body))
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode github api response: %w", err)
	}
	return nil
}
