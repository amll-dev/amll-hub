package service

import (
	"context"
	"errors"
	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"os"
	"strings"
	"testing"
)

// PostgreSQL is required for JSONB and advisory locks. Use an isolated schema.
func TestRecruitmentReviewApproval(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL recruitment tests")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxOpenConns(1)
	schema := "recruitment_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := db.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Exec("DROP SCHEMA " + schema + " CASCADE"); pool.Close() })
	if err := db.Exec("SET search_path TO " + schema).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Submission{}, &model.ReviewHistory{}, &model.ReviewerRecruitment{}, &model.ReviewerRecruitmentMember{}); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	recruitment := NewReviewerRecruitmentService(repository.NewReviewerRecruitmentRepo(db))
	_, err = recruitment.Create(ctx, "admin", RecruitmentInput{ID: uuid.NewString(), Announcement: "test", Languages: []string{"zh"}, TargetMembers: 10, Conditions: RecruitmentConditions{ValidSubmissions: 1, ApprovalsPerSubmission: 2, RevisionsPerSubmission: 2, SubmissionsPerLanguage: 1, MaxAttempts: 5}})
	if err != nil {
		t.Fatal(err)
	}
	// Invalid filename detects entry into publication without external services.
	sub := model.Submission{FileName: "invalid", Submitter: "creator", Status: model.StatusPending, Languages: model.JSONStringArray{"zh"}, Tags: model.JSONStringArray{model.RecruitmentTag}}
	if err := db.Create(&sub).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Transaction(func(tx *gorm.DB) error { return recruitment.Enroll(tx, &sub) }); err != nil {
		t.Fatal(err)
	}
	review := NewReviewService(repository.NewSubmissionRepo(db), repository.NewReviewHistoryRepo(db), nil, nil, nil, db)
	review.SetReviewerRecruitment(recruitment)
	vote := func(name string) error {
		return review.Review(ctx, &SubmissionUser{Name: name}, sub.ID, &ReviewInput{Action: ActionApprove})
	}
	check := func(votes int, status string, history int64) {
		t.Helper()
		progress, err := recruitment.Progress(ctx, sub.ID, "creator", false)
		if err != nil {
			t.Fatal(err)
		}
		if progress == nil || progress.Approvals != votes {
			t.Fatalf("progress=%+v, want %d votes", progress, votes)
		}
		var current model.Submission
		if err := db.First(&current, sub.ID).Error; err != nil {
			t.Fatal(err)
		}
		if current.Status != status {
			t.Fatalf("status=%s, want %s", current.Status, status)
		}
		var count int64
		if err := db.Model(&model.ReviewHistory{}).Where("submission_id = ?", sub.ID).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != history {
			t.Fatalf("history=%d, want %d", count, history)
		}
	}
	if err := vote("creator"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("self approval: %v", err)
	}
	if err := vote("reviewer1"); err != nil {
		t.Fatal(err)
	}
	check(1, model.StatusPending, 1)
	if err := vote("reviewer1"); err != nil {
		t.Fatal(err)
	}
	check(1, model.StatusPending, 1)
	if err := vote("reviewer2"); err == nil {
		t.Fatal("threshold must invoke publication validation")
	}
	check(1, model.StatusPending, 1)
	failure := errors.New("publish failed")
	handled, err := recruitment.Accept(ctx, &SubmissionUser{Name: "reviewer2"}, sub.ID, "", func(tx *gorm.DB, current *model.Submission) error {
		if err := tx.Model(current).Update("status", model.StatusApproved).Error; err != nil {
			return err
		}
		return failure
	})
	if !handled || !errors.Is(err, failure) {
		t.Fatalf("handled=%v error=%v", handled, err)
	}
	check(1, model.StatusPending, 1)
	calls := 0
	handled, err = recruitment.Accept(ctx, &SubmissionUser{Name: "reviewer2"}, sub.ID, "", func(tx *gorm.DB, current *model.Submission) error {
		calls++
		return tx.Model(current).Update("status", model.StatusApproved).Error
	})
	if !handled || err != nil || calls != 1 {
		t.Fatalf("handled=%v error=%v calls=%d", handled, err, calls)
	}
	check(2, model.StatusApproved, 1)
	member, err := recruitment.Me(ctx, "creator")
	if err != nil || member == nil || member.ValidSubmissions != 1 || member.Status != "completed" {
		t.Fatalf("member=%+v error=%v", member, err)
	}
	if err := vote("reviewer3"); !errors.Is(err, ErrInvalidStatus) {
		t.Fatalf("already approved: %v", err)
	}
	// Once GitHub has accepted the file, a later storage failure must preserve
	// approval and return the manual-repair error instead of rolling back votes.
	other := model.Submission{FileName: "invalid", Submitter: "creator2", Status: model.StatusPending, Languages: model.JSONStringArray{"zh"}, Tags: model.JSONStringArray{model.RecruitmentTag}}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Transaction(func(tx *gorm.DB) error { return recruitment.Enroll(tx, &other) }); err != nil {
		t.Fatal(err)
	}
	if err := review.Review(ctx, &SubmissionUser{Name: "reviewer1"}, other.ID, &ReviewInput{Action: ActionApprove}); err != nil {
		t.Fatal(err)
	}
	handled, err = recruitment.Accept(ctx, &SubmissionUser{Name: "reviewer2"}, other.ID, "", func(tx *gorm.DB, current *model.Submission) error {
		if err := tx.Model(current).Update("status", model.StatusApproved).Error; err != nil {
			return err
		}
		return ErrApproveNeedsManualFix
	})
	if !handled || !errors.Is(err, ErrApproveNeedsManualFix) {
		t.Fatalf("handled=%v error=%v", handled, err)
	}
	if err := db.First(&other, other.ID).Error; err != nil {
		t.Fatal(err)
	}
	if other.Status != model.StatusApproved {
		t.Fatalf("manual repair status=%s", other.Status)
	}
	progress, err := recruitment.Progress(ctx, other.ID, "creator2", false)
	if err != nil || progress == nil || progress.Approvals != 2 {
		t.Fatalf("manual repair progress=%+v error=%v", progress, err)
	}

	ordinary := model.Submission{FileName: "invalid", Submitter: "ordinary", Status: model.StatusPending}
	if err := db.Create(&ordinary).Error; err != nil {
		t.Fatal(err)
	}
	if err := review.Review(ctx, &SubmissionUser{Name: "reviewer1"}, ordinary.ID, &ReviewInput{Action: ActionApprove}); err == nil {
		t.Fatal("ordinary approval must invoke publication validation")
	}
}
