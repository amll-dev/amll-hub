package service

import (
	"testing"

	"github.com/amll-dev/amll-hub/backend/internal/model"
)

func TestConclusionStatus(t *testing.T) {
	tests := []struct {
		action string
		want   string
	}{
		{ActionApprove, model.StatusApproved},
		{ActionReject, model.StatusRejected},
		{ActionRevision, model.StatusNeedRevision},
		{ActionMissingAudio, model.StatusMissingAudio},
	}

	for _, tt := range tests {
		t.Run(tt.action, func(t *testing.T) {
			if got := conclusionStatus(tt.action); got != tt.want {
				t.Fatalf("conclusionStatus(%q) = %q, want %q", tt.action, got, tt.want)
			}
		})
	}
}
