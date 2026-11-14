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
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/sirupsen/logrus"

	"github.com/amll-dev/amll-hub/backend/internal/config"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
)

// maxCasdoorResponseBytes 限制读取 Casdoor 响应体大小，避免异常响应耗尽内存
const maxCasdoorResponseBytes = 16 << 20

// CasdoorClient Casdoor HTTP 客户端
type CasdoorClient struct {
	cfg  config.CasdoorConfig
	http *http.Client

	// 用户搜索回退路径的全量列表缓存，避免「查无结果」时每次都重拉一页用户
	userListMu    sync.Mutex
	userListCache []CasdoorUser
	userListAt    time.Time
}

// userListCacheTTL 回退用户列表的缓存时长
const userListCacheTTL = 5 * time.Minute

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
	CountryCode string `json:"countryCode"`
	Password    string `json:"password,omitempty"`

	// MFA 状态
	PreferredMfaType string     `json:"preferredMfaType"`
	TotpSecret       string     `json:"totpSecret"`
	MfaPhoneEnabled  bool       `json:"mfaPhoneEnabled"`
	MfaEmailEnabled  bool       `json:"mfaEmailEnabled"`
	MfaRadiusEnabled bool       `json:"mfaRadiusEnabled"`
	MfaPushEnabled   bool       `json:"mfaPushEnabled"`
	MultiFactorAuths []MfaProps `json:"multiFactorAuths"`
}

// casdoorResponse Casdoor 通用响应
type casdoorResponse struct {
	Status string          `json:"status"`
	Msg    string          `json:"msg"`
	Sub    string          `json:"sub"`
	Data   json.RawMessage `json:"data"`
	Data2  json.RawMessage `json:"data2"`
}

// MfaProps Casdoor 多因素认证因子
type MfaProps struct {
	Enabled            bool     `json:"enabled"`
	IsPreferred        bool     `json:"isPreferred"`
	MfaType            string   `json:"mfaType"`
	Secret             string   `json:"secret"`
	CountryCode        string   `json:"countryCode"`
	URL                string   `json:"url"`
	RecoveryCodes      []string `json:"recoveryCodes"`
	MfaRememberInHours int      `json:"mfaRememberInHours"`
}

// CasdoorLoginState /api/login 的登录状态
type CasdoorLoginState int

const (
	// CasdoorLoginSuccess 登录成功，UserID 为 org/name
	CasdoorLoginSuccess CasdoorLoginState = iota
	// CasdoorLoginMfaRequired 需要二次验证
	CasdoorLoginMfaRequired
	// CasdoorLoginMfaSetupRequired 组织要求先绑定 MFA
	CasdoorLoginMfaSetupRequired
	// CasdoorLoginUpdatePassword 需要先修改密码
	CasdoorLoginUpdatePassword
)

// CasdoorLoginResult /api/login 的解析结果
type CasdoorLoginResult struct {
	State      CasdoorLoginState
	UserID     string
	MfaMethods []MfaProps
	Cookies    []*http.Cookie
}

// parseLoginResult 解析 /api/login 响应，data 可能是 userId / NextMfa / RequiredMfa / RequiredUpdatePassword
func parseLoginResult(cr *casdoorResponse, cookies []*http.Cookie) (*CasdoorLoginResult, error) {
	result := &CasdoorLoginResult{Cookies: cookies}

	var data string
	if len(cr.Data) > 0 {
		if err := json.Unmarshal(cr.Data, &data); err != nil {
			return nil, fmt.Errorf("decode login data: %w", err)
		}
	}

	switch data {
	case "NextMfa":
		result.State = CasdoorLoginMfaRequired
		if len(cr.Data2) > 0 {
			if err := json.Unmarshal(cr.Data2, &result.MfaMethods); err != nil {
				return nil, fmt.Errorf("decode mfa methods: %w", err)
			}
		}
	case "RequiredMfa":
		result.State = CasdoorLoginMfaSetupRequired
		if len(cr.Data2) > 0 {
			_ = json.Unmarshal(cr.Data2, &result.MfaMethods)
		}
	case "RequiredUpdatePassword":
		result.State = CasdoorLoginUpdatePassword
	default:
		result.State = CasdoorLoginSuccess
		result.UserID = data
	}

	return result, nil
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
	req, err := http.NewRequestWithContext(ctx, method, c.cfg.Endpoint+path, body)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Authorization", c.basicAuthHeader())
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	// 复用 c.http 的连接池，尽量让登录与随后的 MFA 校验走同一条 keep-alive 连接
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("casdoor request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxCasdoorResponseBytes))
	if err != nil {
		return nil, nil, fmt.Errorf("read casdoor response: %w", err)
	}

	var cr casdoorResponse
	if err := json.Unmarshal(raw, &cr); err != nil {
		return nil, nil, fmt.Errorf("decode casdoor response: %w, body: %s", err, string(raw))
	}
	respCookies := resp.Cookies()
	if strings.HasPrefix(path, "/api/login") {
		logrus.WithFields(logrus.Fields{
			"path":              path,
			"resp_cookie_count": len(respCookies),
			"resp_cookie_names": cookieNames(respCookies),
		}).Info("casdoor login response cookies")
	}
	return &cr, respCookies, nil
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
	return c.doWithCookieHeaderCore(ctx, method, path, body, contentType, cookies, true)
}

// doWithCookieHeaderCore 带 Cookie 发请求，basicAuth 控制是否附加应用凭据。
// 统一按 Cookie 头发送，不做 cookie jar 的域名/路径过滤；并复用 c.http 的连接池。
func (c *CasdoorClient) doWithCookieHeaderCore(ctx context.Context, method, path string, body io.Reader, contentType string, cookies []*http.Cookie, basicAuth bool) (*casdoorResponse, []*http.Cookie, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.cfg.Endpoint+path, body)
	if err != nil {
		return nil, nil, err
	}
	if basicAuth {
		req.Header.Set("Authorization", c.basicAuthHeader())
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	for _, ck := range cookies {
		req.AddCookie(ck)
	}
	if strings.HasPrefix(path, "/api/login") || strings.HasPrefix(path, "/api/mfa/") {
		logrus.WithFields(logrus.Fields{
			"path":         path,
			"basic_auth":   basicAuth,
			"cookie_count": len(cookies),
			"cookie_names": cookieNames(cookies),
		}).Info("casdoor request cookies")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("casdoor request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxCasdoorResponseBytes))
	if err != nil {
		return nil, nil, fmt.Errorf("read casdoor response: %w", err)
	}

	// 合并 cookies
	respCookies := resp.Cookies()
	merged := mergeCookies(cookies, respCookies)
	if strings.HasPrefix(path, "/api/login") || strings.HasPrefix(path, "/api/mfa/") {
		logrus.WithFields(logrus.Fields{
			"path":                path,
			"resp_cookie_count":   len(respCookies),
			"resp_cookie_names":   cookieNames(respCookies),
			"merged_cookie_count": len(merged),
			"merged_cookie_names": cookieNames(merged),
		}).Info("casdoor response cookies")
	}

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

// doWithCookieHeader 直接按 Cookie 头发送会话（不带 Basic Auth）。
// Casdoor 的 /api/login 二次验证、mfaAuth 发码、MFA 绑定 verify/enable 都依赖这份会话。
func (c *CasdoorClient) doWithCookieHeader(ctx context.Context, method, path string, body io.Reader, contentType string, cookies []*http.Cookie) (*casdoorResponse, []*http.Cookie, error) {
	return c.doWithCookieHeaderCore(ctx, method, path, body, contentType, cookies, false)
}

// cookieNames 只返回 Cookie 名，避免把会话值写进日志
func cookieNames(cookies []*http.Cookie) []string {
	names := make([]string, 0, len(cookies))
	for _, ck := range cookies {
		names = append(names, ck.Name)
	}
	return names
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

func (c *CasdoorClient) doRequest(req *http.Request) (*casdoorResponse, error) {
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("casdoor request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxCasdoorResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("read casdoor response: %w", err)
	}

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrCasdoorUserNotFound
	}

	var cr casdoorResponse
	if err := json.Unmarshal(raw, &cr); err != nil {
		return nil, fmt.Errorf("decode casdoor response: %w, body: %s", err, string(raw))
	}
	return &cr, nil
}

// ErrCasdoorUserNotFound Casdoor 侧明确表示用户不存在
var ErrCasdoorUserNotFound = errors.New("casdoor user not found")

// isCasdoorNotFound 判断 Casdoor 的错误消息是否在表达「用户不存在」
func isCasdoorNotFound(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, ErrCasdoorUserNotFound) {
		return true
	}
	msg := strings.ToLower(err.Error())
	for _, kw := range []string{"does not exist", "not found", "not exist", "不存在"} {
		if strings.Contains(msg, kw) {
			return true
		}
	}
	return false
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

// LoginWithPassword 用用户名/密码登录（Casdoor /api/login）
//
// 与 OAuth 密码模式不同，这个接口会走 Casdoor 的 MFA 流程：
// 返回 NextMfa 时说明密码已通过，但还需要二次验证。
func (c *CasdoorClient) LoginWithPassword(ctx context.Context, username, password string) (*CasdoorLoginResult, error) {
	payload := map[string]any{
		"organization": c.cfg.Organization,
		"application":  c.cfg.Application,
		"type":         "login",
		"username":     username,
		"password":     password,
		"autoSignin":   true,
	}

	jsonBody, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	logrus.WithField("username", username).Info("casdoor /api/login (password) request")

	cr, cookies, err := c.doWithBasicAuthAndCookies(ctx, "POST", "/api/login", bytes.NewReader(jsonBody), "application/json")
	if err != nil {
		return nil, err
	}
	if err := checkStatus(cr); err != nil {
		logrus.WithFields(logrus.Fields{
			"error":       err,
			"casdoor_msg": cr.Msg,
		}).Warn("casdoor login (password) failed")
		return nil, err
	}

	return parseLoginResult(cr, cookies)
}

// LoginByCode 用验证码登录（Casdoor /api/login 接口）。
//
// 该接口不返回 OAuth token，而是通过 Set-Cookie 下发会话，因此这里用 cookie jar 捕获，
// 让「以登录用户身份」的接口（如 /api/reset-email-or-phone）也能复用这份会话。
func (c *CasdoorClient) LoginByCode(ctx context.Context, dest, code string) (*CasdoorLoginResult, error) {
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

	cr, cookies, err := c.doWithBasicAuthAndCookies(ctx, "POST", "/api/login", bytes.NewReader(jsonBody), "application/json")
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

	return parseLoginResult(cr, cookies)
}

// VerifyMfaLogin 用 MFA 验证码继续完成登录
func (c *CasdoorClient) VerifyMfaLogin(ctx context.Context, cookies []*http.Cookie, mfaType, passcode, recoveryCode string) (*CasdoorLoginResult, error) {
	payload := map[string]any{
		"organization": c.cfg.Organization,
		"application":  c.cfg.Application,
		"type":         "login",
		"mfaType":      mfaType,
		"passcode":     passcode,
		"recoveryCode": recoveryCode,
		"autoSignin":   true,
	}

	jsonBody, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	logrus.WithFields(logrus.Fields{
		"mfa_type":     mfaType,
		"has_passcode": passcode != "",
		"has_recovery": recoveryCode != "",
	}).Info("casdoor /api/login (mfa) request")

	// 二次验证只依赖第一次登录返回的会话 cookie
	cr, merged, err := c.doWithCookieHeader(ctx, "POST", "/api/login", bytes.NewReader(jsonBody), "application/json", cookies)
	if err != nil {
		return nil, err
	}
	if err := checkStatus(cr); err != nil {
		logrus.WithFields(logrus.Fields{
			"error":       err,
			"casdoor_msg": cr.Msg,
		}).Warn("casdoor login (mfa) failed")
		return nil, err
	}

	return parseLoginResult(cr, merged)
}

// SendMfaCode 向 MFA 会话对应的邮箱/手机发送验证码
func (c *CasdoorClient) SendMfaCode(ctx context.Context, cookies []*http.Cookie, checkType, dest, captchaType, captchaToken string) ([]*http.Cookie, error) {
	// Casdoor 要求 captchaType 必填；应用未配置人机验证时传 none
	if captchaType == "" {
		captchaType = "none"
	}

	form := url.Values{}
	form.Set("type", checkType)
	form.Set("dest", dest)
	form.Set("applicationId", c.appID())
	form.Set("method", "mfaAuth")
	form.Set("captchaType", captchaType)
	form.Set("clientSecret", c.cfg.ClientSecret)
	form.Set("captchaToken", captchaToken)

	logrus.WithFields(logrus.Fields{
		"type":            checkType,
		"dest":            dest,
		"captchaType":     captchaType,
		"captchaTokenLen": len(captchaToken),
	}).Info("casdoor send-verification-code (mfa) request")

	cr, merged, err := c.doWithCookieHeader(ctx, "POST", "/api/send-verification-code", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded", cookies)
	if err != nil {
		return nil, err
	}
	if err := checkStatus(cr); err != nil {
		logrus.WithFields(logrus.Fields{
			"error":       err,
			"casdoor_msg": cr.Msg,
		}).Warn("casdoor send-verification-code (mfa) failed")
		return nil, err
	}
	return merged, nil
}

// SendMfaSetupCode 向用户已绑定的邮箱/手机发送 MFA 绑定验证码
func (c *CasdoorClient) SendMfaSetupCode(ctx context.Context, checkUser, checkType, dest, countryCode, captchaType, captchaToken string) ([]*http.Cookie, error) {
	if captchaType == "" {
		captchaType = "none"
	}

	clientSecret := c.cfg.ClientSecret
	token := captchaToken
	if captchaType == "Default" {
		// 与登录发码一致：Default 类型把 "captchaId:answer" 拆成 clientSecret 和 token
		if idx := strings.Index(captchaToken, ":"); idx > 0 {
			clientSecret = captchaToken[:idx]
			token = captchaToken[idx+1:]
		}
	}

	form := url.Values{}
	form.Set("type", checkType)
	form.Set("dest", dest)
	form.Set("countryCode", countryCode)
	form.Set("applicationId", c.appID())
	form.Set("method", "mfaSetup")
	form.Set("checkUser", checkUser)
	form.Set("captchaType", captchaType)
	form.Set("clientSecret", clientSecret)
	form.Set("captchaToken", token)

	logrus.WithFields(logrus.Fields{
		"type":        checkType,
		"dest":        dest,
		"checkUser":   checkUser,
		"captchaType": captchaType,
	}).Info("casdoor send-verification-code (mfaSetup) request")

	cr, cookies, err := c.doWithBasicAuthAndCookies(ctx, "POST", "/api/send-verification-code", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded")
	if err != nil {
		return nil, err
	}
	if err := checkStatus(cr); err != nil {
		logrus.WithFields(logrus.Fields{
			"error":       err,
			"casdoor_msg": cr.Msg,
		}).Warn("casdoor send-verification-code (mfaSetup) failed")
		return nil, err
	}
	return cookies, nil
}

// MfaSetupInitiate 初始化 MFA 绑定，返回 secret / otpauth URL / 恢复码。
func (c *CasdoorClient) MfaSetupInitiate(ctx context.Context, owner, name, mfaType string) (*MfaProps, []*http.Cookie, error) {
	form := url.Values{}
	form.Set("owner", owner)
	form.Set("name", name)
	form.Set("mfaType", mfaType)

	cr, cookies, err := c.doWithBasicAuthWithCookieJar(ctx, "POST", "/api/mfa/setup/initiate", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded", nil)
	if err != nil {
		return nil, nil, err
	}
	if err := checkStatus(cr); err != nil {
		return nil, nil, err
	}

	var props MfaProps
	if len(cr.Data) > 0 {
		if err := json.Unmarshal(cr.Data, &props); err != nil {
			return nil, nil, fmt.Errorf("decode mfa setup props: %w", err)
		}
	}
	return &props, cookies, nil
}

// MfaSetupVerify 校验 MFA 绑定验证码；返回的 cookie 需要传给 MfaSetupEnable。
func (c *CasdoorClient) MfaSetupVerify(ctx context.Context, cookies []*http.Cookie, owner, name, mfaType, passcode, secret, dest, countryCode string) ([]*http.Cookie, error) {
	form := url.Values{}
	form.Set("owner", owner)
	form.Set("name", name)
	form.Set("mfaType", mfaType)
	form.Set("passcode", passcode)
	form.Set("secret", secret)
	form.Set("dest", dest)
	form.Set("countryCode", countryCode)

	cr, merged, err := c.doWithCookieHeader(ctx, "POST", "/api/mfa/setup/verify", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded", cookies)
	if err != nil {
		return nil, err
	}
	if err := checkStatus(cr); err != nil {
		return nil, err
	}
	return merged, nil
}

// MfaSetupEnable 启用 MFA 因子。
func (c *CasdoorClient) MfaSetupEnable(ctx context.Context, cookies []*http.Cookie, owner, name, mfaType, secret, dest, countryCode, recoveryCode string) ([]*http.Cookie, error) {
	form := url.Values{}
	form.Set("owner", owner)
	form.Set("name", name)
	form.Set("mfaType", mfaType)
	form.Set("secret", secret)
	form.Set("dest", dest)
	form.Set("countryCode", countryCode)
	form.Set("recoveryCodes", recoveryCode)

	cr, merged, err := c.doWithCookieHeader(ctx, "POST", "/api/mfa/setup/enable", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded", cookies)
	if err != nil {
		return nil, err
	}
	if err := checkStatus(cr); err != nil {
		return nil, err
	}
	return merged, nil
}

// DeleteMfa 关闭用户全部 MFA 因子
func (c *CasdoorClient) DeleteMfa(ctx context.Context, owner, name string) error {
	form := url.Values{}
	form.Set("owner", owner)
	form.Set("name", name)

	cr, err := c.doWithBasicAuth(ctx, "POST", "/api/delete-mfa", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded")
	if err != nil {
		return err
	}
	return checkStatus(cr)
}

// SetPreferredMfa 设置首选 MFA 因子。
func (c *CasdoorClient) SetPreferredMfa(ctx context.Context, owner, name, mfaType string) error {
	form := url.Values{}
	form.Set("owner", owner)
	form.Set("name", name)
	form.Set("mfaType", mfaType)

	cr, err := c.doWithBasicAuth(ctx, "POST", "/api/set-preferred-mfa", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded")
	if err != nil {
		return err
	}
	return checkStatus(cr)
}

// 根据手机号查询用户
func (c *CasdoorClient) GetUserByPhone(ctx context.Context, phone string) (*CasdoorUser, error) {
	phone = strings.TrimSpace(phone)
	if phone == "" {
		return nil, fmt.Errorf("该手机号未注册")
	}
	candidates := []string{phone}
	bare := toBarePhone(phone)
	e164 := toE164Phone(phone)
	for _, v := range []string{bare, e164} {
		if v != "" && v != candidates[0] {
			candidates = append(candidates, v)
		}
	}

	var lastErr error
	for _, cand := range candidates {
		users, err := c.queryUsersByField(ctx, "phone", cand)
		if err != nil {
			lastErr = err
			continue
		}
		for i := range users {
			if phoneMatches(users[i].Phone, phone) {
				logrus.WithFields(logrus.Fields{
					"query": cand,
					"phone": users[i].Phone,
					"owner": users[i].Owner,
					"name":  users[i].Name,
				}).Info("casdoor get-user-by-phone matched")
				return &users[i], nil
			}
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("该手机号未注册")
}

// toE164Phone 把号码补成 E.164（+86xxxxxxxxxxx），非数字字符原样返回
func toE164Phone(phone string) string {
	phone = strings.TrimSpace(phone)
	if phone == "" || strings.HasPrefix(phone, "+") {
		return phone
	}
	for _, r := range phone {
		if r < '0' || r > '9' {
			return phone
		}
	}
	return "+86" + phone
}

// toBarePhone 去掉国家码前缀，只留订阅号
func toBarePhone(phone string) string {
	phone = strings.TrimSpace(phone)
	if strings.HasPrefix(phone, "+") {
		phone = phone[1:]
	}
	if len(phone) == 13 && strings.HasPrefix(phone, "86") {
		return phone[2:]
	}
	return phone
}

// phoneMatches 判断库里的 phone 与目标是否同一个（裸号 / E.164 两种写法都算）
func phoneMatches(stored, target string) bool {
	if stored == "" || target == "" {
		return false
	}
	return toBarePhone(stored) == toBarePhone(target)
}

// queryUsersByField 按字段查询用户列表
func (c *CasdoorClient) queryUsersByField(ctx context.Context, field, value string) ([]CasdoorUser, error) {
	return c.queryUsersByFieldLimit(ctx, field, value, 100)
}

// queryUsersByFieldLimit 按字段查询用户列表，可指定返回条数
func (c *CasdoorClient) queryUsersByFieldLimit(ctx context.Context, field, value string, limit int) ([]CasdoorUser, error) {
	if limit <= 0 {
		limit = 100
	}
	path := fmt.Sprintf("/api/get-users?owner=%s&field=%s&value=%s&pageSize=%d&p=1",
		url.QueryEscape(c.cfg.Organization), url.QueryEscape(field), url.QueryEscape(value), limit)
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
	return users, nil
}

// localUserScanLimit 回退方案单次扫描的用户上限，避免拉全量账号
const localUserScanLimit = 1000

// SearchUsers 按用户名 / 昵称搜索用户，结果按 Name 去重
func (c *CasdoorClient) SearchUsers(ctx context.Context, keyword string, limit int) ([]CasdoorUser, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return nil, nil
	}
	if limit <= 0 {
		limit = 20
	}

	seen := make(map[string]struct{}, limit)
	out := make([]CasdoorUser, 0, limit)
	for _, field := range []string{"name", "displayName"} {
		users, err := c.queryUsersByFieldLimit(ctx, field, keyword, limit)
		if err != nil {
			// 某个字段不被接受时继续尝试下一个，两个字段都失败才上报
			if isCasdoorNotFound(err) {
				continue
			}
			return nil, err
		}
		for i := range users {
			u := users[i]
			if u.Name == "" {
				continue
			}
			if _, ok := seen[u.Name]; ok {
				continue
			}
			seen[u.Name] = struct{}{}
			out = append(out, u)
			if len(out) >= limit {
				return out, nil
			}
		}
	}
	if len(out) > 0 {
		return out, nil
	}
	return c.searchUsersLocally(ctx, keyword, limit)
}

// searchUsersLocally 拉一页用户后本地做包含匹配
func (c *CasdoorClient) searchUsersLocally(ctx context.Context, keyword string, limit int) ([]CasdoorUser, error) {
	users, err := c.cachedUsers(ctx)
	if err != nil {
		return nil, err
	}
	kw := strings.ToLower(keyword)
	out := make([]CasdoorUser, 0, limit)
	for i := range users {
		u := users[i]
		if u.Name == "" {
			continue
		}
		if strings.Contains(strings.ToLower(u.Name), kw) ||
			strings.Contains(strings.ToLower(u.DisplayName), kw) {
			out = append(out, u)
			if len(out) >= limit {
				break
			}
		}
	}
	return out, nil
}

// cachedUsers 带 TTL 的用户列表缓存，回退路径专用
func (c *CasdoorClient) cachedUsers(ctx context.Context) ([]CasdoorUser, error) {
	c.userListMu.Lock()
	if c.userListCache != nil && time.Since(c.userListAt) < userListCacheTTL {
		cached := c.userListCache
		c.userListMu.Unlock()
		return cached, nil
	}
	c.userListMu.Unlock()

	users, err := c.listUsers(ctx, localUserScanLimit)
	if err != nil {
		return nil, err
	}

	c.userListMu.Lock()
	c.userListCache = users
	c.userListAt = time.Now()
	c.userListMu.Unlock()
	return users, nil
}

// listUsers 拉取组织下的一页用户
func (c *CasdoorClient) listUsers(ctx context.Context, pageSize int) ([]CasdoorUser, error) {
	if pageSize <= 0 {
		pageSize = 100
	}
	path := fmt.Sprintf("/api/get-users?owner=%s&pageSize=%d&p=1",
		url.QueryEscape(c.cfg.Organization), pageSize)
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
	return users, nil
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
		if isCasdoorNotFound(err) {
			return nil, ErrCasdoorUserNotFound
		}
		return nil, err
	}
	if err := checkStatus(cr); err != nil {
		if isCasdoorNotFound(err) {
			return nil, ErrCasdoorUserNotFound
		}
		return nil, err
	}
	var user CasdoorUser
	if err := json.Unmarshal(cr.Data, &user); err != nil {
		return nil, fmt.Errorf("decode user: %w", err)
	}
	if user.Name == "" {
		return nil, ErrCasdoorUserNotFound
	}
	return &user, nil
}

// GetUserProfile 按用户名取用户资料
func (c *CasdoorClient) GetUserProfile(ctx context.Context, username string) (*CasdoorUser, error) {
	if username == "" {
		return nil, ErrCasdoorUserNotFound
	}
	return c.GetUser(ctx, c.cfg.Organization, username)
}

// GetUserEmail 按用户名查询邮箱
func (c *CasdoorClient) GetUserEmail(ctx context.Context, username string) (string, error) {
	if username == "" {
		return "", nil
	}
	u, err := c.GetUser(ctx, c.cfg.Organization, username)
	if err != nil {
		return "", err
	}
	if u == nil {
		return "", nil
	}
	return u.Email, nil
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

// ResetEmailOrPhone 修改当前登录用户的邮箱 / 手机号。
func (c *CasdoorClient) ResetEmailOrPhone(ctx context.Context, destType, dest, code, accessToken string, sessionCookies []*http.Cookie) error {
	form := url.Values{}
	form.Set("type", destType)
	form.Set("dest", dest)
	form.Set("code", code)

	logrus.WithFields(logrus.Fields{
		"type":       destType,
		"dest":       dest,
		"has_token":  accessToken != "",
		"has_cookie": len(sessionCookies) > 0,
	}).Info("casdoor reset-email-or-phone request")

	var cr *casdoorResponse
	var err error
	if accessToken != "" {
		cr, err = c.doWithBearer(ctx, "POST", "/api/reset-email-or-phone", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded", accessToken)
	} else if len(sessionCookies) > 0 {
		cr, _, err = c.doWithBasicAuthWithCookieJar(ctx, "POST", "/api/reset-email-or-phone", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded", sessionCookies)
	} else {
		return errors.New("缺少 Casdoor 用户身份凭证，请重新登录")
	}
	if err != nil {
		return err
	}
	if err := checkStatus(cr); err != nil {
		logrus.WithFields(logrus.Fields{
			"error":       err,
			"casdoor_msg": cr.Msg,
		}).Warn("casdoor reset-email-or-phone failed")
		return fmt.Errorf("%w: %s", err, cr.Msg)
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

// VerifyCode 校验验证码，并把 verifiedCode 写入 Casdoor Session。
func (c *CasdoorClient) VerifyCode(ctx context.Context, checkType, dest, name, code string, cookies []*http.Cookie) ([]*http.Cookie, error) {
	payload := map[string]any{
		"organization": c.cfg.Organization,
		"username":     dest,
		"name":         name,
		"code":         code,
		"checkType":    checkType,
		"type":         checkType,
	}
	jsonBody, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	logrus.WithFields(logrus.Fields{
		"checkType": checkType,
		"dest":      dest,
		"name":      name,
		"code_len":  len(code),
		"cookies":   len(cookies),
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
		return nil, fmt.Errorf("%w: %s", err, cr.Msg)
	}
	logrus.WithFields(logrus.Fields{
		"input":  len(cookies),
		"output": len(respCookies),
	}).Info("casdoor verify-code ok, cookies")
	return respCookies, nil
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

// UploadAvatar 上传用户头像，返回头像 URL。
func (c *CasdoorClient) UploadAvatar(ctx context.Context, fileBytes []byte, storedName, username string) (string, error) {
	fullFilePath := "avatar/" + c.cfg.Organization + "/" + storedName

	q := url.Values{}
	q.Set("owner", c.cfg.Organization)
	q.Set("user", username)
	q.Set("application", c.cfg.Application)
	q.Set("tag", "avatar")
	q.Set("parent", c.cfg.Organization+"/"+username)
	q.Set("fullFilePath", "/"+fullFilePath)
	apiPath := "/api/upload-resource?" + q.Encode()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile("file", storedName)
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
		"filename":     storedName,
		"fullFilePath": fullFilePath,
	}).Info("casdoor upload-resource request")
	cr, err := c.doRequestWithMultipart(ctx, apiPath, writer, body)
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
