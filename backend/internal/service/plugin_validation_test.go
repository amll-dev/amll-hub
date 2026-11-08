package service

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testLimits() PluginContainerLimits {
	return PluginContainerLimits{
		MaxContainerBytes: 48 << 20,
		MaxTotalBytes:     64 << 20,
		MaxEntryBytes:     33 << 20,
		MaxManifestBytes:  4 << 20,
		MaxEntries:        64,
	}
}

func buildTestZip(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create zip entry %s: %v", name, err)
		}
		if _, err := w.Write(content); err != nil {
			t.Fatalf("write zip entry %s: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return buf.Bytes()
}

func trustedManifest() map[string]any {
	return map[string]any{
		"id":           "test.js",
		"name":         "Test",
		"version":      "1.0.0",
		"apiVersion":   0,
		"kind":         "function",
		"runtime":      "trusted-js",
		"entry":        "index.js",
		"capabilities": []any{},
	}
}

func trustedZip(t *testing.T) []byte {
	t.Helper()
	descriptor := map[string]any{
		"packageVersion": 0,
		"manifest":       trustedManifest(),
	}
	raw, err := json.Marshal(descriptor)
	if err != nil {
		t.Fatalf("marshal descriptor: %v", err)
	}
	return buildTestZip(t, map[string][]byte{
		"manifest.json":   raw,
		"assets/index.js": []byte("export function activate() {}"),
	})
}

func themeManifest() map[string]any {
	return map[string]any{
		"id":              "test.theme",
		"name":            "Theme",
		"version":         "1.0.0",
		"kind":            "theme",
		"themeApiVersion": 0,
		"runtime":         "none",
		"appearance":      "both",
		"tokens":          "theme/tokens.json",
	}
}

func TestPluginValidator_ValidTrustedJS(t *testing.T) {
	v := NewPluginValidator(testLimits())
	result := v.Validate(trustedZip(t))
	if !result.OK {
		t.Fatalf("expected ok, got issues: %+v", result.Issues)
	}
	if result.Kind != PluginKindTrustedJS {
		t.Fatalf("kind = %q, want trusted-js", result.Kind)
	}
	if result.Manifest["id"] != "test.js" {
		t.Fatalf("manifest id = %v", result.Manifest["id"])
	}
}

func TestPluginValidator_ValidTheme(t *testing.T) {
	descriptor := map[string]any{
		"packageVersion": 0,
		"manifest":       themeManifest(),
		"tokens":         map[string]any{"tokenVersion": 0},
	}
	raw, err := json.Marshal(descriptor)
	if err != nil {
		t.Fatal(err)
	}
	v := NewPluginValidator(testLimits())
	result := v.Validate(buildTestZip(t, map[string][]byte{"manifest.json": raw}))
	if !result.OK {
		t.Fatalf("expected ok, got issues: %+v", result.Issues)
	}
	if result.Kind != PluginKindTheme {
		t.Fatalf("kind = %q, want theme", result.Kind)
	}
}

func TestPluginValidator_RejectsNonZip(t *testing.T) {
	v := NewPluginValidator(testLimits())
	if result := v.Validate([]byte(`{"manifest":{}}`)); result.OK {
		t.Fatal("JSON container must be rejected")
	}
	if result := v.Validate([]byte("not a package")); result.OK {
		t.Fatal("unknown format must be rejected")
	}
}

func TestPluginValidator_RejectsInvalidUTF8Entry(t *testing.T) {
	descriptor := map[string]any{"packageVersion": 0, "manifest": trustedManifest()}
	raw, _ := json.Marshal(descriptor)
	v := NewPluginValidator(testLimits())
	result := v.Validate(buildTestZip(t, map[string][]byte{
		"manifest.json":   raw,
		"assets/index.js": {0xff},
	}))
	if result.OK {
		t.Fatal("invalid UTF-8 entry must be rejected")
	}
}

func TestPluginValidator_RejectsMissingAndExtraFiles(t *testing.T) {
	descriptor := map[string]any{"packageVersion": 0, "manifest": trustedManifest()}
	raw, _ := json.Marshal(descriptor)
	v := NewPluginValidator(testLimits())

	missing := v.Validate(buildTestZip(t, map[string][]byte{"manifest.json": raw}))
	if missing.OK {
		t.Fatal("missing assets entry must be rejected")
	}
	extra := v.Validate(buildTestZip(t, map[string][]byte{
		"manifest.json":   raw,
		"assets/index.js": []byte("export {}"),
		"extra.txt":       []byte("x"),
	}))
	if extra.OK {
		t.Fatal("extra file must be rejected")
	}
}

func TestPluginValidator_RejectsUnsafePaths(t *testing.T) {
	descriptor := map[string]any{"packageVersion": 0, "manifest": trustedManifest()}
	raw, _ := json.Marshal(descriptor)
	v := NewPluginValidator(testLimits())
	cases := []string{
		"../assets/index.js",
		"/assets/index.js",
		`assets\index.js`,
		"assets//index.js",
	}
	for _, name := range cases {
		result := v.Validate(buildTestZip(t, map[string][]byte{
			"manifest.json": raw,
			name:            []byte("export {}"),
		}))
		if result.OK {
			t.Errorf("unsafe entry %q must be rejected", name)
		}
	}
}

func TestPluginValidator_RejectsTooManyEntries(t *testing.T) {
	descriptor := map[string]any{"packageVersion": 0, "manifest": trustedManifest()}
	raw, _ := json.Marshal(descriptor)
	files := map[string][]byte{
		"manifest.json":   raw,
		"assets/index.js": []byte("export {}"),
	}
	for i := 0; i < 64; i++ {
		files["resources/x"+strings.Repeat("a", i+1)+".json"] = []byte("{}")
	}
	v := NewPluginValidator(testLimits())
	result := v.Validate(buildTestZip(t, files))
	if result.OK {
		t.Fatal("too many entries must be rejected")
	}
}

func TestPluginValidator_RejectsReservedBuiltinRuntime(t *testing.T) {
	manifest := trustedManifest()
	manifest["runtime"] = "builtin"
	descriptor := map[string]any{"packageVersion": 0, "manifest": manifest}
	raw, _ := json.Marshal(descriptor)
	v := NewPluginValidator(testLimits())
	result := v.Validate(buildTestZip(t, map[string][]byte{
		"manifest.json":   raw,
		"assets/index.js": []byte("export {}"),
	}))
	if result.OK {
		t.Fatal("builtin runtime must be rejected for store uploads")
	}
}

func TestPluginValidator_ResourcesFromManifest(t *testing.T) {
	manifest := trustedManifest()
	manifest["overrides"] = []any{
		map[string]any{
			"pluginId": "test.target",
			"kind":     "localization",
			"entry":    "strings/zh-CN.json",
		},
	}
	manifest["dependencies"] = []any{
		map[string]any{"id": "test.target", "version": "*"},
	}
	descriptor := map[string]any{"packageVersion": 0, "manifest": manifest}
	raw, _ := json.Marshal(descriptor)
	v := NewPluginValidator(testLimits())
	ok := v.Validate(buildTestZip(t, map[string][]byte{
		"manifest.json":                raw,
		"assets/index.js":              []byte("export {}"),
		"resources/strings/zh-CN.json": []byte(`{"/commands/test.target.run/title":"运行"}`),
	}))
	if !ok.OK {
		t.Fatalf("expected resource-bearing package to pass, got %+v", ok.Issues)
	}

	missing := v.Validate(buildTestZip(t, map[string][]byte{
		"manifest.json":   raw,
		"assets/index.js": []byte("export {}"),
	}))
	if missing.OK {
		t.Fatal("missing declared resource must be rejected")
	}
}

func TestPluginValidator_ValidateFile(t *testing.T) {
	v := NewPluginValidator(testLimits())
	path := filepath.Join(t.TempDir(), "plugin.zip")
	if err := os.WriteFile(path, trustedZip(t), 0o600); err != nil {
		t.Fatal(err)
	}
	result, size, err := v.ValidateFile(path)
	if err != nil {
		t.Fatalf("ValidateFile error: %v", err)
	}
	if !result.OK {
		t.Fatalf("ValidateFile issues: %+v", result.Issues)
	}
	if size <= 0 {
		t.Fatal("expected non-zero size")
	}
}

func TestPluginValidator_SHAAndFormHelpers(t *testing.T) {
	if got := normalizePlatforms([]string{"web", "WEB", "desktop", "ios"}); len(got) != 2 {
		t.Fatalf("normalizePlatforms = %+v", got)
	}
	if got := normalizePluginTags([]string{"a", "a", "", "b"}); len(got) != 2 {
		t.Fatalf("normalizePluginTags = %+v", got)
	}
	if !IsValidPluginVersion("1.2.3-beta.1") {
		t.Fatal("semver prerelease should be valid")
	}
	if IsValidPluginVersion("1.2") {
		t.Fatal("1.2 must be invalid semver")
	}
}
