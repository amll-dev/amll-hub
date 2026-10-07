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
    --  languages：多选语言数组（jsonb）。元素可以是内置代码（zh/en/ja/ko），
    --             也可以是用户自定义的语言名（如「粤语」）；
    --             language 列继续保留存数组第一项作为主语言，按 language 筛选行为不变。
    languages             JSONB         NOT NULL DEFAULT '[]'::jsonb,
    --  is_unrearranged：投稿文件为未经重排的原始歌词。
    --     元数据仍照常从 TTML 解析（标题/歌手/专辑/平台 ID），只是不采用重排结果、
    --     不以格式校验作为提交门槛；unrearranged_reason 强制必填。
    is_unrearranged       BOOLEAN       NOT NULL DEFAULT FALSE,
    unrearranged_reason   VARCHAR(500)  NOT NULL DEFAULT '',
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
    review_comment        TEXT,
    revision_file_key     VARCHAR(500)  NOT NULL DEFAULT '',
    revision_metadata     JSONB         NOT NULL DEFAULT '{}'::jsonb,
    revision_ttml         TEXT,
    revision_at           TIMESTAMPTZ,
    revision_reviewer     VARCHAR(100),
    revision_reviewer_info JSONB
);

COMMENT ON COLUMN submissions.status IS
    '投稿状态：draft/pending/reviewing/revised/need_revision/missing_audio/approved/rejected/closed。revised 表示审核员已提交修订版，等待投稿者确认';
COMMENT ON COLUMN submissions.revision_file_key IS
    '审核员修订版 TTML 的对象存储 key；为空表示本次审核未上传修订文件';
COMMENT ON COLUMN submissions.revision_ttml IS
    '审核员修订版 TTML 原文，用于详情页对比展示与导出';
COMMENT ON COLUMN submissions.revision_metadata IS
    '审核员修正后的 TTML metadata（snake_case 序列化格式）';

CREATE INDEX idx_submissions_submitter       ON submissions(submitter);
CREATE INDEX idx_submissions_status          ON submissions(status);
CREATE INDEX idx_submissions_language        ON submissions(language);
-- 多选语言筛选用 GIN 索引
CREATE INDEX idx_submissions_languages       ON submissions USING GIN (languages);
CREATE INDEX idx_submissions_created         ON submissions(created_at DESC);
CREATE INDEX idx_submissions_status_created  ON submissions(status, created_at DESC);
CREATE INDEX idx_submissions_search ON submissions
    USING gin (to_tsvector('simple',
        coalesce(title,'') || ' ' ||
        coalesce(artist,'') || ' ' ||
        coalesce(album,'') || ' ' ||
        coalesce(submitter,'')));
CREATE INDEX idx_submissions_revision_at ON submissions(revision_at DESC)
    WHERE revision_file_key <> '';

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

CREATE TABLE review_reports (
    id             BIGSERIAL PRIMARY KEY,
    submission_id  BIGINT       NOT NULL,
    reviewer       VARCHAR(100) NOT NULL,
    reviewer_info  JSONB        NOT NULL DEFAULT '{}'::jsonb,
    action         VARCHAR(20)  NOT NULL,
    has_revision   BOOLEAN      NOT NULL DEFAULT FALSE,
    report_md      TEXT         NOT NULL DEFAULT '',
    structured     JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_review_reports_submission ON review_reports(submission_id, created_at DESC);
CREATE INDEX idx_review_reports_reviewer   ON review_reports(reviewer, created_at DESC);

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

--  消息中心 / 通知表
--  注意：项目没有 users 表，用户身份来自 Casdoor JWT（claims.name），
--  因此 username 不建外键，与 submissions.submitter / reviewers.username 同域。
CREATE TABLE notifications (
    id            BIGSERIAL PRIMARY KEY,
    username      VARCHAR(100)  NOT NULL,
    type          VARCHAR(20)   NOT NULL DEFAULT 'system',
    title         VARCHAR(200)  NOT NULL DEFAULT '',
    content       TEXT          NOT NULL DEFAULT '',
    is_read       BOOLEAN       NOT NULL DEFAULT FALSE,
    action_path   VARCHAR(500),
    action_label  VARCHAR(100),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    read_at       TIMESTAMPTZ,
    result        VARCHAR(20)   NOT NULL DEFAULT ''
);

COMMENT ON TABLE  notifications IS '站内消息/通知中心';
COMMENT ON COLUMN notifications.username IS '接收者用户名，对应 JWT claims.name';
COMMENT ON COLUMN notifications.type IS 'system / review / submission / comment';
COMMENT ON COLUMN notifications.action_path IS '前端跳转路径，如 /review/detail?id=123';
COMMENT ON COLUMN notifications.action_label IS '跳转按钮文案，如 查看投稿';
COMMENT ON COLUMN notifications.result IS
    '审核结果细分：approved / rejected / need_revision / missing_audio / closed（仅 type=review 有值）';

--  主查询：某人消息按时间倒序分页
CREATE INDEX idx_notifications_user_created ON notifications (username, created_at DESC);
--  按类型筛选（/messages 页 Tabs）
CREATE INDEX idx_notifications_user_type ON notifications (username, type, created_at DESC);
--  未读计数：部分索引，只索引未读行，体积小
CREATE INDEX idx_notifications_user_unread ON notifications (username) WHERE is_read = FALSE;
--  运维清理
CREATE INDEX idx_notifications_created ON notifications (created_at DESC);

ALTER TABLE notifications
    ADD CONSTRAINT ck_notifications_type
    CHECK (type IN ('system', 'review', 'submission', 'comment'));

--  GitHub 绑定表：一个站点用户（JWT claims.name）最多绑定一个 GitHub 账号
CREATE TABLE user_github_bindings (
    id            BIGSERIAL PRIMARY KEY,
    username      VARCHAR(100) NOT NULL,
    github_id     BIGINT       NOT NULL,
    github_login  VARCHAR(100) NOT NULL,
    github_email  VARCHAR(255),
    github_avatar VARCHAR(500),
    bound_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 一个站点用户只能绑定一个 GitHub
CREATE UNIQUE INDEX uq_user_github_bindings_username ON user_github_bindings(username);
-- 一个 GitHub 账号只能绑定一个站点用户
CREATE UNIQUE INDEX uq_user_github_bindings_github_id ON user_github_bindings(github_id);

CREATE TRIGGER trg_user_github_bindings_updated_at
    BEFORE UPDATE ON user_github_bindings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

--  已迁移 PR 记录表：全局去重核心，任何用户迁移时命中 pr_number 即跳过
CREATE TABLE github_migrated_prs (
    id            BIGSERIAL PRIMARY KEY,
    pr_number     INT          NOT NULL,
    username      VARCHAR(100) NOT NULL,
    submission_id BIGINT,
    migrated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 全局唯一：同一 PR 只迁移一次
CREATE UNIQUE INDEX uq_github_migrated_prs_number ON github_migrated_prs(pr_number);
CREATE INDEX idx_github_migrated_prs_username ON github_migrated_prs(username);

--  迁移任务与进度表
CREATE TABLE github_migration_tasks (
    id              BIGSERIAL PRIMARY KEY,
    username        VARCHAR(100) NOT NULL,
    github_login    VARCHAR(100) NOT NULL,
    status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
    total_prs       INT          NOT NULL DEFAULT 0,
    processed_prs   INT          NOT NULL DEFAULT 0,
    created_count   INT          NOT NULL DEFAULT 0,
    skipped_count   INT          NOT NULL DEFAULT 0,
    failed_count    INT          NOT NULL DEFAULT 0,
    cursor          VARCHAR(64),
    error           TEXT,
    close_pr_status VARCHAR(20)  NOT NULL DEFAULT 'pending',
    closed_pr_count INT          NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

COMMENT ON COLUMN github_migration_tasks.status IS 'pending/running/completed/failed';
COMMENT ON COLUMN github_migration_tasks.close_pr_status IS 'pending/running/completed/failed';
COMMENT ON COLUMN github_migration_tasks.cursor IS '断点游标（GraphQL endCursor），重试时从此继续';

CREATE INDEX idx_github_migration_tasks_user ON github_migration_tasks(username, created_at DESC);
CREATE INDEX idx_github_migration_tasks_status ON github_migration_tasks(status);

CREATE TRIGGER trg_github_migration_tasks_updated_at
    BEFORE UPDATE ON github_migration_tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
