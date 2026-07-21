use std::collections::HashSet;

use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    QuerySelect, Set, TransactionTrait,
};
use serde_json::json;

use crate::db::models::{
    artist, platform_mapping, song, song_artist, sync_history, sync_progress, sync_state,
};

use super::types::{SyncState, SyncSummary};

/// 插入/更新一首歌曲及其关联数据（事务）
pub struct SongUpsert {
    pub raw_lyric_file: String,
    pub minio_path: String,
    pub music_name: Vec<String>,
    pub album: Vec<String>,
    pub isrc: Option<String>,
    pub lyric_text: Option<String>,
    pub ttml_author_github: Option<String>,
    pub ttml_author_github_login: Option<String>,
    pub word_count: i32,
    pub line_count: i32,
    pub artists: Vec<String>,
    pub platform_mappings: Vec<(String, String)>, // (platform, platform_id)
    /// 从 raw_lyric_file 解析出的提交毫秒时间戳
    pub commit_timestamp: Option<i64>,
    pub commit_time: Option<chrono::DateTime<chrono::FixedOffset>>,
}

#[derive(Clone)]
pub struct Repository {
    db: DatabaseConnection,
}

impl Repository {
    pub fn new(db: DatabaseConnection) -> Self {
        Self { db }
    }

    /// 查询本地已有的 raw_lyric_file 文件名集合
    pub async fn list_raw_lyric_files(&self) -> anyhow::Result<HashSet<String>> {
        tracing::debug!("repository.list_raw_lyric_files - 开始查询本地文件列表");
        let rows = song::Entity::find()
            .select_only()
            .column(song::Column::RawLyricFile)
            .into_tuple::<String>()
            .all(&self.db)
            .await?;
        tracing::debug!("repository.list_raw_lyric_files - 查询完成，共 {} 个文件", rows.len());
        Ok(rows.into_iter().collect())
    }

    /// 统计本地歌曲总数
    pub async fn count_songs(&self) -> anyhow::Result<i64> {
        let count = song::Entity::find()
            .filter(song::Column::IsDeleted.eq(false))
            .count(&self.db)
            .await?;
        Ok(count as i64)
    }

    /// 通过 raw_lyric_file 查找 song id
    pub async fn find_song_id_by_raw(&self, raw: &str) -> anyhow::Result<Option<i64>> {
        tracing::debug!("repository.find_song_id_by_raw - 查找文件: {}", raw);
        let row = song::Entity::find()
            .filter(song::Column::RawLyricFile.eq(raw))
            .select_only()
            .column(song::Column::Id)
            .into_tuple::<i64>()
            .one(&self.db)
            .await?;
        tracing::debug!("repository.find_song_id_by_raw - 查找结果: {:?}", row);
        Ok(row)
    }

    /// 写入/更新一首歌曲及其关联数据（事务）
    pub async fn upsert_song(&self, data: SongUpsert) -> anyhow::Result<i64> {
        tracing::debug!("repository.upsert_song - 开始处理: raw_lyric_file={}", data.raw_lyric_file);
        let txn = self.db.begin().await?;
        tracing::debug!("repository.upsert_song - 事务开始");

        // 查询是否已存在
        tracing::debug!("repository.upsert_song - 查询歌曲是否存在");
        let existing = song::Entity::find()
            .filter(song::Column::RawLyricFile.eq(data.raw_lyric_file.clone()))
            .one(&txn)
            .await?;
        
        let song_id = match existing {
            Some(m) => {
                tracing::debug!("repository.upsert_song - 歌曲已存在，更新记录，id={}", m.id);
                // 更新
                let mut am: song::ActiveModel = m.into();
                am.music_name = Set(json!(data.music_name));
                am.album = Set(json!(data.album));
                am.isrc = Set(data.isrc);
                am.minio_path = Set(data.minio_path);
                am.lyric_text = Set(data.lyric_text);
                am.ttml_author_github = Set(data.ttml_author_github);
                am.ttml_author_github_login = Set(data.ttml_author_github_login);
                am.word_count = Set(data.word_count);
                am.line_count = Set(data.line_count);
                am.commit_timestamp = Set(data.commit_timestamp);
                am.commit_time = Set(data.commit_time.map(|t| t.into()));
                am.updated_at = Set(chrono::Utc::now().into());
                let m = am.update(&txn).await?;
                m.id
            }
            None => {
                tracing::debug!("repository.upsert_song - 歌曲不存在，新增记录");
                // 新增
                let am = song::ActiveModel {
                    music_name: Set(json!(data.music_name)),
                    album: Set(json!(data.album)),
                    isrc: Set(data.isrc),
                    raw_lyric_file: Set(data.raw_lyric_file.clone()),
                    minio_path: Set(data.minio_path),
                    lyric_text: Set(data.lyric_text),
                    ttml_author_github: Set(data.ttml_author_github),
                    ttml_author_github_login: Set(data.ttml_author_github_login),
                    word_count: Set(data.word_count),
                    line_count: Set(data.line_count),
                    commit_timestamp: Set(data.commit_timestamp),
                    commit_time: Set(data.commit_time.map(|t| t.into())),
                    is_deleted: Set(false),
                    ..Default::default()
                };
                let m = song::Entity::insert(am).exec(&txn).await?;
                tracing::debug!("repository.upsert_song - 新增记录成功, id={}", m.last_insert_id);
                m.last_insert_id
            }
        };

        // 清理旧关联
        tracing::debug!("repository.upsert_song - 清理旧关联，song_id={}", song_id);
        song_artist::Entity::delete_many()
            .filter(song_artist::Column::SongId.eq(song_id))
            .exec(&txn)
            .await?;
        tracing::debug!("repository.upsert_song - 清理 song_artist 完成");
        
        platform_mapping::Entity::delete_many()
            .filter(platform_mapping::Column::SongId.eq(song_id))
            .exec(&txn)
            .await?;
        tracing::debug!("repository.upsert_song - 清理 platform_mapping 完成");

        // 写艺术家关联
        tracing::debug!("repository.upsert_song - 写入艺术家关联，artists={:?}", data.artists);
        for name in &data.artists {
            let aid = self.upsert_artist_inner(&txn, name).await?;
            tracing::debug!("repository.upsert_song - 写入 artist: name={}, aid={}", name, aid);
            song_artist::Entity::insert(song_artist::ActiveModel {
                song_id: Set(song_id),
                artist_id: Set(aid),
            })
            .exec(&txn)
            .await?;
        }
        tracing::debug!("repository.upsert_song - 艺术家关联写入完成");

        // 写平台映射
        tracing::debug!("repository.upsert_song - 写入平台映射，platform_mappings={:?}", data.platform_mappings);
        for (platform, pid) in &data.platform_mappings {
            platform_mapping::Entity::insert(platform_mapping::ActiveModel {
                song_id: Set(song_id),
                platform: Set(platform.clone()),
                platform_id: Set(pid.clone()),
                ..Default::default()
            })
            .exec(&txn)
            .await?;
        }
        tracing::debug!("repository.upsert_song - 平台映射写入完成");

        tracing::debug!("repository.upsert_song - 提交事务");
        txn.commit().await?;
        tracing::debug!("repository.upsert_song - 事务提交成功");
        Ok(song_id)
    }

    async fn upsert_artist_inner<C: sea_orm::ConnectionTrait>(
        &self,
        conn: &C,
        name: &str,
    ) -> anyhow::Result<i64> {
        let existing = artist::Entity::find()
            .filter(artist::Column::Name.eq(name))
            .one(conn)
            .await?;
        if let Some(m) = existing {
            return Ok(m.id);
        }
        let am = artist::ActiveModel {
            name: Set(name.to_string()),
            ..Default::default()
        };
        let m = artist::Entity::insert(am).exec(conn).await?;
        Ok(m.last_insert_id)
    }

    /// 删除一首歌曲（按 raw_lyric_file）
    #[allow(dead_code)]
    pub async fn delete_song_by_raw(&self, raw: &str) -> anyhow::Result<bool> {
        let res = song::Entity::delete_many()
            .filter(song::Column::RawLyricFile.eq(raw))
            .exec(&self.db)
            .await?;
        Ok(res.rows_affected > 0)
    }

    // ===== 同步状态 =====

    pub async fn get_sync_state(&self, key: &str) -> anyhow::Result<Option<String>> {
        let m = sync_state::Entity::find_by_id(key.to_string())
            .one(&self.db)
            .await?;
        Ok(m.map(|m| m.value))
    }

    pub async fn set_sync_state(&self, key: &str, value: &str) -> anyhow::Result<()> {
        let am = sync_state::ActiveModel {
            key: Set(key.to_string()),
            value: Set(value.to_string()),
        };
        sync_state::Entity::insert(am)
            .on_conflict(
                sea_orm::sea_query::OnConflict::column(sync_state::Column::Key)
                    .update_column(sync_state::Column::Value)
                    .to_owned(),
            )
            .exec(&self.db)
            .await?;
        Ok(())
    }

    pub async fn get_sync_state_all(&self) -> anyhow::Result<SyncState> {
        tracing::debug!("repository.get_sync_state_all - 开始获取同步状态");
        let last_commit = self
            .get_sync_state("last_synced_commit")
            .await?
            .unwrap_or_default();
        let last_at = self
            .get_sync_state("last_synced_at")
            .await?
            .unwrap_or_default();
        tracing::debug!("repository.get_sync_state_all - 同步状态: last_commit={}, last_at={}", last_commit, last_at);
        Ok(SyncState {
            last_synced_commit: last_commit,
            last_synced_at: last_at,
        })
    }

    // ===== 同步历史 =====

    pub async fn create_sync_history(
        &self,
        target_commit: &str,
        previous_commit: Option<&str>,
        triggered_by: &str,
    ) -> anyhow::Result<i64> {
        tracing::debug!("repository.create_sync_history - target_commit={}, previous_commit={:?}, triggered_by={}", 
                       target_commit, previous_commit, triggered_by);
        let now = chrono::Utc::now();
        let am = sync_history::ActiveModel {
            started_at: Set(now.into()),
            completed_at: Set(None),
            previous_commit: Set(previous_commit.map(|s| s.to_string())),
            target_commit: Set(target_commit.to_string()),
            status: Set("running".to_string()),
            added_count: Set(0),
            updated_count: Set(0),
            deleted_count: Set(0),
            error_message: Set(None),
            triggered_by: Set(triggered_by.to_string()),
            created_at: Set(now.into()),
            ..Default::default()
        };
        let m = sync_history::Entity::insert(am).exec(&self.db).await?;
        tracing::debug!("repository.create_sync_history - 创建成功, history_id={}", m.last_insert_id);
        Ok(m.last_insert_id)
    }

    pub async fn finish_sync_history(
        &self,
        history_id: i64,
        summary: &SyncSummary,
        error_message: Option<&str>,
    ) -> anyhow::Result<()> {
        tracing::debug!("repository.finish_sync_history - history_id={}, summary={:?}, error={:?}", 
                       history_id, summary, error_message);
        let status = if error_message.is_some() {
            "failed"
        } else {
            "success"
        };
        let m = sync_history::Entity::find_by_id(history_id)
            .one(&self.db)
            .await?
            .ok_or_else(|| anyhow::anyhow!("sync_history not found: {}", history_id))?;
        let mut am: sync_history::ActiveModel = m.into();
        am.completed_at = Set(Some(chrono::Utc::now().into()));
        am.status = Set(status.to_string());
        am.added_count = Set(summary.added as i32);
        am.updated_count = Set(summary.updated as i32);
        am.deleted_count = Set(summary.deleted as i32);
        am.error_message = Set(error_message.map(|s| s.to_string()));
        am.update(&self.db).await?;
        tracing::debug!("repository.finish_sync_history - 更新成功");
        Ok(())
    }

    #[allow(dead_code)]
    pub async fn is_sync_running(&self) -> anyhow::Result<bool> {
        let count = sync_history::Entity::find()
            .filter(sync_history::Column::Status.eq("running"))
            .count(&self.db)
            .await?;
        Ok(count > 0)
    }

    /// 清理僵尸 running 状态的同步历史（worker 启动时调用）
    ///
    /// worker 重启后，之前未完成的 running 记录永远不会被 finish，
    /// 会导致 API 端 GetLatestRunningHistory 误判为"正在同步"。
    /// 启动时将这些记录标记为 failed。
    pub async fn cleanup_stale_running_syncs(&self) -> anyhow::Result<u64> {
        use sea_orm::sea_query::Expr;
        let now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().into();
        let res = sync_history::Entity::update_many()
            .col_expr(sync_history::Column::Status, Expr::value("failed"))
            .col_expr(sync_history::Column::CompletedAt, Expr::value(now))
            .col_expr(
                sync_history::Column::ErrorMessage,
                Expr::value("worker restarted, stale running sync"),
            )
            .filter(sync_history::Column::Status.eq("running"))
            .exec(&self.db)
            .await?;
        Ok(res.rows_affected)
    }

    // ===== 同步进度 =====

    pub async fn create_sync_progress(&self, history_id: i64, total: i32) -> anyhow::Result<i64> {
        tracing::debug!("repository.create_sync_progress - history_id={}, total={}", history_id, total);
        let now = chrono::Utc::now();
        let am = sync_progress::ActiveModel {
            sync_history_id: Set(history_id),
            total: Set(total),
            downloaded: Set(0),
            failed: Set(0),
            current_file: Set(None),
            updated_at: Set(now.into()),
            ..Default::default()
        };
        let m = sync_progress::Entity::insert(am).exec(&self.db).await?;
        tracing::debug!("repository.create_sync_progress - 创建成功, progress_id={}", m.last_insert_id);
        Ok(m.last_insert_id)
    }

    pub async fn update_sync_progress(
        &self,
        progress_id: i64,
        downloaded: i32,
        failed: i32,
        current_file: Option<&str>,
    ) -> anyhow::Result<()> {
        let m = sync_progress::Entity::find_by_id(progress_id)
            .one(&self.db)
            .await?
            .ok_or_else(|| anyhow::anyhow!("sync_progress not found: {}", progress_id))?;
        let mut am: sync_progress::ActiveModel = m.into();
        am.downloaded = Set(downloaded);
        am.failed = Set(failed);
        am.current_file = Set(current_file.map(|s| s.to_string()));
        am.updated_at = Set(chrono::Utc::now().into());
        am.update(&self.db).await?;
        Ok(())
    }
}
