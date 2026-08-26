package pkg

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Response 统一 JSON 响应
type Response struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

// OK 成功响应
func OK(c *gin.Context, data any) {
	c.JSON(http.StatusOK, Response{
		Code:    http.StatusOK,
		Message: "success",
		Data:    data,
	})
}

// OKWithMsg 自定义 message 的成功响应
func OKWithMsg(c *gin.Context, data any, message string) {
	c.JSON(http.StatusOK, Response{
		Code:    http.StatusOK,
		Message: message,
		Data:    data,
	})
}

// Fail 失败响应
func Fail(c *gin.Context, httpCode, code int, message string) {
	c.JSON(httpCode, Response{
		Code:    code,
		Message: message,
	})
}

// BadRequest 400
func BadRequest(c *gin.Context, message string) {
	Fail(c, http.StatusBadRequest, http.StatusBadRequest, message)
}

// Unauthorized 401 未登录
func Unauthorized(c *gin.Context) {
	Fail(c, http.StatusUnauthorized, http.StatusUnauthorized, "未登录")
}

// Forbidden 403 无权限
func Forbidden(c *gin.Context) {
	Fail(c, http.StatusForbidden, http.StatusForbidden, "无权限")
}

// NotFound 404
func NotFound(c *gin.Context, message string) {
	Fail(c, http.StatusNotFound, http.StatusNotFound, message)
}

// InternalError 500
func InternalError(c *gin.Context, message string) {
	Fail(c, http.StatusInternalServerError, http.StatusInternalServerError, message)
}
