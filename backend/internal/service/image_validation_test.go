package service

import (
	"testing"

	"github.com/amll-dev/amll-hub/backend/internal/model"
)

func TestValidateImageUpload(t *testing.T) {
	png := []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}
	jpeg := []byte{0xFF, 0xD8, 0xFF, 0xE0}
	gif := []byte("GIF89a")
	webp := []byte("RIFF\x00\x00\x00\x00WEBPVP8 ")

	tests := []struct {
		name     string
		fileName string
		content  []byte
		wantErr  bool
	}{
		{name: "png", fileName: "cover.png", content: png},
		{name: "jpeg", fileName: "cover.jpeg", content: jpeg},
		{name: "jpg", fileName: "cover.jpg", content: jpeg},
		{name: "gif", fileName: "cover.gif", content: gif},
		{name: "webp", fileName: "cover.webp", content: webp},
		{name: "内容与扩展名不匹配", fileName: "cover.png", content: jpeg, wantErr: true},
		{name: "无法识别的内容", fileName: "cover.png", content: []byte("hello"), wantErr: true},
		{name: "不支持的扩展名", fileName: "cover.svg", content: []byte("<svg></svg>"), wantErr: true},
		{name: "空内容", fileName: "cover.png", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateImageUpload(tt.fileName, tt.content)
			if (err != nil) != tt.wantErr {
				t.Fatalf("wantErr=%v, err=%v", tt.wantErr, err)
			}
		})
	}
}

func TestSubmissionPlatformIDs(t *testing.T) {
	sub := &model.Submission{
		NcmID:     "111",
		QqID:      "",
		SpotifyID: "333",
		Metadata: model.JSONObject{
			"platform_ids": map[string]any{
				"ncm_music_id": []any{"111", "222"},
				"qq_music_id":  []any{"0", "444"},
			},
		},
	}

	got := submissionPlatformIDs(sub)

	if len(got["ncm"]) != 2 || got["ncm"][0] != "111" || got["ncm"][1] != "222" {
		t.Fatalf("ncm ids = %#v", got["ncm"])
	}
	if len(got["qq"]) != 1 || got["qq"][0] != "444" {
		t.Fatalf("qq ids = %#v", got["qq"])
	}
	if len(got["spotify"]) != 1 || got["spotify"][0] != "333" {
		t.Fatalf("spotify ids = %#v", got["spotify"])
	}
	if _, ok := got["apple"]; ok {
		t.Fatalf("apple ids 应为空: %#v", got["apple"])
	}
}
