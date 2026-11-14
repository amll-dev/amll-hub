package service

import (
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"regexp"
	"strings"

	"github.com/Masterminds/semver/v3"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
)

const (
	// pluginManifestIconPrefix manifest.icon 必须是 PNG data URL
	pluginManifestIconPrefix = "data:image/png;base64,"
	// pluginManifestIconMaxChars 与上游契约一致，整串最多 65536 字符
	pluginManifestIconMaxChars = 65536
	// pluginManifestIconMaxDimension 商店侧额外的尺寸上限，防止超大图片
	pluginManifestIconMaxDimension = 2048
)

var pluginIDPattern = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$`)

// semverPattern
var semverPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$`)

// overrideEntryPattern
var overrideEntryPattern = regexp.MustCompile(`^(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.json$`)

var pluginEntryFile = regexp.MustCompile(`\.(m?js)$`)

// manifestStringSlice 读取 manifest[path] 中的字符串数组，path 用点分隔
func manifestStringSlice(manifest map[string]any, path string) []string {
	var node any = manifest
	for _, key := range strings.Split(path, ".") {
		m, ok := node.(map[string]any)
		if !ok {
			return nil
		}
		node = m[key]
	}
	arr, ok := node.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func manifestString(manifest map[string]any, key string) string {
	s, _ := manifest[key].(string)
	return s
}

// validatePluginManifest 校验 manifest 基础语义
func validatePluginManifest(manifest map[string]any) []PluginIssue {
	var issues []PluginIssue

	id, _ := manifest["id"].(string)
	if id == "" {
		issues = append(issues, PluginIssue{Path: "/manifest/id", Message: "required property is missing"})
	} else if !pluginIDPattern.MatchString(id) {
		issues = append(issues, PluginIssue{Path: "/manifest/id", Message: "must match the plugin id pattern"})
	}

	name, _ := manifest["name"].(string)
	if name == "" {
		issues = append(issues, PluginIssue{Path: "/manifest/name", Message: "required property is missing"})
	} else if pkg.UTF16Len(name) > 128 {
		issues = append(issues, PluginIssue{Path: "/manifest/name", Message: "must contain at most 128 characters"})
	}

	version, _ := manifest["version"].(string)
	if version == "" {
		issues = append(issues, PluginIssue{Path: "/manifest/version", Message: "required property is missing"})
	} else if !semverPattern.MatchString(version) {
		issues = append(issues, PluginIssue{Path: "/manifest/version", Message: "must be a semver version"})
	} else if _, err := semver.NewVersion(version); err != nil {
		issues = append(issues, PluginIssue{Path: "/manifest/version", Message: "must be a semver version"})
	}

	kind, _ := manifest["kind"].(string)
	if kind == "function" {
		apiVersion, exists := manifest["apiVersion"]
		if !exists {
			issues = append(issues, PluginIssue{Path: "/manifest/apiVersion", Message: "required property is missing"})
		} else if n, ok := apiVersion.(float64); !ok || n != 0 {
			issues = append(issues, PluginIssue{Path: "/manifest/apiVersion", Message: "expected constant 0"})
		}
		runtime, _ := manifest["runtime"].(string)
		if runtime != "trusted-js" && runtime != "builtin" {
			issues = append(issues, PluginIssue{Path: "/manifest/runtime", Message: "value is not in the allowed enum"})
		}
		entry, _ := manifest["entry"].(string)
		if entry == "" {
			issues = append(issues, PluginIssue{Path: "/manifest/entry", Message: "required property is missing"})
		} else if !relativePackagePath(entry) {
			issues = append(issues, PluginIssue{Path: "/manifest/entry", Message: "must be a package-relative path"})
		} else if runtime == "trusted-js" && !pluginEntryFile.MatchString(entry) {
			issues = append(issues, PluginIssue{Path: "/manifest/entry", Message: "trusted-js entry must be a .js or .mjs module"})
		}
		if _, ok := manifest["capabilities"].([]any); !ok {
			issues = append(issues, PluginIssue{Path: "/manifest/capabilities", Message: "required property is missing"})
		}
	} else if kind == "theme" {
		themeAPIVersion, exists := manifest["themeApiVersion"]
		if !exists {
			issues = append(issues, PluginIssue{Path: "/manifest/themeApiVersion", Message: "required property is missing"})
		} else if n, ok := themeAPIVersion.(float64); !ok || n != 0 {
			issues = append(issues, PluginIssue{Path: "/manifest/themeApiVersion", Message: "expected constant 0"})
		}
		if runtime, _ := manifest["runtime"].(string); runtime != "none" {
			issues = append(issues, PluginIssue{Path: "/manifest/runtime", Message: "expected constant \"none\""})
		}
		appearance, _ := manifest["appearance"].(string)
		if appearance != "light" && appearance != "dark" && appearance != "both" {
			issues = append(issues, PluginIssue{Path: "/manifest/appearance", Message: "value is not in the allowed enum"})
		}
		tokens, _ := manifest["tokens"].(string)
		if tokens == "" {
			issues = append(issues, PluginIssue{Path: "/manifest/tokens", Message: "required property is missing"})
		} else if !relativePackagePath(tokens) {
			issues = append(issues, PluginIssue{Path: "/manifest/tokens", Message: "must be a package-relative path"})
		}
		for i, style := range manifestStringSlice(manifest, "styles") {
			if !relativePackagePath(style) {
				issues = append(issues, PluginIssue{Path: fmt.Sprintf("/manifest/styles/%d", i), Message: "must be a package-relative path"})
			}
		}
	}

	if description, ok := manifest["description"].(string); ok && pkg.UTF16Len(description) > 4096 {
		issues = append(issues, PluginIssue{Path: "/manifest/description", Message: "must contain at most 4096 characters"})
	}
	if author, ok := manifest["author"].(string); ok && pkg.UTF16Len(author) > 256 {
		issues = append(issues, PluginIssue{Path: "/manifest/author", Message: "must contain at most 256 characters"})
	}
	if homepage, ok := manifest["homepage"].(string); ok && homepage != "" && !strings.HasPrefix(homepage, "https://") {
		issues = append(issues, PluginIssue{Path: "/manifest/homepage", Message: "must match ^https://"})
	}
	if license, ok := manifest["license"].(string); ok && pkg.UTF16Len(license) > 128 {
		issues = append(issues, PluginIssue{Path: "/manifest/license", Message: "must contain at most 128 characters"})
	}

	if overrides, ok := manifest["overrides"].([]any); ok {
		if len(overrides) > 32 {
			issues = append(issues, PluginIssue{Path: "/manifest/overrides", Message: "must contain at most 32 items"})
		}
		declared := make(map[string]struct{}, len(overrides))
		for i, item := range overrides {
			m, ok := item.(map[string]any)
			if !ok {
				issues = append(issues, PluginIssue{Path: fmt.Sprintf("/manifest/overrides/%d", i), Message: "expected type object"})
				continue
			}
			target, _ := m["pluginId"].(string)
			if !pluginIDPattern.MatchString(target) {
				issues = append(issues, PluginIssue{Path: fmt.Sprintf("/manifest/overrides/%d/pluginId", i), Message: "must match the plugin id pattern"})
			}
			if target == id {
				issues = append(issues, PluginIssue{Path: fmt.Sprintf("/manifest/overrides/%d/pluginId", i), Message: "override cannot target itself"})
			}
			overrideKind, _ := m["kind"].(string)
			if overrideKind != "localization" && overrideKind != "icons" {
				issues = append(issues, PluginIssue{Path: fmt.Sprintf("/manifest/overrides/%d/kind", i), Message: "value is not in the allowed enum"})
			}
			entry, _ := m["entry"].(string)
			if !overrideEntryPattern.MatchString(entry) {
				issues = append(issues, PluginIssue{Path: fmt.Sprintf("/manifest/overrides/%d/entry", i), Message: "must be a canonical package-relative JSON path"})
			}
			key := fmt.Sprintf("%s|%s|%s", target, overrideKind, entry)
			if _, dup := declared[key]; dup {
				issues = append(issues, PluginIssue{Path: fmt.Sprintf("/manifest/overrides/%d", i), Message: "duplicate override declaration"})
			}
			declared[key] = struct{}{}
		}
	}

	if deps, ok := manifest["dependencies"].([]any); ok {
		if len(deps) > 16 {
			issues = append(issues, PluginIssue{Path: "/manifest/dependencies", Message: "must contain at most 16 items"})
		}
		depIDs := make(map[string]struct{}, len(deps))
		for i, item := range deps {
			m, ok := item.(map[string]any)
			if !ok {
				issues = append(issues, PluginIssue{Path: fmt.Sprintf("/manifest/dependencies/%d", i), Message: "expected type object"})
				continue
			}
			depID, _ := m["id"].(string)
			if !pluginIDPattern.MatchString(depID) {
				issues = append(issues, PluginIssue{Path: fmt.Sprintf("/manifest/dependencies/%d/id", i), Message: "must match the plugin id pattern"})
			}
			if depID == id {
				issues = append(issues, PluginIssue{Path: fmt.Sprintf("/manifest/dependencies/%d/id", i), Message: "must not depend on itself"})
			}
			if _, dup := depIDs[depID]; dup {
				issues = append(issues, PluginIssue{Path: fmt.Sprintf("/manifest/dependencies/%d/id", i), Message: "duplicate dependency id"})
			}
			depIDs[depID] = struct{}{}
			rng, _ := m["version"].(string)
			if strings.TrimSpace(rng) == "" {
				issues = append(issues, PluginIssue{Path: fmt.Sprintf("/manifest/dependencies/%d/version", i), Message: "must be a non-empty semver range"})
			} else if _, err := semver.NewConstraint(rng); err != nil {
				issues = append(issues, PluginIssue{Path: fmt.Sprintf("/manifest/dependencies/%d/version", i), Message: "must be a non-empty semver range"})
			}
		}
	}

	if kind == "theme" {
		scope, ok := manifest["scope"].(map[string]any)
		if ok {
			target, _ := scope["pluginId"].(string)
			if target == id {
				issues = append(issues, PluginIssue{Path: "/manifest/scope/pluginId", Message: "scoped theme cannot target itself"})
			}
			hasRequired := false
			if deps, ok := manifest["dependencies"].([]any); ok {
				for _, item := range deps {
					if m, ok := item.(map[string]any); ok {
						if m["id"] == target {
							if optional, _ := m["optional"].(bool); !optional {
								hasRequired = true
							}
						}
					}
				}
			}
			if !hasRequired {
				issues = append(issues, PluginIssue{Path: "/manifest/scope/pluginId", Message: "scoped themes must declare a required dependency on their target plugin"})
			}
		}
	}

	if kind == "function" {
		prefix := id + "."
		contributes, _ := manifest["contributes"].(map[string]any)
		if contributes != nil {
			for _, key := range []struct{ field, path string }{
				{"commands", "id"},
				{"menus", "command"},
				{"settings", "id"},
				{"titleBarActions", "command"},
				{"formats", "id"},
			} {
				items, _ := contributes[key.field].([]any)
				for i, item := range items {
					m, ok := item.(map[string]any)
					if !ok {
						continue
					}
					value, _ := m[key.path].(string)
					if !strings.HasPrefix(value, prefix) {
						issues = append(issues, PluginIssue{
							Path:    fmt.Sprintf("/manifest/contributes/%s/%d/%s", key.field, i, key.path),
							Message: "must start with " + prefix,
						})
					}
				}
			}
			themeParts, _ := contributes["themeParts"].([]any)
			for i, item := range themeParts {
				part, _ := item.(string)
				if !strings.HasPrefix(part, prefix) || len(part) == len(prefix) {
					issues = append(issues, PluginIssue{Path: "/manifest/contributes/themeParts", Message: "theme parts must use the pluginId. prefix and a non-empty name"})
					break
				}
				_ = i
			}
		}
	}

	return issues
}

// extractManifestIcon 校验并提取 manifest.icon，成功后从 manifest 中移除该字段，
// 避免 base64 进入数据库副本和接口响应。失败时同样移除，只返回问题。
func extractManifestIcon(manifest map[string]any) ([]byte, []PluginIssue) {
	raw, exists := manifest["icon"]
	if !exists {
		return nil, nil
	}
	delete(manifest, "icon")

	value, ok := raw.(string)
	if !ok {
		return nil, []PluginIssue{{Path: "/manifest/icon", Message: "must be a string"}}
	}
	if !strings.HasPrefix(value, pluginManifestIconPrefix) {
		return nil, []PluginIssue{{Path: "/manifest/icon", Message: "must be a data:image/png;base64 URL"}}
	}
	if len(value) > pluginManifestIconMaxChars {
		return nil, []PluginIssue{{Path: "/manifest/icon", Message: "must contain at most 65536 characters"}}
	}
	payload := value[len(pluginManifestIconPrefix):]
	// StdEncoding 会忽略换行符，这里显式拒绝，保证只接受严格 base64
	if payload == "" || strings.ContainsAny(payload, "\r\n") {
		return nil, []PluginIssue{{Path: "/manifest/icon", Message: "must be valid base64"}}
	}
	data, err := base64.StdEncoding.Strict().DecodeString(payload)
	if err != nil {
		return nil, []PluginIssue{{Path: "/manifest/icon", Message: "must be valid base64"}}
	}
	ext, _, ok := DetectPluginIcon(data)
	if !ok || ext != ".png" {
		return nil, []PluginIssue{{Path: "/manifest/icon", Message: "must be a PNG image"}}
	}
	if !validPluginIconDimensions(data) {
		return nil, []PluginIssue{{Path: "/manifest/icon", Message: "must be a valid PNG image"}}
	}
	return data, nil
}

// validPluginIconDimensions 读取 PNG IHDR 宽高并限制尺寸
func validPluginIconDimensions(data []byte) bool {
	if len(data) < 24 || string(data[12:16]) != "IHDR" {
		return false
	}
	width := binary.BigEndian.Uint32(data[16:20])
	height := binary.BigEndian.Uint32(data[20:24])
	return width > 0 && height > 0 &&
		width <= pluginManifestIconMaxDimension && height <= pluginManifestIconMaxDimension
}

// relativePackagePath
func relativePackagePath(value string) bool {
	if value == "" {
		return false
	}
	if strings.HasPrefix(value, "/") || strings.HasPrefix(value, `\`) {
		return false
	}
	for _, seg := range strings.FieldsFunc(value, func(r rune) bool { return r == '/' || r == '\\' }) {
		if seg == ".." {
			return false
		}
	}
	return true
}
