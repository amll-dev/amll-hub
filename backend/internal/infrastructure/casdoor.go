package infrastructure

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/config"
)

// CasdoorClient Casdoor HTTP 客户端
type CasdoorClient struct {
	cfg  config.CasdoorConfig
	http *http.Client
}

// NewCasdoorClient 创建 Casdoor 客户端
func NewCasdoorClient(cfg config.CasdoorConfig) *CasdoorClient {
	return &CasdoorClient{
		cfg: cfg,
		http: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

// CasdoorUser Casdoor 用户对象
type CasdoorUser struct {
	Owner       string `json:"owner"`
	Name        string `json:"name"`
	CreatedTime string `json:"createdTime"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
	Email       string `json:"email"`
	Phone       string `json:"phone"`
	Password    string `json:"password,omitempty"`
}

// casdoorResponse Casdoor 通用响应
type casdoorResponse struct {
	Status string          `json:"status"`
	Msg    string          `json:"msg"`
	Sub    string          `json:"sub"`
	Data   json.RawMessage `json:"data"`
}

// basicAuthHeader 生成 Basic Auth header
func (c *CasdoorClient) basicAuthHeader() string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(c.cfg.ClientID+":"+c.cfg.ClientSecret))
}

// doWithBasicAuth 用 client_id:client_secret 做 Basic Auth 发请求
func (c *CasdoorClient) doWithBasicAuth(method, path string, body io.Reader, contentType string) (*casdoorResponse, error) {
	req, err := http.NewRequest(method, c.cfg.Endpoint+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", c.basicAuthHeader())
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	return c.doRequest(req)
}

// doWithBearer 用 access_token 做 Bearer 发请求
func (c *CasdoorClient) doWithBearer(method, path string, body io.Reader, contentType, token string) (*casdoorResponse, error) {
	req, err := http.NewRequest(method, c.cfg.Endpoint+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	return c.doRequest(req)
}

// doRequestWithMultipart 发送 multipart 请求（Basic Auth）
func (c *CasdoorClient) doRequestWithMultipart(path string, writer *multipart.Writer, body *bytes.Buffer) (*casdoorResponse, error) {
	req, err := http.NewRequest("POST", c.cfg.Endpoint+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", c.basicAuthHeader())
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return c.doRequest(req)
}

func (c *CasdoorClient) doRequest(req *http.Request) (*casdoorResponse, error) {
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("casdoor request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read casdoor response: %w", err)
	}

	var cr casdoorResponse
	if err := json.Unmarshal(raw, &cr); err != nil {
		return nil, fmt.Errorf("decode casdoor response: %w, body: %s", err, string(raw))
	}
	return &cr, nil
}

// checkStatus 检查 Casdoor 响应状态，失败返回错误
func checkStatus(cr *casdoorResponse) error {
	if cr.Status != "ok" {
		msg := cr.Msg
		if msg == "" {
			msg = "casdoor operation failed"
		}
		return fmt.Errorf("%s", msg)
	}
	return nil
}

// Login 用用户凭据登录，返回用户信息和 access_token
func (c *CasdoorClient) Login(username, password string) (*CasdoorUser, string, error) {
	form := url.Values{}
	form.Set("application", c.cfg.Application)
	form.Set("organization", c.cfg.Organization)
	form.Set("username", username)
	form.Set("password", password)
	form.Set("autoSignin", "1")

	req, err := http.NewRequest("POST", c.cfg.Endpoint+"/api/login", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	cr, err := c.doRequest(req)
	if err != nil {
		return nil, "", err
	}
	if err := checkStatus(cr); err != nil {
		return nil, "", err
	}

	// data 字段是 access_token 字符串
	var accessToken string
	if err := json.Unmarshal(cr.Data, &accessToken); err != nil {
		return nil, "", fmt.Errorf("decode access_token: %w", err)
	}

	// 用 access_token 获取完整用户信息
	user, err := c.getAccount(accessToken)
	if err != nil {
		return nil, "", err
	}
	return user, accessToken, nil
}

// getAccount 用 access_token 获取当前登录用户信息
func (c *CasdoorClient) getAccount(accessToken string) (*CasdoorUser, error) {
	cr, err := c.doWithBearer("GET", "/api/get-account", nil, "", accessToken)
	if err != nil {
		return nil, err
	}
	if err := checkStatus(cr); err != nil {
		return nil, err
	}
	var user CasdoorUser
	if err := json.Unmarshal(cr.Data, &user); err != nil {
		return nil, fmt.Errorf("decode user: %w", err)
	}
	return &user, nil
}

// SignupRequest 注册请求
type SignupRequest struct {
	Application  string `json:"application"`
	Organization string `json:"organization"`
	Username     string `json:"username"`
	Password     string `json:"password"`
	Email        string `json:"email"`
	EmailCode    string `json:"emailCode"`
	DisplayName  string `json:"displayName"`
}

// Signup 注册新用户
func (c *CasdoorClient) Signup(req SignupRequest) error {
	req.Application = c.cfg.Application
	req.Organization = c.cfg.Organization
	body, err := json.Marshal(req)
	if err != nil {
		return err
	}
	cr, err := c.doWithBasicAuth("POST", "/api/signup", bytes.NewReader(body), "application/json")
	if err != nil {
		return err
	}
	return checkStatus(cr)
}

// SendVerificationCode 发送验证码，checkKey 为邮箱或手机号
func (c *CasdoorClient) SendVerificationCode(checkType, checkKey string) error {
	form := url.Values{}
	form.Set("checkType", checkType)
	form.Set("checkKey", checkKey)
	form.Set("application", c.cfg.Application)
	form.Set("clientId", c.cfg.ClientID)
	form.Set("clientSecret", c.cfg.ClientSecret)

	cr, err := c.doWithBasicAuth("POST", "/api/send-verification-code", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded")
	if err != nil {
		return err
	}
	return checkStatus(cr)
}

// GetUser 根据 owner/name 获取用户
func (c *CasdoorClient) GetUser(owner, name string) (*CasdoorUser, error) {
	cr, err := c.doWithBasicAuth("GET", fmt.Sprintf("/api/get-user?id=%s/%s", url.PathEscape(owner), url.PathEscape(name)), nil, "")
	if err != nil {
		return nil, err
	}
	if err := checkStatus(cr); err != nil {
		return nil, err
	}
	var user CasdoorUser
	if err := json.Unmarshal(cr.Data, &user); err != nil {
		return nil, fmt.Errorf("decode user: %w", err)
	}
	return &user, nil
}

// GetUserByEmail 根据邮箱查询用户（用于忘记密码流程）
func (c *CasdoorClient) GetUserByEmail(email string) (*CasdoorUser, error) {
	cr, err := c.doWithBasicAuth("GET", fmt.Sprintf("/api/get-users?owner=%s&field=email&value=%s", url.QueryEscape(c.cfg.Organization), url.QueryEscape(email)), nil, "")
	if err != nil {
		return nil, err
	}
	if err := checkStatus(cr); err != nil {
		return nil, err
	}
	var users []CasdoorUser
	if err := json.Unmarshal(cr.Data, &users); err != nil {
		return nil, fmt.Errorf("decode users: %w", err)
	}
	if len(users) == 0 {
		return nil, fmt.Errorf("该邮箱未注册")
	}
	return &users[0], nil
}

// updateUserRequest 更新用户请求体
type updateUserRequest struct {
	User    *CasdoorUser `json:"user"`
	Columns []string     `json:"columns"`
}

// UpdateUser 更新用户信息，columns 指定要更新的字段名
func (c *CasdoorClient) UpdateUser(user *CasdoorUser, columns []string) error {
	body, err := json.Marshal(updateUserRequest{User: user, Columns: columns})
	if err != nil {
		return err
	}
	cr, err := c.doWithBasicAuth("POST", "/api/update-user", bytes.NewReader(body), "application/json")
	if err != nil {
		return err
	}
	return checkStatus(cr)
}

// SetPassword 修改密码（需旧密码）
func (c *CasdoorClient) SetPassword(owner, name, oldPassword, newPassword string) error {
	form := url.Values{}
	form.Set("userOwner", owner)
	form.Set("userName", name)
	form.Set("oldPassword", oldPassword)
	form.Set("newPassword", newPassword)

	cr, err := c.doWithBasicAuth("POST", "/api/set-password", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded")
	if err != nil {
		return err
	}
	return checkStatus(cr)
}

// ResetPassword 重置密码（用验证码，无需旧密码）
func (c *CasdoorClient) ResetPassword(owner, name, newPassword, emailOrPhone, code string) error {
	form := url.Values{}
	form.Set("userOwner", owner)
	form.Set("userName", name)
	form.Set("newPassword", newPassword)
	form.Set("email", emailOrPhone)
	form.Set("code", code)

	cr, err := c.doWithBasicAuth("POST", "/api/reset-password", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded")
	if err != nil {
		return err
	}
	return checkStatus(cr)
}

// UploadAvatar 上传头像到 Casdoor 资源存储，返回 URL
func (c *CasdoorClient) UploadAvatar(fileBytes []byte, filename, username string) (string, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	if err := writer.WriteField("application", c.cfg.Application); err != nil {
		return "", err
	}
	if err := writer.WriteField("tag", "avatar"); err != nil {
		return "", err
	}
	if err := writer.WriteField("parent", c.cfg.Organization+"/"+username); err != nil {
		return "", err
	}
	if err := writer.WriteField("fullFilePath", "/avatar/"+username+"/"+filename); err != nil {
		return "", err
	}

	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(fileBytes); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}

	cr, err := c.doRequestWithMultipart("/api/upload-resource", writer, body)
	if err != nil {
		return "", err
	}
	if err := checkStatus(cr); err != nil {
		return "", err
	}

	// data 是资源 URL 字符串
	var urlStr string
	if err := json.Unmarshal(cr.Data, &urlStr); err != nil {
		return "", fmt.Errorf("decode upload url: %w", err)
	}
	return urlStr, nil
}
