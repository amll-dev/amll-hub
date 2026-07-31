package service

import "errors"

// 通用typed error

// ErrAccountLocked 账户被锁定（登录失败次数过多）
var ErrAccountLocked = errors.New("account locked")

// ErrInvalidCredentials 用户名或密码错误 / 验证码错误
var ErrInvalidCredentials = errors.New("invalid credentials")

// ErrSendCodeCooldown 验证码发送冷却中
var ErrSendCodeCooldown = errors.New("send code cooldown")

// ErrUserAlreadyExists 用户名/邮箱已存在
var ErrUserAlreadyExists = errors.New("user already exists")

// ErrInvalidInput 输入参数非法（业务层校验失败）
var ErrInvalidInput = errors.New("invalid input")

// ErrUpstreamUnavailable 上游服务不可用或返回错误
// 用于 NCM API / Meilisearch / GitHub API / 在线搜索 provider 等外部依赖失败
var ErrUpstreamUnavailable = errors.New("upstream unavailable")

// ErrNotFound 通用未找到（service 层未提供更具体类型时使用）
var ErrNotFound = errors.New("not found")
