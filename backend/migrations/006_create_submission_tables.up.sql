-- 投稿主表
CREATE TABLE submissions (
    id              BIGSERIAL PRIMARY KEY,
    title           VARCHAR(200)  NOT NULL DEFAULT '',
    artist          VARCHAR(200)  NOT NULL DEFAULT '',
    album           VARCHAR(200)  NOT NULL DEFAULT '',
    ncm_id          VARCHAR(50)   NOT NULL DEFAULT '',
    qq_id           VARCHAR(50)   NOT NULL DEFAULT '',
    am_id           VARCHAR(50)   NOT NULL DEFAULT '',
    spotify_id      VARCHAR(50)   NOT NULL DEFAULT '',
    file_name       VARCHAR(255)  NOT NULL DEFAULT '',
    notes           VARCHAR(2000) NOT NULL DEFAULT '',
    tags            JSONB         NOT NULL DEFAULT '[]'::jsonb,
    metadata        JSONB         NOT NULL DEFAULT '{}'::jsonb,
    language        VARCHAR(10)   NOT NULL DEFAULT 'others',
    status          VARCHAR(20)   NOT NULL DEFAULT 'pending',
    submitter       VARCHAR(100)  NOT NULL,
    submitter_info  JSONB         NOT NULL DEFAULT '{}'::jsonb,
    provider        VARCHAR(20)   NOT NULL DEFAULT 'casdoor',
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    file_updated_at TIMESTAMPTZ,
    revision_requested_at TIMESTAMPTZ,
    closed_at       TIMESTAMPTZ,
    closed_by       VARCHAR(100),
    closed_by_info  JSONB,
    reviewer        VARCHAR(100),
    reviewed_at     TIMESTAMPTZ,
    review_comment  TEXT
);

CREATE INDEX idx_submissions_submitter ON submissions(submitter);
CREATE INDEX idx_submissions_status    ON submissions(status);
CREATE INDEX idx_submissions_language  ON submissions(language);
CREATE INDEX idx_submissions_created   ON submissions(created_at DESC);
CREATE INDEX idx_submissions_status_created ON submissions(status, created_at DESC);
CREATE INDEX idx_submissions_search ON submissions
    USING gin (to_tsvector('simple',
        coalesce(title,'') || ' ' ||
        coalesce(artist,'') || ' ' ||
        coalesce(album,'') || ' ' ||
        coalesce(submitter,'')));

-- 音频附件（一个投稿最多一个音频）
CREATE TABLE submission_audios (
    id              BIGSERIAL PRIMARY KEY,
    submission_id   BIGINT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    file_name       VARCHAR(255) NOT NULL,
    cover_url       VARCHAR(500),
    title           VARCHAR(200) NOT NULL DEFAULT '',
    artist          VARCHAR(200) NOT NULL DEFAULT '',
    album           VARCHAR(200) NOT NULL DEFAULT '',
    platform        VARCHAR(50)  NOT NULL DEFAULT '',
    platform_id     VARCHAR(100) NOT NULL DEFAULT '',
    uploaded_by     VARCHAR(100) NOT NULL,
    uploaded_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE(submission_id)
);

-- 审核历史
CREATE TABLE submission_review_history (
    id              BIGSERIAL PRIMARY KEY,
    submission_id   BIGINT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    reviewer        VARCHAR(100) NOT NULL,
    reviewer_info   JSONB NOT NULL,
    status          VARCHAR(20)  NOT NULL,
    comment         TEXT NOT NULL DEFAULT '',
    reviewed_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_review_history_submission ON submission_review_history(submission_id, reviewed_at DESC);

-- 普通评论
CREATE TABLE submission_comments (
    id              BIGSERIAL PRIMARY KEY,
    submission_id   BIGINT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    author          JSONB NOT NULL,
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_comments_submission ON submission_comments(submission_id, created_at);

-- 审核员名单
CREATE TABLE reviewers (
    username        VARCHAR(100) PRIMARY KEY,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at 触发器（复用 001 中已创建的 update_updated_at_column 函数）
CREATE TRIGGER trg_submissions_updated_at
    BEFORE UPDATE ON submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_reviewers_updated_at
    BEFORE UPDATE ON reviewers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
