package pkg

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
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
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ParseJWT 解析并校验 JWT
func ParseJWT(tokenStr string, secret string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}
