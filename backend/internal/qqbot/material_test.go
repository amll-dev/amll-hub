package qqbot

import "testing"

func TestNormalizeImageURL(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{input: "`https://p4.music.126.net/a.jpg`", want: "https://p4.music.126.net/a.jpg"},
		{input: "  https://example.com/a.jpg  ", want: "https://example.com/a.jpg"},
		{input: "//example.com/a.jpg", want: "https://example.com/a.jpg"},
		{input: "", want: ""},
	}
	for _, tc := range cases {
		if got := normalizeImageURL(tc.input); got != tc.want {
			t.Errorf("normalizeImageURL(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}
