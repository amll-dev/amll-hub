package service

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

func (v *PluginValidator) assembleTheme(
	descriptor map[string]any,
	manifest map[string]any,
	files map[string][]byte,
) *PluginValidationResult {
	pkgVersion, ok := descriptor["packageVersion"].(float64)
	if !ok || pkgVersion != 0 {
		return pluginFailMsg("theme descriptor packageVersion must be 0")
	}
	tokens, ok := descriptor["tokens"]
	if !ok || tokens == nil {
		return pluginFailMsg("theme descriptor is missing tokens")
	}
	if _, ok := tokens.(map[string]any); !ok {
		return pluginFailMsg("theme descriptor tokens must be an object")
	}
	if tv, ok := tokens.(map[string]any)["tokenVersion"]; ok {
		if n, ok := tv.(float64); !ok || n != 0 {
			return pluginFailMsg("theme tokenVersion must be 0")
		}
	} else {
		return pluginFailMsg("theme tokens is missing tokenVersion")
	}

	expected := map[string]struct{}{"manifest.json": {}}
	resourceEntries := collectResourceEntries(manifest)
	for _, res := range resourceEntries {
		path := "resources/" + res
		if _, ok := files[path]; !ok {
			return pluginFailMsg(fmt.Sprintf("zip is missing package resource %s", path))
		}
		if !utf8.Valid(files[path]) {
			return pluginFailMsg(fmt.Sprintf("package resource %s must be valid UTF-8 JSON", path))
		}
		expected[path] = struct{}{}
	}

	styles, stylesPresent := descriptor["styles"].(map[string]any)
	declaredStyles := manifestStringSlice(manifest, "styles")
	if len(declaredStyles) > 0 {
		if !stylesPresent {
			return pluginFailMsg("theme descriptor is missing styles declared by the manifest")
		}
		declared := make(map[string]struct{}, len(declaredStyles))
		for _, path := range declaredStyles {
			declared[path] = struct{}{}
			if _, ok := styles[path]; !ok {
				return pluginFailMsg(fmt.Sprintf("zip style %s is declared by the manifest but missing from the descriptor", path))
			}
		}
		for path, raw := range styles {
			if _, ok := declared[path]; !ok {
				return pluginFailMsg(fmt.Sprintf("theme descriptor carries undeclared style %s", path))
			}
			if !relativePackagePath(path) {
				return pluginFailMsg(fmt.Sprintf("theme style path %s must be package-relative", path))
			}
			css, ok := raw.(string)
			if !ok {
				return pluginFailMsg(fmt.Sprintf("theme style %s must be a CSS string", path))
			}
			if len(css) > 131072 {
				return pluginFailMsg(fmt.Sprintf("theme style %s exceeds the size limit", path))
			}
		}
	} else if stylesPresent && len(styles) > 0 {
		return pluginFailMsg("theme descriptor carries styles the manifest does not declare")
	}

	assets, _ := descriptor["assets"].(map[string]any)
	for name, raw := range assets {
		if len(name) > 64 || !themeAssetNamePattern.MatchString(name) {
			return pluginFailMsg(fmt.Sprintf("invalid asset name %q", name))
		}
		path := "assets/" + name
		content, ok := files[path]
		if !ok {
			return pluginFailMsg(fmt.Sprintf("zip is missing the theme asset %s", path))
		}
		if len(content) > 2<<20 {
			return pluginFailMsg(fmt.Sprintf("theme asset %s exceeds the size limit", path))
		}
		if meta, ok := raw.(map[string]any); ok {
			if mime, ok := meta["mime"].(string); ok && !themeAssetMIMEAllowed(mime) {
				return pluginFailMsg(fmt.Sprintf("theme asset %s has an unsupported mime type", name))
			}
		}
		expected[path] = struct{}{}
	}

	if extras := extraEntries(files, expected); len(extras) > 0 {
		return pluginFailMsg("zip contains entries outside the fixed layout: " + strings.Join(extras, ", "))
	}

	return &PluginValidationResult{
		OK:              true,
		Kind:            PluginKindTheme,
		Manifest:        manifest,
		Issues:          nil,
		Entry:           manifestString(manifest, "tokens"),
		ResourceEntries: resourceEntries,
	}
}

var themeAssetNamePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]*$`)

func themeAssetMIMEAllowed(mime string) bool {
	switch mime {
	case "image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml",
		"font/woff2", "font/woff", "font/ttf", "font/otf":
		return true
	}
	return false
}
