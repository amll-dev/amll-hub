-- 招募表保存完整表单快照和到日的起止时间。
CREATE TABLE reviewer_recruitments (
 id UUID PRIMARY KEY,
 form_data JSONB NOT NULL,
 starts_on DATE NOT NULL,
 ends_on DATE,
 ended_on DATE,
 target_members INT NOT NULL DEFAULT 0 CHECK (target_members >= 0),
 completed_count INT NOT NULL DEFAULT 0,
 status VARCHAR(20) NOT NULL DEFAULT 'active',
 created_by VARCHAR(100) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_reviewer_recruitments_active ON reviewer_recruitments ((status)) WHERE status = 'active';
CREATE TABLE reviewer_recruitment_members (
 id BIGSERIAL PRIMARY KEY,
 recruitment_id UUID NOT NULL REFERENCES reviewer_recruitments(id) ON DELETE CASCADE,
 username VARCHAR(100) NOT NULL,
 user_info JSONB NOT NULL DEFAULT '{}'::jsonb,
 -- 每篇的文件版本、接受者集合、累计修改意见、加试与通过标记均随报名删除。
 progress JSONB NOT NULL DEFAULT '{}'::jsonb,
 joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(recruitment_id, username)
);
CREATE INDEX idx_reviewer_recruitment_members_username ON reviewer_recruitment_members(username);
