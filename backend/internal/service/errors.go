package service

import "errors"

// 通用typed error

// ErrAccountLocked 账户被锁定（登录失败次数过多）
var ErrAccountLocked = errors.New("account locked")

// ErrInvalidCredentials 用户名或密码错误 / 验证码错误
var ErrInvalidCredentials = errors.New("invalid credentials")

// ErrInvalidCode 验证码错误
var ErrInvalidCode = errors.New("invalid verification code")

// ErrCodeExpired 验证码已失效（已被使用或已过期，需重新获取）
var ErrCodeExpired = errors.New("verification code expired")

// ErrSendCodeCooldown 验证码发送冷却中
var ErrSendCodeCooldown = errors.New("send code cooldown")

// ErrUserAlreadyExists 用户名/邮箱已存在
var ErrUserAlreadyExists = errors.New("user already exists")

// ErrUserNotFound 用户不存在（用于找回密码等场景）
var ErrUserNotFound = errors.New("user not found")

// ErrInvalidInput 输入参数非法（业务层校验失败）
var ErrInvalidInput = errors.New("invalid input")

// ErrUpstreamUnavailable 上游服务不可用或返回错误
// 用于 NCM API / Meilisearch / GitHub API / 在线搜索 provider 等外部依赖失败
var ErrUpstreamUnavailable = errors.New("upstream unavailable")

// ErrNotFound 通用未找到（service 层未提供更具体类型时使用）
var ErrNotFound = errors.New("not found")

// 投稿模块

// ErrSubmissionNotFound 投稿不存在
var ErrSubmissionNotFound = errors.New("submission not found")

// ErrMissingFile 缺少文件
var ErrMissingFile = errors.New("missing file")

// ErrFileNotFound 文件不存在
var ErrFileNotFound = errors.New("file not found in object storage")

// ErrInvalidStatus 投稿状态不允许该操作
var ErrInvalidStatus = errors.New("invalid submission status for this action")

// ErrForbidden 无权操作该投稿
var ErrForbidden = errors.New("forbidden")

// 歌词/索引模块

// ErrLyricNotFound 歌词未找到
var ErrLyricNotFound = errors.New("lyric not found")

// ErrIndexNotFound 索引文件未找到
var ErrIndexNotFound = errors.New("index file not found")

// 未找到上报模块

// ErrInvalidParameter 参数错误
var ErrInvalidParameter = errors.New("invalid parameter")

// 每日推荐模块

// ErrDailyRecNotFound 每日推荐未找到
var ErrDailyRecNotFound = errors.New("daily recommendation not found")

// 搜索IP模块

// ErrImageNotFound 图片未找到
var ErrImageNotFound = errors.New("search ip image not found")
