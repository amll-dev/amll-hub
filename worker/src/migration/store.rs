use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use sea_orm::{
    ConnectionTrait, DatabaseBackend, DatabaseConnection, FromQueryResult, Statement,
    TransactionTrait, Value,
};

/// 迁移任务当前状态（读取自 github_migration_tasks）
#[derive(Debug, Clone, FromQueryResult)]
pub struct TaskRow {
    pub processed_prs: i32,
    pub created_count: i32,
    pub skipped_count: i32,
    pub failed_count: i32,
    pub cursor: Option<String>,
    pub close_pr_status: String,
}

/// 已迁移 PR（关闭 PR 阶段使用）
#[derive(Debug, Clone, FromQueryResult)]
pub struct MigratedPrRow {
    pub number: i64,
    pub file_name: Option<String>,
}

/// GitHub 绑定记录（github_login → 站点 username）
#[derive(Debug, Clone, FromQueryResult)]
pub struct GithubBindingRow {
    pub github_login: String,
    pub username: String,
}

/// 审核历史写入项
pub struct ReviewHistoryInsert {
    pub reviewer: String,
    pub reviewer_info: serde_json::Value,
    pub status: String,
    pub comment: String,
    pub reviewed_at: DateTime<Utc>,
}

/// 评论写入项
pub struct CommentInsert {
    pub author: serde_json::Value,
    pub content: String,
    pub created_at: DateTime<Utc>,
}

/// 文件更新历史写入项
pub struct FileHistoryInsert {
    pub uploader: String,
    pub uploader_info: serde_json::Value,
    pub file_name: String,
    pub uploaded_at: DateTime<Utc>,
}

/// 单条 PR → 站点投稿的完整写入数据
pub struct SubmissionInsert {
    pub pr_number: i64,
    pub username: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub ncm_id: String,
    pub qq_id: String,
    pub am_id: String,
    pub spotify_id: String,
    pub file_name: String,
    pub tags: serde_json::Value,
    pub metadata: serde_json::Value,
    pub language: String,
    pub languages: serde_json::Value,
    pub status: String,
    pub submitter: String,
    pub submitter_info: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub revision_requested_at: Option<DateTime<Utc>>,
    pub closed_at: Option<DateTime<Utc>>,
    pub closed_by: Option<String>,
    pub closed_by_info: Option<serde_json::Value>,
    pub reviewer: Option<String>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub review_comment: Option<String>,
    pub reviews: Vec<ReviewHistoryInsert>,
    pub comments: Vec<CommentInsert>,
    pub file_history: Option<FileHistoryInsert>,
}

/// 迁移相关的数据库读写
#[derive(Clone)]
pub struct MigrationStore {
    db: DatabaseConnection,
}

impl MigrationStore {
    pub fn new(db: DatabaseConnection) -> Self {
        Self { db }
    }

    // ===== 任务进度 =====

    pub async fn get_task(&self, task_id: i64) -> Result<Option<TaskRow>> {
        let sql = r#"SELECT processed_prs, created_count, skipped_count, failed_count,
                            cursor, close_pr_status
                     FROM github_migration_tasks WHERE id = $1"#;
        Ok(TaskRow::find_by_statement(stmt(sql, vec![task_id.into()]))
            .one(&self.db)
            .await?)
    }

    pub async fn mark_running(&self, task_id: i64) -> Result<()> {
        self.exec(
            "UPDATE github_migration_tasks SET status = 'running', error = NULL WHERE id = $1",
            vec![task_id.into()],
        )
        .await
    }

    pub async fn set_total(&self, task_id: i64, total: i32) -> Result<()> {
        self.exec(
            "UPDATE github_migration_tasks SET total_prs = $2 WHERE id = $1",
            vec![task_id.into(), total.into()],
        )
        .await
    }

    /// 刷新进度与断点游标（每处理 N 条调用一次）
    pub async fn update_progress(
        &self,
        task_id: i64,
        processed: i32,
        created: i32,
        skipped: i32,
        failed: i32,
        cursor: Option<&str>,
    ) -> Result<()> {
        let sql = r#"UPDATE github_migration_tasks
                     SET processed_prs = $2, created_count = $3, skipped_count = $4,
                         failed_count = $5, cursor = $6
                     WHERE id = $1"#;
        self.exec(
            sql,
            vec![
                task_id.into(),
                processed.into(),
                created.into(),
                skipped.into(),
                failed.into(),
                cursor.map(|s| s.to_string()).into(),
            ],
        )
        .await
    }

    pub async fn mark_completed(
        &self,
        task_id: i64,
        processed: i32,
        created: i32,
        skipped: i32,
        failed: i32,
    ) -> Result<()> {
        let sql = r#"UPDATE github_migration_tasks
                     SET status = 'completed', processed_prs = $2, created_count = $3,
                         skipped_count = $4, failed_count = $5, completed_at = NOW()
                     WHERE id = $1"#;
        self.exec(
            sql,
            vec![
                task_id.into(),
                processed.into(),
                created.into(),
                skipped.into(),
                failed.into(),
            ],
        )
        .await
    }

    pub async fn mark_failed(&self, task_id: i64, error: &str) -> Result<()> {
        self.exec(
            "UPDATE github_migration_tasks SET status = 'failed', error = $2 WHERE id = $1",
            vec![task_id.into(), error.to_string().into()],
        )
        .await
    }

    pub async fn mark_close_running(&self, task_id: i64) -> Result<()> {
        self.exec(
            "UPDATE github_migration_tasks SET close_pr_status = 'running' WHERE id = $1",
            vec![task_id.into()],
        )
        .await
    }

    pub async fn set_close_status(&self, task_id: i64, status: &str) -> Result<()> {
        self.exec(
            "UPDATE github_migration_tasks SET close_pr_status = $2 WHERE id = $1",
            vec![task_id.into(), status.to_string().into()],
        )
        .await
    }

    pub async fn add_closed_count(&self, task_id: i64, delta: i32) -> Result<()> {
        self.exec(
            "UPDATE github_migration_tasks SET closed_pr_count = closed_pr_count + $2 WHERE id = $1",
            vec![task_id.into(), delta.into()],
        )
        .await
    }

    // ===== 已迁移 PR =====

    pub async fn has_migrated_pr(&self, pr_number: i64) -> Result<bool> {
        let sql = "SELECT 1 AS number FROM github_migrated_prs WHERE pr_number = $1";
        let row = MigratedPrRow::find_by_statement(stmt(sql, vec![pr_number.into()]))
            .one(&self.db)
            .await?;
        Ok(row.is_some())
    }

    /// 查询该用户已迁移的 PR（附带稿件文件名，用于关闭 PR 时的迁移地址评论）
    pub async fn list_migrated_prs(&self, username: &str, since: i64) -> Result<Vec<MigratedPrRow>> {
        let sql = r#"SELECT g.pr_number AS number, s.file_name AS file_name
                     FROM github_migrated_prs g
                     LEFT JOIN submissions s ON s.id = g.submission_id
                     WHERE g.username = $1 AND g.pr_number >= $2
                     ORDER BY g.pr_number DESC"#;
        Ok(
            MigratedPrRow::find_by_statement(stmt(
                sql,
                vec![username.to_string().into(), since.into()],
            ))
            .all(&self.db)
            .await?,
        )
    }

    /// 按 github_login（大小写不敏感）批量查询绑定关系
    pub async fn find_bindings(&self, github_logins: &[String]) -> Result<Vec<GithubBindingRow>> {
        if github_logins.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders: Vec<String> = (1..=github_logins.len()).map(|i| format!("${}", i)).collect();
        let sql = format!(
            "SELECT github_login, username FROM user_github_bindings WHERE lower(github_login) IN ({})",
            placeholders.join(", ")
        );
        let params: Vec<Value> = github_logins
            .iter()
            .map(|login| login.to_ascii_lowercase().into())
            .collect();
        Ok(
            GithubBindingRow::find_by_statement(stmt(&sql, params))
                .all(&self.db)
                .await?,
        )
    }

    // ===== 写入稿件 =====

    /// 在单个事务内写入 submissions / 审核历史 / 评论 / 文件历史 / 已迁移 PR 记录
    ///
    /// 返回 `Ok(None)` 表示该 PR 已被其他任务迁移（唯一约束冲突），本次跳过。
    pub async fn insert_submission(&self, data: &SubmissionInsert) -> Result<Option<i64>> {
        let txn = self.db.begin().await?;

        let submission_id = insert_submission_row(&txn, data).await?;

        // 全局唯一兜底：并发下若已被迁移，回滚整条事务
        let inserted = insert_migrated_pr(&txn, data.pr_number, &data.username, submission_id).await?;
        if !inserted {
            txn.rollback().await.context("rollback duplicated migration")?;
            return Ok(None);
        }

        for review in &data.reviews {
            insert_review_history(&txn, submission_id, review).await?;
        }
        for comment in &data.comments {
            insert_comment(&txn, submission_id, comment).await?;
        }
        if let Some(file) = &data.file_history {
            insert_file_history(&txn, submission_id, file).await?;
        }

        txn.commit().await.context("commit migrated submission")?;
        Ok(Some(submission_id))
    }

    async fn exec(&self, sql: &str, params: Vec<Value>) -> Result<()> {
        self.db
            .execute(stmt(sql, params))
            .await
            .with_context(|| format!("执行 SQL 失败: {}", first_line(sql)))?;
        Ok(())
    }
}

async fn insert_submission_row<C: ConnectionTrait>(
    conn: &C,
    data: &SubmissionInsert,
) -> Result<i64> {
    let sql = r#"INSERT INTO submissions (
            title, artist, album, ncm_id, qq_id, am_id, spotify_id, file_name,
            notes, tags, metadata, language, languages,
            status, submitter, submitter_info, provider,
            created_at, updated_at,
            revision_requested_at, closed_at, closed_by, closed_by_info,
            reviewer, reviewed_at, review_comment
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            '', $9::jsonb, $10::jsonb, $11, $12::jsonb,
            $13, $14, $15::jsonb, 'github_migration',
            $16, $17,
            $18, $19, $20, $21::jsonb,
            $22, $23, $24
        ) RETURNING id"#;

    let params: Vec<Value> = vec![
        data.title.clone().into(),
        data.artist.clone().into(),
        data.album.clone().into(),
        data.ncm_id.clone().into(),
        data.qq_id.clone().into(),
        data.am_id.clone().into(),
        data.spotify_id.clone().into(),
        data.file_name.clone().into(),
        data.tags.clone().into(),
        data.metadata.clone().into(),
        data.language.clone().into(),
        data.languages.clone().into(),
        data.status.clone().into(),
        data.submitter.clone().into(),
        data.submitter_info.clone().into(),
        data.created_at.into(),
        data.updated_at.into(),
        data.revision_requested_at.into(),
        data.closed_at.into(),
        data.closed_by.clone().into(),
        data.closed_by_info.clone().into(),
        data.reviewer.clone().into(),
        data.reviewed_at.into(),
        data.review_comment.clone().into(),
    ];

    let row = conn
        .query_one(stmt(sql, params))
        .await
        .context("插入 submissions 失败")?
        .ok_or_else(|| anyhow::anyhow!("插入 submissions 未返回 id"))?;
    row.try_get::<i64>("", "id")
        .context("读取新生成的 submission id 失败")
}

async fn insert_migrated_pr<C: ConnectionTrait>(
    conn: &C,
    pr_number: i64,
    username: &str,
    submission_id: i64,
) -> Result<bool> {
    let sql = r#"INSERT INTO github_migrated_prs (pr_number, username, submission_id)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (pr_number) DO NOTHING"#;
    let res = conn
        .execute(stmt(
            sql,
            vec![
                pr_number.into(),
                username.to_string().into(),
                submission_id.into(),
            ],
        ))
        .await
        .context("写入 github_migrated_prs 失败")?;
    Ok(res.rows_affected() > 0)
}

async fn insert_review_history<C: ConnectionTrait>(
    conn: &C,
    submission_id: i64,
    review: &ReviewHistoryInsert,
) -> Result<()> {
    let sql = r#"INSERT INTO submission_review_history
                     (submission_id, reviewer, reviewer_info, status, comment, reviewed_at)
                 VALUES ($1, $2, $3::jsonb, $4, $5, $6)"#;
    conn.execute(stmt(
        sql,
        vec![
            submission_id.into(),
            review.reviewer.clone().into(),
            review.reviewer_info.clone().into(),
            review.status.clone().into(),
            review.comment.clone().into(),
            review.reviewed_at.into(),
        ],
    ))
    .await
    .context("写入 submission_review_history 失败")?;
    Ok(())
}

async fn insert_comment<C: ConnectionTrait>(
    conn: &C,
    submission_id: i64,
    comment: &CommentInsert,
) -> Result<()> {
    let sql = r#"INSERT INTO submission_comments (submission_id, author, content, created_at)
                 VALUES ($1, $2::jsonb, $3, $4)"#;
    conn.execute(stmt(
        sql,
        vec![
            submission_id.into(),
            comment.author.clone().into(),
            comment.content.clone().into(),
            comment.created_at.into(),
        ],
    ))
    .await
    .context("写入 submission_comments 失败")?;
    Ok(())
}

async fn insert_file_history<C: ConnectionTrait>(
    conn: &C,
    submission_id: i64,
    file: &FileHistoryInsert,
) -> Result<()> {
    let sql = r#"INSERT INTO submission_file_history
                     (submission_id, uploader, uploader_info, file_name, uploaded_at)
                 VALUES ($1, $2, $3::jsonb, $4, $5)"#;
    conn.execute(stmt(
        sql,
        vec![
            submission_id.into(),
            file.uploader.clone().into(),
            file.uploader_info.clone().into(),
            file.file_name.clone().into(),
            file.uploaded_at.into(),
        ],
    ))
    .await
    .context("写入 submission_file_history 失败")?;
    Ok(())
}

fn stmt(sql: &str, params: Vec<Value>) -> Statement {
    Statement::from_sql_and_values(DatabaseBackend::Postgres, sql, params)
}

fn first_line(sql: &str) -> &str {
    sql.lines().next().unwrap_or("").trim()
}
