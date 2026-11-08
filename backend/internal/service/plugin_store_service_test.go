package service

import (
	"strings"
	"testing"

	"github.com/amll-dev/amll-hub/backend/internal/config"
)

func TestCheckReservedID(t *testing.T) {
	s := &PluginStoreService{cfg: &config.Config{PluginStore: config.PluginStoreConfig{
		ReservedIDs: []string{"amll.builtin.metronome", "amll.builtin.*"},
	}}}
	cases := []struct {
		id       string
		reserved bool
	}{
		{"amll.builtin.metronome", true},
		{"amll.builtin.outline", true},
		{"com.example.plugin", false},
		{"amll.builtinx.foo", false},
	}
	for _, tc := range cases {
		err := s.checkReservedID(tc.id)
		if tc.reserved && err == nil {
			t.Errorf("%s should be reserved", tc.id)
		}
		if !tc.reserved && err != nil {
			t.Errorf("%s should not be reserved: %v", tc.id, err)
		}
	}
}

func TestNormalizePluginTags(t *testing.T) {
	got := normalizePluginTags([]string{"歌词", "工具", "歌词", "  ", "b", strings.Repeat("x", 40)})
	if len(got) != 3 {
		t.Fatalf("tags = %+v", got)
	}
	if got[0] != "歌词" || got[1] != "工具" || got[2] != "b" {
		t.Fatalf("tags order = %+v", got)
	}
}

func TestNormalizePlatforms(t *testing.T) {
	got := normalizePlatforms([]string{"web", "desktop", "web", "ios"})
	if len(got) != 2 || got[0] != "web" || got[1] != "desktop" {
		t.Fatalf("platforms = %+v", got)
	}
}

func TestManifestAPIVersion(t *testing.T) {
	if got := manifestAPIVersion(map[string]any{"apiVersion": float64(0)}, PluginKindTrustedJS); got != 0 {
		t.Fatalf("apiVersion = %d", got)
	}
	if got := manifestAPIVersion(map[string]any{"themeApiVersion": float64(0)}, PluginKindTheme); got != 0 {
		t.Fatalf("themeApiVersion = %d", got)
	}
}
