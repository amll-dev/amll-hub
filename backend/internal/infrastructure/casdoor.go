package infrastructure

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"

	"github.com/sirupsen/logrus"

	"github.com/amll-dev/amll-hub/backend/internal/config"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
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
func (c *CasdoorClient) doWithBasicAuth(ctx context.Context, method, path string, body io.Reader, contentType string) (*casdoorResponse, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.cfg.Endpoint+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", c.basicAuthHeader())
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	return c.doRequest(req)
}

// doWithBasicAuthAndCookies 发请求并返回响应中设置的 Cookie（用于 send-verification-code 等需要保持会话的场景）
func (c *CasdoorClient) doWithBasicAuthAndCookies(ctx context.Context, method, path string, body io.Reader, contentType string) (*casdoorResponse, []*http.Cookie, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, nil, err
	}
	client := &http.Client{
		Timeout: 15 * time.Second,
		Jar:     jar,
	}

	req, err := http.NewRequestWithContext(ctx, method, c.cfg.Endpoint+path, body)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Authorization", c.basicAuthHeader())
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("casdoor request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("read casdoor response: %w", err)
	}

	var cr casdoorResponse
	if err := json.Unmarshal(raw, &cr); err != nil {
		return nil, nil, fmt.Errorf("decode casdoor response: %w, body: %s", err, string(raw))
	}
	return &cr, resp.Cookies(), nil
}

// doWithBasicAuthWithCookie 带 Cookie 发请求（用于 set-password 等需要会话的场景）
func (c *CasdoorClient) doWithBasicAuthWithCookie(ctx context.Context, method, path string, body io.Reader, contentType string, cookies []*http.Cookie) (*casdoorResponse, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.cfg.Endpoint+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", c.basicAuthHeader())
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	for _, ck := range cookies {
		req.AddCookie(ck)
	}
	return c.doRequest(req)
}

// 带 Cookie 发请求并捕获响应中更新的 Cookie
func (c *CasdoorClient) doWithBasicAuthWithCookieJar(ctx context.Context, method, path string, body io.Reader, contentType string, cookies []*http.Cookie) (*casdoorResponse, []*http.Cookie, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, nil, err
	}
	client := &http.Client{
		Timeout: 15 * time.Second,
		Jar:     jar,
	}

	req, err := http.NewRequestWithContext(ctx, method, c.cfg.Endpoint+path, body)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Authorization", c.basicAuthHeader())
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	// 将输入 cookies 注入 jar
	if len(cookies) > 0 {
		jar.SetCookies(req.URL, cookies)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("casdoor request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("read casdoor response: %w", err)
	}

	// 合并 cookies
	merged := mergeCookies(cookies, resp.Cookies())

	var cr casdoorResponse
	if err := json.Unmarshal(raw, &cr); err != nil {
		logrus.WithFields(logrus.Fields{
			"path":        path,
			"status_code": resp.StatusCode,
			"body":        truncateStr(string(raw), 200),
		}).Info("casdoor non-json response")
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return &casdoorResponse{Status: "ok", Msg: ""}, merged, nil
		}
		return &casdoorResponse{Status: "error", Msg: strings.TrimSpace(string(raw))}, merged, nil
	}

	return &cr, merged, nil
}

// 合并两组 cookies
func mergeCookies(base, update []*http.Cookie) []*http.Cookie {
	seen := make(map[string]bool, len(base)+len(update))
	result := make([]*http.Cookie, 0, len(base)+len(update))
	for _, ck := range update {
		key := ck.Name + "@" + ck.Domain + ck.Path
		if !seen[key] {
			seen[key] = true
			result = append(result, ck)
		}
	}
	for _, ck := range base {
		key := ck.Name + "@" + ck.Domain + ck.Path
		if !seen[key] {
			seen[key] = true
			result = append(result, ck)
		}
	}
	return result
}

// doWithBearer 用 access_token 做 Bearer 发请求
func (c *CasdoorClient) doWithBearer(ctx context.Context, method, path string, body io.Reader, contentType, token string) (*casdoorResponse, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.cfg.Endpoint+path, body)
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
func (c *CasdoorClient) doRequestWithMultipart(ctx context.Context, path string, writer *multipart.Writer, body *bytes.Buffer) (*casdoorResponse, error) {
	req, err := http.NewRequestWithContext(ctx, "POST", c.cfg.Endpoint+path, body)
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
		return errors.New(msg)
	}
	return nil
}

// truncateStr 截断字符串到最大长度（超出时以 ... 结尾）
func truncateStr(s string, max int) string {
	truncated := pkg.Truncate(s, max)
	if truncated == s {
		return s
	}
	return truncated + "..."
}

// appID 返回 Casdoor 应用的 ID
func (c *CasdoorClient) appID() string {
	owner := c.cfg.ApplicationOwner
	if owner == "" {
		owner = c.cfg.Organization
	}
	return owner + "/" + c.cfg.Application
}

// appOwner 返回应用的 owner（用于 get-application 查询）
func (c *CasdoorClient) appOwner() string {
	if c.cfg.ApplicationOwner != "" {
		return c.cfg.ApplicationOwner
	}
	return c.cfg.Organization
}

// Login 用用户凭据登录（OAuth 2.0 密码模式），返回用户信息和 access_token
func (c *CasdoorClient) Login(ctx context.Context, username, password string) (*CasdoorUser, string, error) {
	// 使用 OAuth 2.0 Resource Owner Password Credentials Grant
	// 需要在 Casdoor 应用中启用 "Password Credentials Grant"
	payload := map[string]any{
		"grant_type":    "password",
		"client_id":     c.cfg.ClientID,
		"client_secret": c.cfg.ClientSecret,
		"username":      username,
		"password":      password,
	}
	jsonBody, err := json.Marshal(payload)
	if err != nil {
		return nil, "", err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.cfg.Endpoint+"/api/login/oauth/access_token", bytes.NewReader(jsonBody))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("casdoor login request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", fmt.Errorf("read casdoor login response: %w", err)
	}
	body := strings.TrimSpace(string(raw))

	logrus.WithFields(logrus.Fields{
		"status_code":      resp.StatusCode,
		"body_len":         len(body),
		"has_access_token": strings.Contains(body, "access_token"),
	}).Info("casdoor /api/login/oauth/access_token response")

	// OAuth token 响应：{"access_token":"...","token_type":"Bearer","expires_in":10080,...}
	// 错误响应：{"error":"...","error_description":"..."} 或 Casdoor 标准格式
	var tokenResp struct {
		AccessToken      string `json:"access_token"`
		TokenType        string `json:"token_type"`
		ExpiresIn        int    `json:"expires_in"`
		RefreshToken     string `json:"refresh_token"`
		Scope            string `json:"scope"`
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
		// Casdoor 标准错误格式
		Status string `json:"status"`
		Msg    string `json:"msg"`
	}
	if err := json.Unmarshal(raw, &tokenResp); err != nil {
		return nil, "", fmt.Errorf("decode token response: %w, body: %s", err, body)
	}

	if tokenResp.Error != "" {
		msg := tokenResp.ErrorDescription
		if msg == "" {
			msg = tokenResp.Error
		}
		return nil, "", errors.New(msg)
	}
	if tokenResp.Status == "error" {
		msg := tokenResp.Msg
		if msg == "" {
			msg = "casdoor login failed"
		}
		return nil, "", errors.New(msg)
	}
	if tokenResp.AccessToken == "" {
		return nil, "", fmt.Errorf("casdoor login ok but no access_token, body: %s", body)
	}

	// 用 access_token 获取完整用户信息
	user, err := c.getAccount(ctx, tokenResp.AccessToken)
	if err != nil {
		return nil, "", err
	}
	return user, tokenResp.AccessToken, nil
}

// getAccount 用 access_token 获取当前登录用户信息
func (c *CasdoorClient) getAccount(ctx context.Context, accessToken string) (*CasdoorUser, error) {
	cr, err := c.doWithBearer(ctx, "GET", "/api/get-account", nil, "", accessToken)
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

// LoginByCode 用验证码登录（Casdoor /api/login 接口）
func (c *CasdoorClient) LoginByCode(ctx context.Context, dest, code string) (*CasdoorUser, error) {
	isEmail := strings.Contains(dest, "@")

	payload := map[string]any{
		"organization": c.cfg.Organization,
		"application":  c.cfg.Application,
		"type":         "login",
		"username":     dest,
		"code":         code,
		"autoSignin":   true,
	}

	jsonBody, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	logrus.WithFields(logrus.Fields{
		"type":    "login",
		"dest":    dest,
		"isEmail": isEmail,
	}).Info("casdoor /api/login (code) request")

	cr, err := c.doWithBasicAuth(ctx, "POST", "/api/login", bytes.NewReader(jsonBody), "application/json")
	if err != nil {
		return nil, err
	}
	if err := checkStatus(cr); err != nil {
		logrus.WithFields(logrus.Fields{
			"error":       err,
			"casdoor_msg": cr.Msg,
		}).Warn("casdoor login (code) failed")
		return nil, err
	}

	// 验证码校验通过，根据邮箱/手机查询用户
	if isEmail {
		return c.GetUserByEmail(ctx, dest)
	}
	return c.GetUserByPhone(ctx, dest)
}

// 根据手机号查询用户
func (c *CasdoorClient) GetUserByPhone(ctx context.Context, phone string) (*CasdoorUser, error) {
	cr, err := c.doWithBasicAuth(ctx, "GET", fmt.Sprintf("/api/get-users?owner=%s&field=phone&value=%s&pageSize=100&p=1", url.QueryEscape(c.cfg.Organization), url.QueryEscape(phone)), nil, "")
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
	// 在客户端二次校验
	for i := range users {
		if users[i].Phone == phone {
			return &users[i], nil
		}
	}
	if len(users) == 0 {
		return nil, fmt.Errorf("该手机号未注册")
	}
	return nil, fmt.Errorf("该手机号未注册")
}

// 注册请求
type SignupRequest struct {
	Application  string `json:"application"`
	Organization string `json:"organization"`
	Username     string `json:"username"`
	Password     string `json:"password"`
	Email        string `json:"email"`
	EmailCode    string `json:"emailCode,omitempty"`
	Phone        string `json:"phone"`
	PhoneCode    string `json:"phoneCode,omitempty"`
	CountryCode  string `json:"countryCode,omitempty"`
	DisplayName  string `json:"name"`
}

// Signup 注册新用户
func (c *CasdoorClient) Signup(ctx context.Context, req SignupRequest) error {
	req.Application = c.cfg.Application
	req.Organization = c.cfg.Organization
	if req.CountryCode == "" {
		req.CountryCode = "86"
	}
	body, err := json.Marshal(req)
	if err != nil {
		return err
	}
	logrus.WithFields(logrus.Fields{
		"username":    req.Username,
		"email":       req.Email,
		"phone":       req.Phone,
		"displayName": req.DisplayName,
	}).Info("casdoor signup request")
	cr, err := c.doWithBasicAuth(ctx, "POST", "/api/signup", bytes.NewReader(body), "application/json")
	if err != nil {
		return err
	}
	if err := checkStatus(cr); err != nil {
		logrus.WithFields(logrus.Fields{
			"error":       err,
			"casdoor_msg": cr.Msg,
		}).Warn("casdoor signup failed")
		return errors.New(cr.Msg)
	}
	return nil
}

// 获取 Casdoor 验证码信息
func (c *CasdoorClient) GetCaptcha(ctx context.Context) (json.RawMessage, error) {
	appId := c.appID()
	u := "/api/get-captcha?applicationId=" + url.QueryEscape(appId) + "&id=" + url.QueryEscape(appId)
	logrus.WithFields(logrus.Fields{
		"url":           u,
		"applicationId": appId,
		"method":        "GET",
	}).Info("casdoor get-captcha request")
	cr, err := c.doWithBasicAuth(ctx, "GET", u, nil, "")
	if err != nil {
		logrus.WithField("error", err).Warn("casdoor get-captcha request failed")
		return nil, err
	}
	logrus.WithFields(logrus.Fields{
		"status": cr.Status,
		"msg":    cr.Msg,
		"data":   truncateStr(string(cr.Data), 300),
	}).Info("casdoor get-captcha response")
	if err := checkStatus(cr); err != nil {
		return nil, err
	}
	return cr.Data, nil
}

// 发送验证码
func (c *CasdoorClient) SendVerificationCode(ctx context.Context, checkType, checkKey, captchaType, captchaToken, method string) ([]*http.Cookie, error) {
	appId := c.appID()
	clientSecret := c.cfg.ClientSecret
	token := captchaToken

	if captchaType == "Default" {
		// 解析 "captchaId:answer" 格式
		if idx := strings.Index(captchaToken, ":"); idx > 0 {
			captchaId := captchaToken[:idx]
			answer := captchaToken[idx+1:]
			clientSecret = captchaId
			token = answer
		}
	}

	form := url.Values{}
	form.Set("type", checkType)
	form.Set("dest", checkKey)
	form.Set("applicationId", appId)
	if method == "" {
		method = "login"
	}
	form.Set("method", method)
	form.Set("captchaType", captchaType)
	form.Set("clientSecret", clientSecret)
	form.Set("captchaToken", token)

	logrus.WithFields(logrus.Fields{
		"type":             checkType,
		"dest":             checkKey,
		"applicationId":    appId,
		"captchaType":      captchaType,
		"captchaToken_len": len(token),
	}).Info("casdoor send-verification-code request")

	cr, cookies, err := c.doWithBasicAuthAndCookies(ctx, "POST", "/api/send-verification-code", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded")
	if err != nil {
		return nil, err
	}
	if err := checkStatus(cr); err != nil {
		logrus.WithFields(logrus.Fields{
			"error":       err,
			"casdoor_msg": cr.Msg,
		}).Warn("casdoor send-verification-code failed")
		return nil, err
	}
	logrus.WithField("count", len(cookies)).Info("casdoor send-verification-code ok, cookies")
	return cookies, nil
}

// 获取用户
func (c *CasdoorClient) GetUser(ctx context.Context, owner, name string) (*CasdoorUser, error) {
	cr, err := c.doWithBasicAuth(ctx, "GET", fmt.Sprintf("/api/get-user?id=%s/%s", url.PathEscape(owner), url.PathEscape(name)), nil, "")
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

// 根据邮箱查询用户
func (c *CasdoorClient) GetUserByEmail(ctx context.Context, email string) (*CasdoorUser, error) {
	path := fmt.Sprintf("/api/get-users?owner=%s&field=email&value=%s&pageSize=100&p=1", url.QueryEscape(c.cfg.Organization), url.QueryEscape(email))
	cr, err := c.doWithBasicAuth(ctx, "GET", path, nil, "")
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
	// 在客户端二次校验
	for i := range users {
		if users[i].Email == email {
			logrus.WithFields(logrus.Fields{
				"email": email,
				"owner": users[i].Owner,
				"name":  users[i].Name,
			}).Info("casdoor get-user-by-email matched")
			return &users[i], nil
		}
	}
	return nil, fmt.Errorf("该邮箱未注册")
}

// updateUserRequest 更新用户请求体
type updateUserRequest struct {
	User    *CasdoorUser `json:"user"`
	Columns []string     `json:"columns"`
}

// 更新用户信息
func (c *CasdoorClient) UpdateUser(ctx context.Context, user *CasdoorUser, columns []string) error {
	id := user.Owner + "/" + user.Name
	q := url.Values{}
	q.Set("id", id)
	q.Set("columns", strings.Join(columns, ","))
	path := "/api/update-user?" + q.Encode()

	body, err := json.Marshal(user)
	if err != nil {
		return err
	}
	logrus.WithFields(logrus.Fields{
		"id":      id,
		"columns": columns,
	}).Info("casdoor update-user request")
	cr, err := c.doWithBasicAuth(ctx, "POST", path, bytes.NewReader(body), "application/json")
	if err != nil {
		return err
	}
	if err := checkStatus(cr); err != nil {
		logrus.WithFields(logrus.Fields{
			"error":       err,
			"casdoor_msg": cr.Msg,
		}).Warn("casdoor update-user failed")
		return err
	}
	return nil
}

// 修改密码
func (c *CasdoorClient) SetPassword(ctx context.Context, owner, name, oldPassword, newPassword string) error {
	form := url.Values{}
	form.Set("userOwner", owner)
	form.Set("userName", name)
	form.Set("oldPassword", oldPassword)
	form.Set("newPassword", newPassword)

	cr, err := c.doWithBasicAuth(ctx, "POST", "/api/set-password", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded")
	if err != nil {
		return err
	}
	return checkStatus(cr)
}

// 校验验证码并把 verifiedCode/verifiedUserId 写入 Casdoor Session
func (c *CasdoorClient) VerifyCode(ctx context.Context, dest, name, code string, cookies []*http.Cookie) ([]*http.Cookie, error) {
	payload := map[string]any{
		"organization": c.cfg.Organization,
		"username":     dest,
		"name":         name,
		"code":         code,
		"type":         "login",
	}
	jsonBody, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	logrus.WithFields(logrus.Fields{
		"dest":     dest,
		"name":     name,
		"code_len": len(code),
		"cookies":  len(cookies),
	}).Info("casdoor verify-code request")
	cr, respCookies, err := c.doWithBasicAuthWithCookieJar(ctx, "POST", "/api/verify-code", bytes.NewReader(jsonBody), "application/json", cookies)
	if err != nil {
		return nil, err
	}
	if err := checkStatus(cr); err != nil {
		logrus.WithFields(logrus.Fields{
			"error":       err,
			"casdoor_msg": cr.Msg,
		}).Warn("casdoor verify-code failed")
		return nil, err
	}
	logrus.WithFields(logrus.Fields{
		"input":  len(cookies),
		"output": len(respCookies),
	}).Info("casdoor verify-code ok, cookies")
	return respCookies, nil
}

// 重置密码。
func (c *CasdoorClient) ResetPassword(ctx context.Context, owner, name, newPassword, code string, cookies []*http.Cookie) error {
	form := url.Values{}
	form.Set("userOwner", owner)
	form.Set("userName", name)
	form.Set("newPassword", newPassword)
	form.Set("code", code)

	logrus.WithFields(logrus.Fields{
		"userOwner": owner,
		"userName":  name,
		"code_len":  len(code),
		"cookies":   len(cookies),
	}).Info("casdoor set-password (reset) request")
	cr, _, err := c.doWithBasicAuthWithCookieJar(ctx, "POST", "/api/set-password", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded", cookies)
	if err != nil {
		return err
	}
	if err := checkStatus(cr); err != nil {
		logrus.WithFields(logrus.Fields{
			"error":       err,
			"casdoor_msg": cr.Msg,
		}).Warn("casdoor set-password (reset) failed")
		return err
	}
	return nil
}

// 上传头像到 Casdoor 资源存储
func (c *CasdoorClient) UploadAvatar(ctx context.Context, fileBytes []byte, filename, username string) (string, error) {
	q := url.Values{}
	q.Set("owner", c.cfg.Organization)
	q.Set("user", username)
	q.Set("application", c.cfg.Application)
	q.Set("tag", "avatar")
	q.Set("parent", c.cfg.Organization+"/"+username)
	q.Set("fullFilePath", "/avatar/"+username+"/"+filename)
	path := "/api/upload-resource?" + q.Encode()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

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

	logrus.WithFields(logrus.Fields{
		"username":     username,
		"filename":     filename,
		"fullFilePath": "/avatar/" + username + "/" + filename,
	}).Info("casdoor upload-resource request")
	cr, err := c.doRequestWithMultipart(ctx, path, writer, body)
	if err != nil {
		return "", err
	}
	if err := checkStatus(cr); err != nil {
		logrus.WithFields(logrus.Fields{
			"error":       err,
			"casdoor_msg": cr.Msg,
		}).Warn("casdoor upload-resource failed")
		return "", err
	}

	// data 是资源 URL 字符串
	var urlStr string
	if err := json.Unmarshal(cr.Data, &urlStr); err != nil {
		return "", fmt.Errorf("decode upload url: %w", err)
	}
	return urlStr, nil
}
