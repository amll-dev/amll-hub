package service

import (
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"
)

func (v *PluginValidator) assembleTrustedJS(
	descriptor map[string]any,
	manifest map[string]any,
	files map[string][]byte,
) *PluginValidationResult {
	pkgVersion, ok := descriptor["packageVersion"].(float64)
	if !ok || pkgVersion != 0 {
		return pluginFailMsg("trusted-js descriptor packageVersion must be 0")
	}
	entry, _ := manifest["entry"].(string)
	if entry == "" {
		return pluginFailMsg("trusted-js manifest is missing an entry file name")
	}
	assetPath := "assets/" + entry
	source, ok := files[assetPath]
	if !ok {
		return pluginFailMsg(fmt.Sprintf("zip is missing the trusted-js entry %s", assetPath))
	}
	if !utf8.Valid(source) {
		return pluginFailMsg("trusted-js entry is not valid UTF-8")
	}

	expected := map[string]struct{}{
		"manifest.json": {},
		assetPath:       {},
	}
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

	if extras := extraEntries(files, expected); len(extras) > 0 {
		return pluginFailMsg("zip contains entries outside the fixed layout: " + strings.Join(extras, ", "))
	}

	return &PluginValidationResult{
		OK:              true,
		Kind:            PluginKindTrustedJS,
		Manifest:        manifest,
		Issues:          nil,
		Entry:           entry,
		ResourceEntries: resourceEntries,
	}
}

func lookupContributes(manifest map[string]any, key string) (any, bool) {
	contributes, ok := manifest["contributes"].(map[string]any)
	if !ok {
		return nil, false
	}
	v, exists := contributes[key]
	return v, exists
}

// collectResourceEntries 汇总 manifest.overrides[].entry 与 contributes.strings
func collectResourceEntries(manifest map[string]any) []string {
	seen := make(map[string]struct{})
	var out []string
	add := func(entry string) {
		if entry == "" {
			return
		}
		if _, ok := seen[entry]; ok {
			return
		}
		seen[entry] = struct{}{}
		out = append(out, entry)
	}

	if overrides, ok := manifest["overrides"].([]any); ok {
		for _, item := range overrides {
			if m, ok := item.(map[string]any); ok {
				if entry, ok := m["entry"].(string); ok {
					add(entry)
				}
			}
		}
	}
	if stringsList := manifestStringSlice(manifest, "contributes.strings"); len(stringsList) > 0 {
		for _, entry := range stringsList {
			add(entry)
		}
	}
	sort.Strings(out)
	return out
}

func extraEntries(files map[string][]byte, expected map[string]struct{}) []string {
	var extras []string
	for name := range files {
		if _, ok := expected[name]; !ok {
			extras = append(extras, name)
		}
	}
	sort.Strings(extras)
	return extras
}
