package pkg

import (
	"strconv"
	"strings"
)

// ParseInt 解析整数参数，失败返回默认值
func ParseInt(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

// Clamp 将 n 限制在 [min, max] 区间
func Clamp(n, min, max int) int {
	if n < min {
		return min
	}
	if n > max {
		return max
	}
	return n
}

// IsValidFolder 校验 folder 是否合法
func IsValidFolder(folder string) bool {
	switch folder {
	case "raw-lyrics", "ncm-lyrics", "qq-lyrics", "spotify-lyrics", "am-lyrics":
		return true
	}
	return false
}

// IsValidPlatform 校验 platform 是否合法
func IsValidPlatform(p string) bool {
	switch p {
	case "ncm", "qq", "spotify", "apple":
		return true
	}
	return false
}

// FolderToPlatform folder 名称转 platform 标识
// ncm-lyrics -> ncm, am-lyrics -> apple, etc.
func FolderToPlatform(folder string) string {
	switch folder {
	case "raw-lyrics":
		return ""
	case "ncm-lyrics":
		return "ncm"
	case "qq-lyrics":
		return "qq"
	case "spotify-lyrics":
		return "spotify"
	case "am-lyrics":
		return "apple"
	}
	return ""
}

// IsHTTPRequestIDEmpty 用于判断 request id 是否已生成
func IsHTTPRequestIDEmpty(s string) bool { return strings.TrimSpace(s) == "" }
