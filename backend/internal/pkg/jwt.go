package pkg

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	jwtIssuer   = "amll-hub"
	jwtAudience = "amll-hub"
)

// Claims 自定义 JWT 声明
type Claims struct {
	Sub         string `json:"sub"`         // "{org}/{name}"，用户唯一标识
	Name        string `json:"name"`        // 用户名
	DisplayName string `json:"displayName"` // 显示名称
	Email       string `json:"email"`       // 邮箱
	Avatar      string `json:"avatar"`      // 头像 URL
	jwt.RegisteredClaims
}

// SignJWT 签发 JWT，使用 HS256
func SignJWT(claims *Claims, secret string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims.RegisteredClaims = jwt.RegisteredClaims{
		Issuer:    jwtIssuer,
		Audience:  jwt.ClaimStrings{jwtAudience},
		IssuedAt:  jwt.NewNumericDate(now),
		NotBefore: jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// UserTokenInput 签发站点 token 所需的用户身份字段
type UserTokenInput struct {
	Sub         string // "{org}/{name}"
	Name        string
	DisplayName string
	Email       string
	Avatar      string
}

// SignUserToken 按统一结构签发站点 JWT。
// 密码登录、扫码登录、GitHub 绑定登录共用这一条路径，避免各处自行拼 Claims
// 时漏填 iss/aud —— ParseJWT 会校验这两项，漏填的 token 会在鉴权时被拒。
func SignUserToken(in UserTokenInput, secret string, ttl time.Duration) (string, error) {
	return SignJWT(&Claims{
		Sub:         in.Sub,
		Name:        in.Name,
		DisplayName: in.DisplayName,
		Email:       in.Email,
		Avatar:      in.Avatar,
	}, secret, ttl)
}

// ParseJWT 解析并校验 JWT
func ParseJWT(tokenStr string, secret string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(secret), nil
	},
		jwt.WithIssuer(jwtIssuer),
		jwt.WithAudience(jwtAudience),
	)
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}
