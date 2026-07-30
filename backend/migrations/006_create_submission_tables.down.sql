DROP TABLE IF EXISTS submission_comments;
DROP TABLE IF EXISTS submission_review_history;
DROP TABLE IF EXISTS submission_audios;
DROP TABLE IF EXISTS reviewers;
DROP TABLE IF EXISTS submissions;

DROP TRIGGER IF EXISTS trg_reviewers_updated_at ON reviewers;
DROP TRIGGER IF EXISTS trg_submissions_updated_at ON submissions;
