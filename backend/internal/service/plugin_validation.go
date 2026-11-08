package service

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

// PluginIssue 校验问题（path 与 tool 的 ParseIssue 对齐）
type PluginIssue struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// PluginContainerKind 容器类型
const (
	PluginKindTrustedJS = "trusted-js"
	PluginKindTheme     = "theme"
)

// PluginValidationResult 插件包校验结果
type PluginValidationResult struct {
	OK       bool           `json:"ok"`
	Kind     string         `json:"kind"`
	Manifest map[string]any `json:"manifest"`
	Issues   []PluginIssue  `json:"issues"`
	// Entry 包内入口文件相对路径（trusted-js 为 manifest.entry，theme 为 manifest.tokens）
	Entry string `json:"entry"`
	// ResourceEntries 包内声明的资源文件（resources/<entry>）
	ResourceEntries []string `json:"resourceEntries"`
}

// PluginContainerLimits 容器上限
type PluginContainerLimits struct {
	MaxContainerBytes int64
	MaxTotalBytes     int64
	MaxEntryBytes     int64
	MaxManifestBytes  int64
	MaxEntries        int
}

var zipMagic = []byte{0x50, 0x4b, 0x03, 0x04}

// PluginValidator 插件包校验器。
type PluginValidator struct {
	limits PluginContainerLimits
}

func NewPluginValidator(limits PluginContainerLimits) *PluginValidator {
	if limits.MaxContainerBytes <= 0 {
		limits.MaxContainerBytes = 48 << 20
	}
	if limits.MaxTotalBytes <= 0 {
		limits.MaxTotalBytes = 64 << 20
	}
	if limits.MaxEntryBytes <= 0 {
		limits.MaxEntryBytes = 33 << 20
	}
	if limits.MaxManifestBytes <= 0 {
		limits.MaxManifestBytes = 4 << 20
	}
	if limits.MaxEntries <= 0 {
		limits.MaxEntries = 64
	}
	return &PluginValidator{limits: limits}
}

func pluginFail(issues ...PluginIssue) *PluginValidationResult {
	if len(issues) == 0 {
		issues = []PluginIssue{{Path: "/", Message: "包校验未通过"}}
	}
	return &PluginValidationResult{OK: false, Issues: issues}
}

func pluginFailMsg(message string) *PluginValidationResult {
	return pluginFail(PluginIssue{Path: "/", Message: message})
}

// Validate 校验一个 ZIP 容器
func (v *PluginValidator) Validate(data []byte) *PluginValidationResult {
	if int64(len(data)) > v.limits.MaxContainerBytes {
		return pluginFailMsg("插件包超过大小限制")
	}
	switch detectPluginContainer(data) {
	case "zip":
		return v.validateZipReader(bytes.NewReader(data), int64(len(data)))
	case "json":
		return pluginFailMsg("只接受 ZIP 插件包，不支持 JSON 容器")
	default:
		return pluginFailMsg("无法识别的插件包格式（需要 ZIP）")
	}
}

// ValidateFile 流式校验磁盘上的 ZIP，避免把整包读进内存
func (v *PluginValidator) ValidateFile(path string) (*PluginValidationResult, int64, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, 0, err
	}
	if info.Size() > v.limits.MaxContainerBytes {
		return pluginFailMsg("插件包超过大小限制"), info.Size(), nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, 0, err
	}
	defer f.Close()

	prefix := make([]byte, 64)
	n, err := f.Read(prefix)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, 0, err
	}
	switch detectPluginContainer(prefix[:n]) {
	case "zip":
		return v.validateZipReader(f, info.Size()), info.Size(), nil
	case "json":
		return pluginFailMsg("只接受 ZIP 插件包，不支持 JSON 容器"), info.Size(), nil
	default:
		return pluginFailMsg("无法识别的插件包格式"), info.Size(), nil
	}
}

// detectPluginContainer 只看 magic bytes：ZIP 头或首个非空白字节 `{`
func detectPluginContainer(data []byte) string {
	if len(data) >= len(zipMagic) && bytes.Equal(data[:len(zipMagic)], zipMagic) {
		return "zip"
	}
	for _, b := range data {
		switch b {
		case 0xef, 0xbb, 0xbf, 0x20, 0x09, 0x0a, 0x0d:
			continue
		}
		if b == '{' {
			return "json"
		}
		return "unknown"
	}
	return "unknown"
}

// validateEntryName 与 tool 的 validateEntryName 规则一致
func validateEntryName(name string) error {
	if name == "" {
		return errors.New("zip contains an entry with an empty name")
	}
	if strings.Contains(name, `\`) {
		return fmt.Errorf("zip entry %q uses backslash separators", name)
	}
	if strings.HasPrefix(name, "/") {
		return fmt.Errorf("zip entry %q is an absolute path", name)
	}
	segments := strings.Split(name, "/")
	for _, seg := range segments {
		if seg == "." || seg == ".." {
			return fmt.Errorf("zip entry %q contains dot segments", name)
		}
	}
	if !strings.HasSuffix(name, "/") {
		for _, seg := range segments {
			if seg == "" {
				return fmt.Errorf("zip entry %q has empty segments", name)
			}
		}
	}
	return nil
}

func (v *PluginValidator) validateZipReader(r io.ReaderAt, size int64) *PluginValidationResult {
	reader, err := zip.NewReader(r, size)
	if err != nil {
		return pluginFailMsg("zip archive is corrupt or unsupported")
	}

	seen := make(map[string]struct{}, len(reader.File))
	files := make(map[string][]byte, len(reader.File))
	var totalBytes int64
	entryCount := 0

	for _, f := range reader.File {
		name := f.Name
		if err := validateEntryName(name); err != nil {
			return pluginFailMsg(err.Error())
		}
		if _, dup := seen[name]; dup {
			return pluginFailMsg(fmt.Sprintf("zip contains duplicate entry %q", name))
		}
		seen[name] = struct{}{}
		if strings.HasSuffix(name, "/") {
			continue
		}
		entryCount++
		if entryCount > v.limits.MaxEntries {
			return pluginFailMsg("zip contains too many entries")
		}
		if int64(f.UncompressedSize64) > v.limits.MaxEntryBytes {
			return pluginFailMsg(fmt.Sprintf("zip entry %q exceeds the size limit", name))
		}
		totalBytes += int64(f.UncompressedSize64)
		if totalBytes > v.limits.MaxTotalBytes {
			return pluginFailMsg("zip expands beyond the total size limit")
		}

		content, err := readZipEntry(f, v.limits.MaxEntryBytes, v.limits.MaxTotalBytes)
		if err != nil {
			return pluginFailMsg(err.Error())
		}
		// 实际读取量再次校验，防止头部声明与实际内容不一致
		totalBytes += int64(len(content)) - int64(f.UncompressedSize64)
		if totalBytes > v.limits.MaxTotalBytes {
			return pluginFailMsg("zip expands beyond the total size limit")
		}
		files[name] = content
	}

	manifestBytes, ok := files["manifest.json"]
	if !ok {
		return pluginFailMsg("zip is missing manifest.json at the archive root")
	}
	if int64(len(manifestBytes)) > v.limits.MaxManifestBytes {
		return pluginFailMsg("manifest.json exceeds the size limit")
	}

	var descriptor map[string]any
	if err := json.Unmarshal(manifestBytes, &descriptor); err != nil {
		return pluginFailMsg("manifest.json is not valid JSON")
	}
	if descriptor == nil {
		return pluginFailMsg("manifest.json must be a JSON object")
	}

	manifestRaw, ok := descriptor["manifest"]
	if !ok {
		return pluginFailMsg("manifest.json is missing a manifest object")
	}
	manifest, ok := manifestRaw.(map[string]any)
	if !ok || manifest == nil {
		return pluginFailMsg("manifest.json is missing a manifest object")
	}

	kind, _ := manifest["kind"].(string)
	if kind != "function" && kind != "theme" {
		return pluginFailMsg(fmt.Sprintf("manifest kind must be \"function\" or \"theme\", got %v", manifest["kind"]))
	}
	if pkgVersion, exists := descriptor["packageVersion"]; exists {
		if n, ok := pkgVersion.(float64); !ok || n != 0 {
			return pluginFailMsg("packageVersion must be 0")
		}
	}
	if _, inline := descriptor["resources"]; inline {
		return pluginFailMsg("ZIP resources must be separate files, not inline descriptor resources")
	}
	if _, modes := lookupContributes(manifest, "modes"); modes {
		return pluginFailMsg("mode (main page) contributions are reserved for trusted builtin scopes and cannot be declared by plugin manifests")
	}

	issues := validatePluginManifest(manifest)
	if len(issues) > 0 {
		return pluginFail(issues...)
	}

	if kind == "function" {
		if runtime, _ := manifest["runtime"].(string); runtime != "trusted-js" {
			return pluginFailMsg("function packages must use the trusted-js runtime")
		}
		return v.assembleTrustedJS(descriptor, manifest, files)
	}
	return v.assembleTheme(descriptor, manifest, files)
}

func readZipEntry(f *zip.File, maxEntry, maxTotal int64) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, fmt.Errorf("zip archive is corrupt or unsupported")
	}
	defer rc.Close()
	limit := maxEntry
	if maxTotal > 0 && maxTotal < limit {
		limit = maxTotal
	}
	content, err := io.ReadAll(io.LimitReader(rc, limit+1))
	if err != nil {
		return nil, fmt.Errorf("zip archive is corrupt or unsupported")
	}
	if int64(len(content)) > limit {
		return nil, fmt.Errorf("zip entry %q exceeds the size limit", f.Name)
	}
	return content, nil
}
