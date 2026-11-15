package service

import (
	"errors"

	"github.com/amll-dev/amll-hub/backend/internal/infrastructure"
)

// 认证服务新增的业务错误与错误归一化哨兵集中放在本文件，
// 不动其它模块共享的 errors.go。

// ErrWeakPassword 密码不满足本地强度规则（长度 8~128、至少含字母和数字）
var ErrWeakPassword = errors.New("weak password")

// ErrMfaMethodEnabled 该 MFA 因子已启用，不允许重走 setup 静默换绑
var ErrMfaMethodEnabled = errors.New("mfa method already enabled")

// Casdoor 上游错误的语义哨兵。业务函数只对 normalizeCasdoorErr 的返回值做
// errors.Is 判断，不再各自对 err.Error() 做 strings.Contains；
// 具体的文案 / 错误码匹配集中在 infrastructure.ClassifyCasdoorErr 一处。
var (
	errCasdoorNotFound      = errors.New("casdoor/not-found")
	errCasdoorAlreadyExists = errors.New("casdoor/already-exists")
	errCasdoorCaptcha       = errors.New("casdoor/captcha")
	errCasdoorInvalidCode   = errors.New("casdoor/invalid-code")
	errCasdoorCodeExpired   = errors.New("casdoor/code-expired")
	errCasdoorProviderSMS   = errors.New("casdoor/provider-sms")
	errCasdoorProviderEmail = errors.New("casdoor/provider-email")
	errCasdoorInvalidPhone  = errors.New("casdoor/invalid-phone")
	errCasdoorInvalidInput  = errors.New("casdoor/invalid-input")
	errCasdoorUnauthorized  = errors.New("casdoor/unauthorized")
	errCasdoorMfaSession    = errors.New("casdoor/mfa-session")
	errCasdoorOther         = errors.New("casdoor/other")
)

// normalizeCasdoorErr 把 Casdoor 上游错误归一成一组可组合的语义哨兵。
// 用 errors.Join 让一个错误同时命中多类（例如既「验证码过期」又含「code」），
// 由各业务函数按自己的优先级用 errors.Is 挑选。
func normalizeCasdoorErr(err error) error {
	if err == nil {
		return nil
	}
	flags := infrastructure.ClassifyCasdoorErr(err)
	var kinds []error
	add := func(on bool, e error) {
		if on {
			kinds = append(kinds, e)
		}
	}
	add(flags&infrastructure.CasdoorErrFlagNotFound != 0, errCasdoorNotFound)
	add(flags&infrastructure.CasdoorErrFlagAlreadyExists != 0, errCasdoorAlreadyExists)
	add(flags&infrastructure.CasdoorErrFlagCaptcha != 0, errCasdoorCaptcha)
	add(flags&infrastructure.CasdoorErrFlagInvalidCode != 0, errCasdoorInvalidCode)
	add(flags&infrastructure.CasdoorErrFlagCodeExpired != 0, errCasdoorCodeExpired)
	add(flags&infrastructure.CasdoorErrFlagProviderSMS != 0, errCasdoorProviderSMS)
	add(flags&infrastructure.CasdoorErrFlagProviderEmail != 0, errCasdoorProviderEmail)
	add(flags&infrastructure.CasdoorErrFlagInvalidPhone != 0, errCasdoorInvalidPhone)
	add(flags&infrastructure.CasdoorErrFlagInvalidInput != 0, errCasdoorInvalidInput)
	add(flags&infrastructure.CasdoorErrFlagUnauthorized != 0, errCasdoorUnauthorized)
	add(flags&infrastructure.CasdoorErrFlagMfaSession != 0, errCasdoorMfaSession)
	if len(kinds) == 0 {
		return errCasdoorOther
	}
	return errors.Join(kinds...)
}
