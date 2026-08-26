-- updated_at 触发器函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--  歌曲主表
CREATE TABLE songs (
    id                       BIGSERIAL PRIMARY KEY,
    music_name               JSONB NOT NULL DEFAULT '[]',
    album                    JSONB NOT NULL DEFAULT '[]',
    isrc                     TEXT,
    raw_lyric_file           VARCHAR(255) NOT NULL UNIQUE,
    minio_path               VARCHAR(500) NOT NULL,
    lyric_text               TEXT,
    ttml_author_github       VARCHAR(50),
    ttml_author_github_login VARCHAR(100),
    word_count               INT NOT NULL DEFAULT 0,
    line_count               INT NOT NULL DEFAULT 0,
    is_deleted               BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at               TIMESTAMPTZ,
    commit_timestamp         BIGINT,
    commit_time              TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_songs_music_name      ON songs USING GIN(music_name);
CREATE INDEX idx_songs_album           ON songs USING GIN(album);
CREATE INDEX idx_songs_commit_timestamp ON songs(commit_timestamp DESC);
CREATE INDEX idx_songs_commit_time     ON songs(commit_time DESC);

CREATE TRIGGER trg_songs_updated_at
    BEFORE UPDATE ON songs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

--  艺术家表
CREATE TABLE artists (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_artists_name ON artists(name);

--  歌曲-艺术家关联表
CREATE TABLE song_artists (
    id          BIGSERIAL PRIMARY KEY,
    song_id     BIGINT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    artist_id   BIGINT NOT NULL REFERENCES artists(id) ON DELETE CASCADE
);

CREATE INDEX idx_song_artists_song_artist ON song_artists(song_id, artist_id);

--  平台 ID 映射表
CREATE TABLE platform_mappings (
    id          BIGSERIAL PRIMARY KEY,
    song_id     BIGINT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    platform    VARCHAR(50) NOT NULL,
    platform_id VARCHAR(100) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pm_song_platform ON platform_mappings(song_id, platform);
CREATE INDEX idx_pm_platform_id   ON platform_mappings(platform, platform_id);

--  同步状态表
CREATE TABLE sync_state (
    key   VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT INTO sync_state (key, value) VALUES ('last_synced_commit', '');
INSERT INTO sync_state (key, value) VALUES ('last_synced_at', '');

--  同步历史表
CREATE TABLE sync_history (
    id              BIGSERIAL PRIMARY KEY,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    previous_commit VARCHAR(40),
    target_commit   VARCHAR(40) NOT NULL,
    status          VARCHAR(20) NOT NULL,
    added_count     INT NOT NULL DEFAULT 0,
    updated_count   INT NOT NULL DEFAULT 0,
    deleted_count   INT NOT NULL DEFAULT 0,
    error_message   TEXT,
    triggered_by    VARCHAR(20) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sync_history_time ON sync_history(started_at DESC);

--  同步进度表
CREATE TABLE sync_progress (
    id              BIGSERIAL PRIMARY KEY,
    sync_history_id BIGINT NOT NULL REFERENCES sync_history(id) ON DELETE CASCADE,
    total           INT NOT NULL DEFAULT 0,
    downloaded      INT NOT NULL DEFAULT 0,
    failed          INT NOT NULL DEFAULT 0,
    current_file    VARCHAR(255),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sync_progress_history ON sync_progress(sync_history_id);

--  无歌曲记录表

CREATE TABLE not_found_requests (
    id               BIGSERIAL PRIMARY KEY,
    platform         VARCHAR(20) NOT NULL,
    platform_id      VARCHAR(100) NOT NULL,
    song_name        VARCHAR(255),
    request_count    INT NOT NULL DEFAULT 1,
    first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    daily_requests   JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_request_ip VARCHAR(50),
    category         VARCHAR(20) NOT NULL DEFAULT 'unknown',
    artists          VARCHAR(500),
    cover            VARCHAR(500),
    album            VARCHAR(255),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(platform, platform_id)
);

COMMENT ON TABLE not_found_requests IS '无歌词记录表';
COMMENT ON COLUMN not_found_requests.category IS 'pure_music/cloud_music 白名单保留，not_found 每周清空';
COMMENT ON COLUMN not_found_requests.artists IS '歌手名';
COMMENT ON COLUMN not_found_requests.cover IS '封面 URL';
COMMENT ON COLUMN not_found_requests.album IS '专辑名';

CREATE INDEX idx_not_found_platform_id ON not_found_requests(platform, platform_id);
CREATE INDEX idx_not_found_count       ON not_found_requests(request_count DESC);
CREATE INDEX idx_not_found_category    ON not_found_requests(category);
CREATE INDEX idx_not_found_last_seen   ON not_found_requests(last_seen_at DESC);

CREATE TRIGGER trg_not_found_updated_at
    BEFORE UPDATE ON not_found_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

--  纯音乐白名单表
CREATE TABLE pure_music_whitelist (
    id           BIGSERIAL PRIMARY KEY,
    platform     VARCHAR(20) NOT NULL,
    platform_id  VARCHAR(100) NOT NULL,
    song_name    VARCHAR(255),
    reason       VARCHAR(255),
    detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    detected_by  VARCHAR(50),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(platform, platform_id)
);

CREATE INDEX idx_pure_music_platform_id ON pure_music_whitelist(platform, platform_id);

--  云盘音乐白名单表
CREATE TABLE cloud_music_whitelist (
    id           BIGSERIAL PRIMARY KEY,
    platform     VARCHAR(20) NOT NULL,
    platform_id  VARCHAR(100) NOT NULL,
    song_name    VARCHAR(255),
    reason       VARCHAR(255),
    detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    detected_by  VARCHAR(50),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(platform, platform_id)
);

CREATE INDEX idx_cloud_music_platform_id ON cloud_music_whitelist(platform, platform_id);

--  投稿主表
CREATE TABLE submissions (
    id                    BIGSERIAL PRIMARY KEY,
    title                 VARCHAR(200)  NOT NULL DEFAULT '',
    artist                VARCHAR(200)  NOT NULL DEFAULT '',
    album                 VARCHAR(200)  NOT NULL DEFAULT '',
    ncm_id                VARCHAR(50)   NOT NULL DEFAULT '',
    qq_id                 VARCHAR(50)   NOT NULL DEFAULT '',
    am_id                 VARCHAR(50)   NOT NULL DEFAULT '',
    spotify_id            VARCHAR(50)   NOT NULL DEFAULT '',
    file_name             VARCHAR(255)  NOT NULL DEFAULT '',
    notes                 VARCHAR(2000) NOT NULL DEFAULT '',
    tags                  JSONB         NOT NULL DEFAULT '[]'::jsonb,
    metadata              JSONB         NOT NULL DEFAULT '{}'::jsonb,
    language              VARCHAR(10)   NOT NULL DEFAULT 'others',
    status                VARCHAR(20)   NOT NULL DEFAULT 'pending',
    submitter             VARCHAR(100)  NOT NULL,
    submitter_info        JSONB         NOT NULL DEFAULT '{}'::jsonb,
    provider              VARCHAR(20)   NOT NULL DEFAULT 'casdoor',
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    file_updated_at       TIMESTAMPTZ,
    revision_requested_at TIMESTAMPTZ,
    closed_at             TIMESTAMPTZ,
    closed_by             VARCHAR(100),
    closed_by_info        JSONB,
    reviewer              VARCHAR(100),
    reviewed_at           TIMESTAMPTZ,
    review_comment        TEXT
);

CREATE INDEX idx_submissions_submitter       ON submissions(submitter);
CREATE INDEX idx_submissions_status          ON submissions(status);
CREATE INDEX idx_submissions_language        ON submissions(language);
CREATE INDEX idx_submissions_created         ON submissions(created_at DESC);
CREATE INDEX idx_submissions_status_created  ON submissions(status, created_at DESC);
CREATE INDEX idx_submissions_search ON submissions
    USING gin (to_tsvector('simple',
        coalesce(title,'') || ' ' ||
        coalesce(artist,'') || ' ' ||
        coalesce(album,'') || ' ' ||
        coalesce(submitter,'')));

CREATE TRIGGER trg_submissions_updated_at
    BEFORE UPDATE ON submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

--  音频附件表（支持单个投稿关联多个音频，无 submission_id 唯一约束）
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
    uploaded_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

--  审核历史表
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

--  歌词文件更新历史表（独立于审核历史）
CREATE TABLE submission_file_history (
    id              BIGSERIAL PRIMARY KEY,
    submission_id   BIGINT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    uploader        VARCHAR(100) NOT NULL,
    uploader_info   JSONB NOT NULL,
    file_name       VARCHAR(255) NOT NULL,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_file_history_submission ON submission_file_history(submission_id, uploaded_at DESC);

--  普通评论表
CREATE TABLE submission_comments (
    id              BIGSERIAL PRIMARY KEY,
    submission_id   BIGINT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    author          JSONB NOT NULL,
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_comments_submission ON submission_comments(submission_id, created_at);

--  审核员名单表
CREATE TABLE reviewers (
    username        VARCHAR(100) PRIMARY KEY,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_reviewers_updated_at
    BEFORE UPDATE ON reviewers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

--  超级管理员名单（手动维护）：可在前端审核员管理页面对审核员名单进行增删
CREATE TABLE admins (
    username        VARCHAR(100) PRIMARY KEY,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_admins_updated_at
    BEFORE UPDATE ON admins
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

--  搜索IP显示投稿表（新投稿默认待审核，审核通过后才公开展示）
CREATE TABLE search_ip_submissions (
    id             BIGSERIAL PRIMARY KEY,
    title          VARCHAR(200) NOT NULL DEFAULT '',
    data           JSONB NOT NULL,
    image_keys     JSONB NOT NULL DEFAULT '{}',
    submitter      VARCHAR(100) NOT NULL,
    submitter_info JSONB NOT NULL DEFAULT '{}',
    status         VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_search_ip_submissions_status ON search_ip_submissions(status);

--  每日推荐投稿表
CREATE TABLE daily_recommendations (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    song_name VARCHAR(200) NOT NULL DEFAULT '',
    artist VARCHAR(200) NOT NULL DEFAULT '',
    cover_key VARCHAR(500) NOT NULL DEFAULT '',
    ncm_id VARCHAR(50) NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    submitter VARCHAR(100) NOT NULL,
    submitter_info JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'approved',
    like_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_daily_recommendations_status ON daily_recommendations(status);
CREATE INDEX idx_daily_recommendations_date ON daily_recommendations(date);

--  每日推荐点赞表（UNIQUE 约束保证一人一赞，点赞数以本表统计为准）
CREATE TABLE daily_recommendation_likes (
    id BIGSERIAL PRIMARY KEY,
    recommendation_id BIGINT NOT NULL REFERENCES daily_recommendations(id) ON DELETE CASCADE,
    username VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_daily_rec_like UNIQUE (recommendation_id, username)
);

CREATE INDEX idx_daily_rec_likes_rec ON daily_recommendation_likes(recommendation_id);

--  最新收录歌曲快照表（每次同步后记录，最多9首）
CREATE TABLE latest_songs (
    id BIGSERIAL PRIMARY KEY,
    sync_history_id BIGINT NOT NULL,
    song_id BIGINT NOT NULL,
    ncm_id VARCHAR(100),
    title VARCHAR(500) NOT NULL DEFAULT '',
    artist VARCHAR(500) NOT NULL DEFAULT '',
    cover_url VARCHAR(1000) NOT NULL DEFAULT '',
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_latest_songs_sync ON latest_songs(sync_history_id);
