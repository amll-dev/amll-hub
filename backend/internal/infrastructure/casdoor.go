package infrastructure

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
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

// doWithBasicAuthAndCookies 发请求并返回响应中设置的 Cookie（用于 send-verification-code 等需要保持会话的场景）
func (c *CasdoorClient) doWithBasicAuthAndCookies(method, path string, body io.Reader, contentType string) (*casdoorResponse, []*http.Cookie, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, nil, err
	}
	client := &http.Client{
		Timeout: 15 * time.Second,
		Jar:     jar,
	}

	req, err := http.NewRequest(method, c.cfg.Endpoint+path, body)
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
func (c *CasdoorClient) doWithBasicAuthWithCookie(method, path string, body io.Reader, contentType string, cookies []*http.Cookie) (*casdoorResponse, error) {
	req, err := http.NewRequest(method, c.cfg.Endpoint+path, body)
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

// truncateStr 截断字符串到最大长度
func truncateStr(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

// appID 返回 Casdoor 应用的 ID（owner/name 格式）
// owner 是应用的创建者（通常是 "admin"），不是 organization
// 优先使用 ApplicationOwner，为空则回退到 Organization（兼容旧配置）
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
func (c *CasdoorClient) Login(username, password string) (*CasdoorUser, string, error) {
	// 使用 OAuth 2.0 Resource Owner Password Credentials Grant
	// 需要在 Casdoor 应用中启用 "Password Credentials Grant"
	payload := map[string]interface{}{
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

	req, err := http.NewRequest("POST", c.cfg.Endpoint+"/api/login/oauth/access_token", bytes.NewReader(jsonBody))
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

	slog.Info("casdoor /api/login/oauth/access_token response",
		"status_code", resp.StatusCode,
		"body_len", len(body),
		"has_access_token", strings.Contains(body, "access_token"),
	)

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
		return nil, "", fmt.Errorf("%s", msg)
	}
	if tokenResp.Status == "error" {
		msg := tokenResp.Msg
		if msg == "" {
			msg = "casdoor login failed"
		}
		return nil, "", fmt.Errorf("%s", msg)
	}
	if tokenResp.AccessToken == "" {
		return nil, "", fmt.Errorf("casdoor login ok but no access_token, body: %s", body)
	}

	// 用 access_token 获取完整用户信息
	user, err := c.getAccount(tokenResp.AccessToken)
	if err != nil {
		return nil, "", err
	}
	return user, tokenResp.AccessToken, nil
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

// LoginByCode 用验证码登录（Casdoor /api/login 接口）
// Casdoor /api/login 的验证码登录流程要求：
//   - type 必须为 "login"（ResponseTypeLogin）。若填 "code" 会被当作 OAuth 授权码流程，
//     在缺少 clientId/redirectUri 等参数时触发 nil 指针 panic。
//   - 必须传 username 字段（邮箱或手机号均可，Casdoor 内部用 GetVerifyType 自动识别）。
//     不能用 email/phone 字段替代，否则 Login 函数会跳过用户名校验分支。
//   - 验证码字段名为 code（AuthForm.Code 的 json tag），不是 verificationCode。
//   - password 留空，Casdoor 据此进入验证码登录分支。
func (c *CasdoorClient) LoginByCode(dest, code string) (*CasdoorUser, error) {
	isEmail := strings.Contains(dest, "@")

	payload := map[string]interface{}{
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

	slog.Info("casdoor /api/login (code) request",
		"type", "login",
		"dest", dest,
		"isEmail", isEmail,
	)

	cr, err := c.doWithBasicAuth("POST", "/api/login", bytes.NewReader(jsonBody), "application/json")
	if err != nil {
		return nil, err
	}
	if err := checkStatus(cr); err != nil {
		slog.Warn("casdoor login (code) failed",
			"error", err,
			"casdoor_msg", cr.Msg,
		)
		return nil, err
	}

	// 验证码校验通过，根据邮箱/手机查询用户
	if isEmail {
		return c.GetUserByEmail(dest)
	}
	return c.GetUserByPhone(dest)
}

// GetUserByPhone 根据手机号查询用户（用于验证码登录流程）
func (c *CasdoorClient) GetUserByPhone(phone string) (*CasdoorUser, error) {
	cr, err := c.doWithBasicAuth("GET", fmt.Sprintf("/api/get-users?owner=%s&field=phone&value=%s", url.QueryEscape(c.cfg.Organization), url.QueryEscape(phone)), nil, "")
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
		return nil, fmt.Errorf("该手机号未注册")
	}
	return &users[0], nil
}

// SignupRequest 注册请求
// 注意：Casdoor /api/signup 接口期望的 displayName 字段名是 "name"，不是 "displayName"
type SignupRequest struct {
	Application  string `json:"application"`
	Organization string `json:"organization"`
	Username     string `json:"username"`
	Password     string `json:"password"`
	Email        string `json:"email"`
	EmailCode    string `json:"emailCode"`
	DisplayName  string `json:"name"`
}

// Signup 注册新用户
func (c *CasdoorClient) Signup(req SignupRequest) error {
	req.Application = c.cfg.Application
	req.Organization = c.cfg.Organization
	body, err := json.Marshal(req)
	if err != nil {
		return err
	}
	slog.Info("casdoor signup request",
		"username", req.Username,
		"email", req.Email,
		"displayName", req.DisplayName,
	)
	cr, err := c.doWithBasicAuth("POST", "/api/signup", bytes.NewReader(body), "application/json")
	if err != nil {
		return err
	}
	if err := checkStatus(cr); err != nil {
		slog.Warn("casdoor signup failed",
			"error", err,
			"casdoor_msg", cr.Msg,
		)
		return err
	}
	return nil
}

// GetCaptcha 获取 Casdoor 验证码信息（返回给前端展示）
// 返回原始 JSON 数据，前端用于展示验证码题目并获取 captchaToken
func (c *CasdoorClient) GetCaptcha() (json.RawMessage, error) {
	appId := c.appID()
	// Casdoor 的 /api/get-captcha 只接受 GET 方法（POST 会返回 404）
	// applicationId 中的 / 必须进行 URL 编码（%2F），否则 beego 路由器会截断
	u := "/api/get-captcha?applicationId=" + url.QueryEscape(appId) + "&id=" + url.QueryEscape(appId)
	slog.Info("casdoor get-captcha request", "url", u, "applicationId", appId, "method", "GET")
	cr, err := c.doWithBasicAuth("GET", u, nil, "")
	if err != nil {
		slog.Warn("casdoor get-captcha request failed", "error", err)
		return nil, err
	}
	slog.Info("casdoor get-captcha response",
		"status", cr.Status,
		"msg", cr.Msg,
		"data", truncateStr(string(cr.Data), 300),
	)
	if err := checkStatus(cr); err != nil {
		// get-captcha 失败时，尝试用 get-application 验证应用是否存在（辅助诊断）
		ga, e := c.doWithBasicAuth("GET", fmt.Sprintf("/api/get-application?owner=%s&name=%s", url.QueryEscape(c.appOwner()), url.QueryEscape(c.cfg.Application)), nil, "")
		if e == nil {
			slog.Warn("casdoor get-application diagnostic",
				"status", ga.Status, "msg", ga.Msg,
				"data", truncateStr(string(ga.Data), 200),
			)
		}
		return nil, err
	}
	return cr.Data, nil
}

// SendVerificationCode 发送验证码，checkKey 为邮箱或手机号
// captchaType, captchaToken 由前端从 GetCaptcha 获取并传回
// 返回 Casdoor 设置的 Session Cookie，调用方需保存以便后续 set-password 等接口使用
func (c *CasdoorClient) SendVerificationCode(checkType, checkKey, captchaType, captchaToken string) ([]*http.Cookie, error) {
	// Casdoor VerificationForm 参数：
	// dest, type, applicationId(owner/name 格式), method, captchaType, clientSecret, captchaToken
	//
	// 对于 Default captcha（基于 dchest/captcha 包）：
	//   - VerifyCaptcha(token, clientId, clientSecret, clientId2) 内部调用 VerifyCaptcha(clientSecret, token)
	//   - 即 clientSecret 应该是 captchaId，captchaToken 应该是用户输入的数字答案
	//   - 前端传来的 captchaToken 格式为 "captchaId:answer"，需要拆分
	//   - 注意：Casdoor 对 Default 类型不会覆盖 clientSecret（其他类型会用 provider 的 ClientSecret）
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
	form.Set("method", "submit")
	form.Set("captchaType", captchaType)
	form.Set("clientSecret", clientSecret)
	form.Set("captchaToken", token)

	slog.Info("casdoor send-verification-code request",
		"type", checkType,
		"dest", checkKey,
		"applicationId", appId,
		"captchaType", captchaType,
		"captchaToken_len", len(token),
	)

	cr, cookies, err := c.doWithBasicAuthAndCookies("POST", "/api/send-verification-code", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded")
	if err != nil {
		return nil, err
	}
	if err := checkStatus(cr); err != nil {
		slog.Warn("casdoor send-verification-code failed",
			"error", err,
			"casdoor_msg", cr.Msg,
		)
		return nil, err
	}
	slog.Info("casdoor send-verification-code ok, cookies", "count", len(cookies))
	return cookies, nil
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
// Casdoor /api/update-user 接口要求：
//  1. id 参数放在 query string 中（owner/name 格式）
//  2. columns 参数放在 query string 中（逗号分隔），不是放在 body 中
//  3. body 只包含 user 对象本身
func (c *CasdoorClient) UpdateUser(user *CasdoorUser, columns []string) error {
	// 构造 query string：id 和 columns 都放在 query 中
	id := user.Owner + "/" + user.Name
	q := url.Values{}
	q.Set("id", id)
	q.Set("columns", strings.Join(columns, ","))
	path := "/api/update-user?" + q.Encode()

	body, err := json.Marshal(user)
	if err != nil {
		return err
	}
	slog.Info("casdoor update-user request",
		"id", id,
		"columns", columns,
	)
	cr, err := c.doWithBasicAuth("POST", path, bytes.NewReader(body), "application/json")
	if err != nil {
		return err
	}
	if err := checkStatus(cr); err != nil {
		slog.Warn("casdoor update-user failed",
			"error", err,
			"casdoor_msg", cr.Msg,
		)
		return err
	}
	return nil
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

// VerifyCode 校验验证码并把 verifiedCode/verifiedUserId 写入 Casdoor Session
// Casdoor /api/set-password 在 code 不为空时会从 Session 读取 verifiedCode/verifiedUserId 做校验，
// 而 send-verification-code 只是把验证码写到数据库，并不会写入 Session。
// 因此必须先用同一个 Session Cookie 调用 /api/verify-code，再调用 /api/set-password。
// 调用方需保证传回的 cookies 与 send-verification-code 返回的 cookies 是同一份会话。
func (c *CasdoorClient) VerifyCode(dest, code string, cookies []*http.Cookie) error {
	payload := map[string]interface{}{
		"organization": c.cfg.Organization,
		"username":     dest,
		"code":         code,
	}
	jsonBody, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	slog.Info("casdoor verify-code request",
		"dest", dest,
		"code_len", len(code),
		"cookies", len(cookies),
	)
	cr, err := c.doWithBasicAuthWithCookie("POST", "/api/verify-code", bytes.NewReader(jsonBody), "application/json", cookies)
	if err != nil {
		return err
	}
	if err := checkStatus(cr); err != nil {
		slog.Warn("casdoor verify-code failed",
			"error", err,
			"casdoor_msg", cr.Msg,
		)
		return err
	}
	return nil
}

// ResetPassword 重置密码（用验证码，无需旧密码）
// Casdoor /api/set-password 在 code 不为空时，会从 Session 中读取 verifiedCode/verifiedUserId 做校验
// 因此必须传入发送验证码时获得的 Session Cookie，否则会报 "Missing parameter"
func (c *CasdoorClient) ResetPassword(owner, name, newPassword, code string, cookies []*http.Cookie) error {
	form := url.Values{}
	form.Set("userOwner", owner)
	form.Set("userName", name)
	form.Set("newPassword", newPassword)
	form.Set("code", code)

	slog.Info("casdoor set-password (reset) request",
		"userOwner", owner,
		"userName", name,
		"code_len", len(code),
		"cookies", len(cookies),
	)
	cr, err := c.doWithBasicAuthWithCookie("POST", "/api/set-password", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded", cookies)
	if err != nil {
		return err
	}
	if err := checkStatus(cr); err != nil {
		slog.Warn("casdoor set-password (reset) failed",
			"error", err,
			"casdoor_msg", cr.Msg,
		)
		return err
	}
	return nil
}

// UploadAvatar 上传头像到 Casdoor 资源存储，返回 URL
// Casdoor /api/upload-resource 接口要求：
//   - owner, user, application, tag, parent, fullFilePath 必须放在 query string 中
//   - 只有 file 字段放在 multipart form 中
func (c *CasdoorClient) UploadAvatar(fileBytes []byte, filename, username string) (string, error) {
	// 构造 query string
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

	slog.Info("casdoor upload-resource request",
		"username", username,
		"filename", filename,
		"fullFilePath", "/avatar/"+username+"/"+filename,
	)
	cr, err := c.doRequestWithMultipart(path, writer, body)
	if err != nil {
		return "", err
	}
	if err := checkStatus(cr); err != nil {
		slog.Warn("casdoor upload-resource failed",
			"error", err,
			"casdoor_msg", cr.Msg,
		)
		return "", err
	}

	// data 是资源 URL 字符串
	var urlStr string
	if err := json.Unmarshal(cr.Data, &urlStr); err != nil {
		return "", fmt.Errorf("decode upload url: %w", err)
	}
	return urlStr, nil
}
