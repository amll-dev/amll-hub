package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/config"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
)

func catalogTestConfig() *config.Config {
	return &config.Config{
		PluginStore: config.PluginStoreConfig{
			MaxCatalogItems: 256,
			MaxCatalogBytes: 4 << 20,
			CatalogCacheTTL: 0,
		},
	}
}

func TestPickCatalogEntries_PicksHighestSemver(t *testing.T) {
	rows := []repository.PluginCatalogRow{
		{PluginKey: "com.example.a", Version: "1.0.0", Channel: "trusted-js", SHA256: "aa"},
		{PluginKey: "com.example.a", Version: "1.2.0", Channel: "trusted-js", SHA256: "bb"},
		{PluginKey: "com.example.a", Version: "1.1.0", Channel: "trusted-js", SHA256: "cc"},
		{PluginKey: "com.example.b", Version: "0.1.0", Channel: "theme", SHA256: "dd"},
	}
	entries := pickCatalogEntries(rows)
	if len(entries) != 2 {
		t.Fatalf("entries = %d, want 2", len(entries))
	}
	// 按 id 字典序，a 在前
	if entries[0].ID != "com.example.a" || entries[0].Version != "1.2.0" {
		t.Fatalf("first entry = %+v", entries[0])
	}
	if entries[0].Entry != "artifacts/bb.zip" {
		t.Fatalf("entry path = %q", entries[0].Entry)
	}
	if entries[1].ID != "com.example.b" || entries[1].Channel != "theme" {
		t.Fatalf("second entry = %+v", entries[1])
	}
}

func TestPickCatalogEntries_AllowsPrerelease(t *testing.T) {
	rows := []repository.PluginCatalogRow{
		{PluginKey: "com.example.a", Version: "1.0.0", Channel: "trusted-js", SHA256: "aa"},
		{PluginKey: "com.example.a", Version: "1.1.0-beta.1", Channel: "trusted-js", SHA256: "bb"},
	}
	entries := pickCatalogEntries(rows)
	if len(entries) != 1 || entries[0].Version != "1.1.0-beta.1" {
		t.Fatalf("prerelease should win, got %+v", entries)
	}
}

func TestPickCatalogEntries_SkipsInvalidSemver(t *testing.T) {
	rows := []repository.PluginCatalogRow{
		{PluginKey: "com.example.a", Version: "not-semver", Channel: "trusted-js", SHA256: "aa"},
		{PluginKey: "com.example.b", Version: "1.0.0", Channel: "theme", SHA256: "bb"},
	}
	entries := pickCatalogEntries(rows)
	if len(entries) != 1 || entries[0].ID != "com.example.b" {
		t.Fatalf("invalid semver row must be skipped, got %+v", entries)
	}
}

func TestPickCatalogEntries_DefaultsPlatforms(t *testing.T) {
	rows := []repository.PluginCatalogRow{
		{PluginKey: "com.example.a", Version: "1.0.0", Channel: "trusted-js", SHA256: "aa"},
	}
	entries := pickCatalogEntries(rows)
	if len(entries[0].Platforms) != 2 {
		t.Fatalf("platforms = %+v", entries[0].Platforms)
	}
}

func TestCatalogDocumentShape(t *testing.T) {
	doc := PluginCatalogDocument{CatalogVersion: 0, Plugins: []PluginCatalogEntry{{
		ID:            "com.example.a",
		Name:          "A",
		Version:       "1.0.0",
		Channel:       "trusted-js",
		APIVersion:    0,
		Entry:         "artifacts/aaaaaaaa.zip",
		SHA256:        "aaaaaaaa",
		Platforms:     []string{"web", "desktop"},
		MinAppVersion: "0.1.0",
	}}}
	body, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatal(err)
	}
	if _, ok := parsed["catalogVersion"]; !ok {
		t.Fatal("missing catalogVersion")
	}
	plugins, ok := parsed["plugins"].([]any)
	if !ok || len(plugins) != 1 {
		t.Fatalf("plugins = %v", parsed["plugins"])
	}
	first := plugins[0].(map[string]any)
	for _, key := range []string{"id", "name", "version", "channel", "apiVersion", "entry", "sha256"} {
		if _, ok := first[key]; !ok {
			t.Errorf("catalog entry missing %q", key)
		}
	}
	// schema 是封闭的，不允许出现未声明字段
	allowed := map[string]bool{
		"id": true, "name": true, "version": true, "description": true, "author": true,
		"homepage": true, "channel": true, "apiVersion": true, "entry": true,
		"sha256": true, "platforms": true, "minAppVersion": true,
	}
	for key := range first {
		if !allowed[key] {
			t.Errorf("catalog entry has unexpected field %q", key)
		}
	}
}

func TestCatalogInvalidationClearsMemoryCache(t *testing.T) {
	s := NewPluginCatalogService(catalogTestConfig(), nil, nil)
	s.mu.Lock()
	s.body = []byte(`{"catalogVersion":0,"plugins":[]}`)
	s.etag = "etag"
	s.expireAt = time.Now().Add(time.Minute)
	s.mu.Unlock()

	s.Invalidate(context.Background())

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.body != nil || s.etag != "" {
		t.Fatal("invalidate must clear the in-process cache")
	}
}
