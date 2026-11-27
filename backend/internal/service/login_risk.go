package service

import (
	"context"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"

	"github.com/amll-dev/amll-hub/backend/internal/infrastructure"
)

const (
	// loginRiskTTL 设备/地点记录的保留时长
	loginRiskTTL = 180 * 24 * time.Hour
)

// SecurityNotice 新设备/异地登录的站内通知素材
type SecurityNotice struct {
	// Type new_device / new_location
	Type     string `json:"type"`
	Device   string `json:"device,omitempty"`
	Location string `json:"location,omitempty"`
	IP       string `json:"ip,omitempty"`
	Time     string `json:"time"`
}

// LoginRiskService 新设备/异地登录的站内通知判定。
//
// 与 Casdoor 的 CheckSigninRisk 相互独立：Casdoor 负责邮件（仅 /api/login 链路），
// 这里负责所有登录方式的站内通知，两边使用同一个 deviceId 与客户端 IP。
type LoginRiskService struct {
	rdb     *redis.Client
	locator ipLocationFinder
}

// NewLoginRiskService 创建风险服务；ipDBFile 为空或加载失败时退化为网段判定
func NewLoginRiskService(rdb *redis.Client, ipDBFile string) *LoginRiskService {
	s := &LoginRiskService{rdb: rdb}
	if ipDBFile != "" {
		loc, err := newIPLocator(ipDBFile)
		if err != nil {
			logrus.WithError(err).Warnf("load ip database %s failed, fallback to network prefix", ipDBFile)
		} else {
			s.locator = loc
		}
	}
	return s
}

func loginDeviceKey(userID string) string   { return "auth:devices:" + userID }
func loginLocationKey(userID string) string { return "auth:locations:" + userID }

// Evaluate 判断本次登录是否属于新设备/新地点，并把本次登录记录到 Redis。
// 首次登录只记录不通知；同一设备/地点只通知一次。
func (s *LoginRiskService) Evaluate(ctx context.Context, userID string, meta infrastructure.LoginMeta) []SecurityNotice {
	if s == nil || s.rdb == nil || userID == "" {
		return nil
	}

	ip := normalizeClientIP(meta.ClientIP)
	if ip == "" {
		return nil
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return nil
	}

	// 私网 / 回环 IP（反向代理地址、内网直连）解析不出地区，
	// 只保留设备维度判定，避免整条提醒链路因为拿不到公网 IP 而完全静默
	location := ""
	if !parsed.IsLoopback() && !parsed.IsPrivate() && !parsed.IsLinkLocalUnicast() {
		location = s.resolveLocation(ip)
	}

	deviceID := strings.TrimSpace(meta.DeviceID)
	if deviceID == "" && location == "" {
		return nil
	}

	deviceKey := loginDeviceKey(userID)
	locationKey := loginLocationKey(userID)

	deviceCount, err := s.rdb.HLen(ctx, deviceKey).Result()
	if err != nil {
		logrus.WithError(err).Warn("read login devices failed")
		return nil
	}
	locationCount, err := s.rdb.SCard(ctx, locationKey).Result()
	if err != nil {
		logrus.WithError(err).Warn("read login locations failed")
		return nil
	}
	firstLogin := deviceCount == 0 && locationCount == 0

	newDevice := false
	if deviceID != "" {
		known, err := s.rdb.HExists(ctx, deviceKey, deviceID).Result()
		if err != nil {
			logrus.WithError(err).Warn("check login device failed")
		} else {
			newDevice = !known
		}
	}

	newLocation := false
	if location != "" {
		known, err := s.rdb.SIsMember(ctx, locationKey, location).Result()
		if err != nil {
			logrus.WithError(err).Warn("check login location failed")
		} else {
			newLocation = !known
		}
	}

	now := time.Now()
	deviceName := describeUserAgent(meta.UserAgent)

	var notices []SecurityNotice
	if !firstLogin {
		if newDevice {
			notices = append(notices, SecurityNotice{
				Type:     "new_device",
				Device:   deviceName,
				Location: location,
				IP:       ip,
				Time:     now.Format(time.RFC3339),
			})
		}
		if newLocation {
			notices = append(notices, SecurityNotice{
				Type:     "new_location",
				Device:   deviceName,
				Location: location,
				IP:       ip,
				Time:     now.Format(time.RFC3339),
			})
		}
	}

	if deviceID != "" {
		if err := s.rdb.HSet(ctx, deviceKey, deviceID, now.Unix()).Err(); err == nil {
			_ = s.rdb.Expire(ctx, deviceKey, loginRiskTTL).Err()
		}
	}
	if location != "" {
		if err := s.rdb.SAdd(ctx, locationKey, location).Err(); err == nil {
			_ = s.rdb.Expire(ctx, locationKey, loginRiskTTL).Err()
		}
	}

	return notices
}

// resolveLocation 国家 省 市；没有 IP 库时退化为 /16 或 /48 网段
func (s *LoginRiskService) resolveLocation(ip string) string {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return ""
	}

	if s.locator != nil && parsed.To4() != nil {
		country, region, city := s.locator.find(ip)
		if country != "" || region != "" || city != "" {
			return strings.TrimSpace(strings.Join([]string{country, region, city}, " "))
		}
	}

	if v4 := parsed.To4(); v4 != nil {
		return fmt.Sprintf("%d.%d.0.0/16", v4[0], v4[1])
	}
	return fmt.Sprintf("%s/48", parsed.Mask(net.CIDRMask(48, 128)).String())
}

// normalizeClientIP 去掉端口，兼容 X-Forwarded-For 里带多个地址的情况
func normalizeClientIP(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if idx := strings.IndexByte(raw, ','); idx >= 0 {
		raw = strings.TrimSpace(raw[:idx])
	}
	if host, _, err := net.SplitHostPort(raw); err == nil {
		raw = host
	}
	return strings.Trim(raw, "[]")
}

// describeUserAgent 生成便于展示的设备名称，如 "Chrome / Windows"
func describeUserAgent(ua string) string {
	if ua == "" {
		return "未知设备"
	}
	browser := ""
	switch {
	case strings.Contains(ua, "Edg/"):
		browser = "Edge"
	case strings.Contains(ua, "OPR/") || strings.Contains(ua, "Opera"):
		browser = "Opera"
	case strings.Contains(ua, "Firefox/"):
		browser = "Firefox"
	case strings.Contains(ua, "Chrome/") || strings.Contains(ua, "Chromium"):
		browser = "Chrome"
	case strings.Contains(ua, "Safari/"):
		browser = "Safari"
	}

	osName := ""
	switch {
	case strings.Contains(ua, "Windows"):
		osName = "Windows"
	case strings.Contains(ua, "Android"):
		osName = "Android"
	case strings.Contains(ua, "iPhone") || strings.Contains(ua, "iPad") || strings.Contains(ua, "iOS"):
		osName = "iOS"
	case strings.Contains(ua, "Mac OS X") || strings.Contains(ua, "Macintosh"):
		osName = "macOS"
	case strings.Contains(ua, "Linux"):
		osName = "Linux"
	}

	switch {
	case browser != "" && osName != "":
		return browser + " / " + osName
	case osName != "":
		return osName
	case browser != "":
		return browser
	default:
		return "未知设备"
	}
}
