package mail

import "testing"

func TestRenderRecruitmentCompleted(t *testing.T) {
	r, err := NewRenderer()
	if err != nil {
		t.Fatal(err)
	}
	subject, html, text, err := r.RenderRecruitmentCompleted(RecruitmentCompletedParams{
		Username:  "creator",
		DetailURL: "https://example.com/creator",
		SiteURL:   "https://example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	if subject == "" || html == "" || text == "" {
		t.Fatal("empty rendered output")
	}
}
