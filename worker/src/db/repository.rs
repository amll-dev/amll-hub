use std::collections::{HashMap, HashSet};

use anyhow::Result;
use sea_orm::sea_query::OnConflict;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, QueryTrait, Set, TransactionTrait,
};
use sea_orm::sea_query::Expr;
use serde_json::json;

use crate::db::models::{
    artist, latest_song, platform_mapping, song, song_artist, song_group, sync_history,
    sync_progress, sync_state,
};
use crate::sync::grouping::{GroupAssignment, GroupInput};
use crate::sync::index_parser::IndexEntry;

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
    pub async fn list_raw_lyric_files(&self) -> Result<HashSet<String>> {
        let rows = song::Entity::find()
            .filter(song::Column::IsDeleted.eq(false))
            .select_only()
            .column(song::Column::RawLyricFile)
            .into_tuple::<String>()
            .all(&self.db)
            .await?;
        Ok(rows.into_iter().collect())
    }

    /// 统计本地歌曲总数
    pub async fn count_songs(&self) -> Result<i64> {
        let count = song::Entity::find()
            .filter(song::Column::IsDeleted.eq(false))
            .count(&self.db)
            .await?;
        Ok(count as i64)
    }

    /// 通过 raw_lyric_file 查找 song id
    pub async fn find_song_id_by_raw(&self, raw: &str) -> Result<Option<i64>> {
        let row = song::Entity::find()
            .filter(song::Column::RawLyricFile.eq(raw))
            .select_only()
            .column(song::Column::Id)
            .into_tuple::<i64>()
            .one(&self.db)
            .await?;
        Ok(row)
    }

    /// 写入/更新一首歌曲及其关联数据
    pub async fn upsert_song(&self, data: SongUpsert) -> Result<i64> {
        let mut last_err = None;
        for attempt in 0..2 {
            match self.upsert_song_inner(&data).await {
                Ok(id) => return Ok(id),
                Err(e) => {
                    if attempt == 0 && Self::is_unique_violation(&e) {
                        tracing::warn!(
                            raw = %data.raw_lyric_file,
                            "并发插入冲突，重试 upsert 走更新分支"
                        );
                        last_err = Some(e);
                        continue;
                    }
                    return Err(e);
                }
            }
        }
        Err(last_err.expect("at least one attempt"))
    }

    /// 判断错误链中是否为唯一约束冲突
    fn is_unique_violation(err: &anyhow::Error) -> bool {
        err.chain().any(|e| {
            let msg = e.to_string();
            msg.contains("23505") || msg.contains("duplicate key value violates unique constraint")
        })
    }

    async fn upsert_song_inner(&self, data: &SongUpsert) -> Result<i64> {
        let txn = self.db.begin().await?;

        // 查询是否已存在
        let existing = song::Entity::find()
            .filter(song::Column::RawLyricFile.eq(data.raw_lyric_file.clone()))
            .one(&txn)
            .await?;

        let song_id = match existing {
            Some(m) => {
                // 更新
                let mut am: song::ActiveModel = m.into();
                am.music_name = Set(json!(data.music_name));
                am.album = Set(json!(data.album));
                am.isrc = Set(data.isrc.clone());
                am.minio_path = Set(data.minio_path.clone());
                am.lyric_text = Set(data.lyric_text.clone());
                am.ttml_author_github = Set(data.ttml_author_github.clone());
                am.ttml_author_github_login = Set(data.ttml_author_github_login.clone());
                am.word_count = Set(data.word_count);
                am.line_count = Set(data.line_count);
                am.commit_timestamp = Set(data.commit_timestamp);
                am.commit_time = Set(data.commit_time);
                // 文件被远端删除后重新出现时，恢复为未删除
                am.is_deleted = Set(false);
                am.updated_at = Set(chrono::Utc::now().into());
                let m = am.update(&txn).await?;
                m.id
            }
            None => {
                // 新增
                let am = song::ActiveModel {
                    music_name: Set(json!(data.music_name)),
                    album: Set(json!(data.album)),
                    isrc: Set(data.isrc.clone()),
                    raw_lyric_file: Set(data.raw_lyric_file.clone()),
                    minio_path: Set(data.minio_path.clone()),
                    lyric_text: Set(data.lyric_text.clone()),
                    ttml_author_github: Set(data.ttml_author_github.clone()),
                    ttml_author_github_login: Set(data.ttml_author_github_login.clone()),
                    word_count: Set(data.word_count),
                    line_count: Set(data.line_count),
                    commit_timestamp: Set(data.commit_timestamp),
                    commit_time: Set(data.commit_time),
                    is_deleted: Set(false),
                    ..Default::default()
                };
                let m = song::Entity::insert(am).exec(&txn).await?;
                m.last_insert_id
            }
        };

        // 清理旧关联
        song_artist::Entity::delete_many()
            .filter(song_artist::Column::SongId.eq(song_id))
            .exec(&txn)
            .await?;

        platform_mapping::Entity::delete_many()
            .filter(platform_mapping::Column::SongId.eq(song_id))
            .exec(&txn)
            .await?;

        // 写艺术家关联
        let mut seen_artists = HashSet::new();
        for name in &data.artists {
            if !seen_artists.insert(name.as_str()) {
                continue;
            }
            let aid = self.upsert_artist_inner(&txn, name).await?;
            song_artist::Entity::insert(song_artist::ActiveModel {
                song_id: Set(song_id),
                artist_id: Set(aid),
                ..Default::default()
            })
            .exec(&txn)
            .await?;
        }

        // 写平台映射
        let mut seen_pm = HashSet::new();
        for (platform, pid) in &data.platform_mappings {
            if !seen_pm.insert((platform.as_str(), pid.as_str())) {
                continue;
            }
            platform_mapping::Entity::insert(platform_mapping::ActiveModel {
                song_id: Set(song_id),
                platform: Set(platform.clone()),
                platform_id: Set(pid.clone()),
                ..Default::default()
            })
            // 唯一约束是 (song_id, platform, platform_id)：不同历史版本可以共享平台 ID，
            // 只有同一首歌的并发重复写入才需要跳过。
            .on_conflict(
                sea_orm::sea_query::OnConflict::columns([
                    platform_mapping::Column::SongId,
                    platform_mapping::Column::Platform,
                    platform_mapping::Column::PlatformId,
                ])
                .do_nothing()
                .to_owned(),
            )
            .exec(&txn)
            .await?;
        }

        txn.commit().await?;
        Ok(song_id)
    }

    /// 并发安全的艺术家
    async fn upsert_artist_inner<C: sea_orm::ConnectionTrait>(
        &self,
        conn: &C,
        name: &str,
    ) -> Result<i64> {
        use sea_orm::sea_query::OnConflict;

        match artist::Entity::insert(artist::ActiveModel {
            name: Set(name.to_string()),
            ..Default::default()
        })
        .on_conflict(
            OnConflict::column(artist::Column::Name)
                .do_nothing()
                .to_owned(),
        )
        .exec(conn)
        .await
        {
            Ok(_) => {}
            // 冲突时 Postgres 不返回行，SeaORM 报 RecordNotInserted，属预期情况
            Err(sea_orm::DbErr::RecordNotInserted) => {}
            Err(e) => return Err(anyhow::Error::new(e).context("insert artist")),
        }
        let m = artist::Entity::find()
            .filter(artist::Column::Name.eq(name))
            .one(conn)
            .await?
            .ok_or_else(|| anyhow::anyhow!("artist 不存在且插入失败: {}", name))?;
        Ok(m.id)
    }

    /// 软删除歌曲（is_deleted=true），返回歌曲 ID（已删除或不存在时返回 None）
    pub async fn soft_delete_song_by_raw(&self, raw: &str) -> Result<Option<i64>> {
        let res = song::Entity::update_many()
            .filter(song::Column::RawLyricFile.eq(raw))
            .filter(song::Column::IsDeleted.eq(false))
            .col_expr(song::Column::IsDeleted, Expr::value(true))
            .exec(&self.db)
            .await?;
        if res.rows_affected == 0 {
            return Ok(None);
        }
        self.find_song_id_by_raw(raw).await
    }

    // ===== 同步状态 =====

    pub async fn get_sync_state(&self, key: &str) -> Result<Option<String>> {
        let m = sync_state::Entity::find_by_id(key.to_string())
            .one(&self.db)
            .await?;
        Ok(m.map(|m| m.value))
    }

    pub async fn set_sync_state(&self, key: &str, value: &str) -> Result<()> {
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

    pub async fn get_sync_state_all(&self) -> Result<SyncState> {
        let last_commit = self
            .get_sync_state("last_synced_commit")
            .await?
            .unwrap_or_default();
        let last_at = self
            .get_sync_state("last_synced_at")
            .await?
            .unwrap_or_default();
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
    ) -> Result<i64> {
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
        Ok(m.last_insert_id)
    }

    pub async fn finish_sync_history(
        &self,
        history_id: i64,
        summary: &SyncSummary,
        error_message: Option<&str>,
    ) -> Result<()> {
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
        Ok(())
    }

    /// 清理僵尸 running 状态的同步历史
    ///
    /// 只清理 started_at 早于 stale_before 的记录：滚动发布 / 多副本时，
    /// 另一副本正在跑的同步不能被新副本一启动就判失败。
    pub async fn cleanup_stale_running_syncs(
        &self,
        stale_before: chrono::DateTime<chrono::FixedOffset>,
    ) -> Result<u64> {
        let now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().into();
        let res = sync_history::Entity::update_many()
            .col_expr(sync_history::Column::Status, Expr::value("failed"))
            .col_expr(sync_history::Column::CompletedAt, Expr::value(now))
            .col_expr(
                sync_history::Column::ErrorMessage,
                Expr::value("worker restarted, stale running sync"),
            )
            .filter(sync_history::Column::Status.eq("running"))
            .filter(sync_history::Column::StartedAt.lt(stale_before))
            .exec(&self.db)
            .await?;
        Ok(res.rows_affected)
    }

    // ===== 同步进度 =====

    pub async fn create_sync_progress(&self, history_id: i64, total: i32) -> Result<i64> {
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
        Ok(m.last_insert_id)
    }

    pub async fn update_sync_progress(
        &self,
        progress_id: i64,
        downloaded: i32,
        failed: i32,
        current_file: Option<&str>,
    ) -> Result<()> {
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

    // 最新收录

    /// 按 ID 查询同步历史（获取 started_at / completed_at 时间窗口）
    pub async fn get_sync_history_by_id(
        &self,
        history_id: i64,
    ) -> Result<Option<sync_history::Model>> {
        Ok(sync_history::Entity::find_by_id(history_id)
            .one(&self.db)
            .await?)
    }

    /// 查询同步窗口内新增的歌曲（最多 limit 首），附带 NCM / QQ 音乐 platform_id
    pub async fn query_new_songs_in_window(
        &self,
        start: chrono::DateTime<chrono::FixedOffset>,
        end: chrono::DateTime<chrono::FixedOffset>,
        limit: u64,
    ) -> Result<Vec<(song::Model, Option<String>, Option<String>)>> {
        let songs = song::Entity::find()
            .filter(song::Column::IsDeleted.eq(false))
            .filter(song::Column::CreatedAt.between(start, end))
            .order_by_desc(song::Column::CreatedAt)
            .limit(limit)
            .all(&self.db)
            .await?;

        let mut results = Vec::with_capacity(songs.len());
        for s in songs {
            let ncm_id = self.get_platform_id(s.id, "ncm").await?;
            let qq_id = self.get_platform_id(s.id, "qq").await?;
            results.push((s, ncm_id, qq_id));
        }
        Ok(results)
    }

    /// 查询歌曲在指定平台的 platform_id
    pub async fn get_platform_id(
        &self,
        song_id: i64,
        platform: &str,
    ) -> Result<Option<String>> {
        Ok(platform_mapping::Entity::find()
            .filter(platform_mapping::Column::SongId.eq(song_id))
            .filter(platform_mapping::Column::Platform.eq(platform))
            .one(&self.db)
            .await?
            .map(|m| m.platform_id))
    }

    /// 查询歌曲的艺术家名称列表
    pub async fn get_artists_by_song_id(&self, song_id: i64) -> Result<Vec<String>> {
        let rows = song_artist::Entity::find()
            .filter(song_artist::Column::SongId.eq(song_id))
            .find_also_related(artist::Entity)
            .all(&self.db)
            .await?;
        Ok(rows
            .into_iter()
            .filter_map(|(_, a)| a.map(|a| a.name))
            .collect())
    }

    /// 查询当前最新收录列表（按 sort_order 升序）
    pub async fn list_latest_songs(&self) -> Result<Vec<latest_song::Model>> {
        let rows = latest_song::Entity::find()
            .order_by_asc(latest_song::Column::SortOrder)
            .all(&self.db)
            .await?;
        Ok(rows)
    }

    /// 清空并重写 latest_songs 表
    pub async fn replace_all_latest_songs(
        &self,
        items: Vec<latest_song::ActiveModel>,
    ) -> Result<()> {
        let txn = self.db.begin().await?;
        latest_song::Entity::delete_many().exec(&txn).await?;
        if !items.is_empty() {
            latest_song::Entity::insert_many(items).exec(&txn).await?;
        }
        txn.commit().await?;
        Ok(())
    }

    // ===== 索引层预分组（song_groups） =====

    /// 从远端索引全量重建 platform_mappings（一次性修复历史版本关联）
    ///
    /// 旧库在 UNIQUE(platform, platform_id) 下会把多个历史版本共享的平台 ID
    /// 收敛到一首歌上；这里以远端索引为权威来源，恢复每首歌自己的映射。
    /// 只重写数据库中已存在的歌曲，本次新下载的文件随后由 upsert_song 写入。
    pub async fn rebuild_platform_mappings(&self, entries: &[IndexEntry]) -> Result<u64> {
        let songs: Vec<(i64, String)> = song::Entity::find()
            .select_only()
            .column(song::Column::Id)
            .column(song::Column::RawLyricFile)
            .filter(song::Column::IsDeleted.eq(false))
            .into_tuple()
            .all(&self.db)
            .await?;
        let by_raw: HashMap<&str, i64> =
            songs.iter().map(|(id, raw)| (raw.as_str(), *id)).collect();

        let mut seen = HashSet::new();
        let mut rows: Vec<(i64, String, String)> = Vec::new();
        for entry in entries {
            let Some(raw) = entry.raw_file() else {
                continue;
            };
            let Some(&song_id) = by_raw.get(raw) else {
                continue;
            };
            for (platform, platform_id) in entry.platform_mappings() {
                if platform_id.is_empty() {
                    continue;
                }
                if seen.insert((song_id, platform.clone(), platform_id.clone())) {
                    rows.push((song_id, platform, platform_id));
                }
            }
        }

        let txn = self.db.begin().await?;
        platform_mapping::Entity::delete_many().exec(&txn).await?;
        const INSERT_BATCH: usize = 2000;
        for chunk in rows.chunks(INSERT_BATCH) {
            let models = chunk
                .iter()
                .map(|(song_id, platform, platform_id)| platform_mapping::ActiveModel {
                    song_id: Set(*song_id),
                    platform: Set(platform.clone()),
                    platform_id: Set(platform_id.clone()),
                    ..Default::default()
                })
                .collect::<Vec<_>>();
            platform_mapping::Entity::insert_many(models).exec(&txn).await?;
        }
        txn.commit().await?;

        Ok(rows.len() as u64)
    }


    /// 一次性加载全部未删除歌曲的分组输入
    pub async fn load_group_inputs(&self) -> Result<Vec<GroupInput>> {
        // ① 歌曲基础信息（只取需要的列，避开 lyric_text 这种大字段）
        let rows: Vec<(i64, serde_json::Value, Option<i64>)> = song::Entity::find()
            .select_only()
            .column(song::Column::Id)
            .column(song::Column::MusicName)
            .column(song::Column::CommitTimestamp)
            .filter(song::Column::IsDeleted.eq(false))
            .into_tuple()
            .all(&self.db)
            .await?;

        let valid: HashSet<i64> = rows.iter().map(|(id, _, _)| *id).collect();

        // ② 平台映射：全表取回后在内存过滤
        //    （soft delete 不会级联删 platform_mappings，必须显式排除）
        let pms: Vec<(i64, String, String)> = platform_mapping::Entity::find()
            .select_only()
            .column(platform_mapping::Column::SongId)
            .column(platform_mapping::Column::Platform)
            .column(platform_mapping::Column::PlatformId)
            .into_tuple()
            .all(&self.db)
            .await?;

        // ③ 歌手名：song_artists 已声明 belongs_to artist，可直接 inner_join
        let arts: Vec<(i64, String)> = song_artist::Entity::find()
            .select_only()
            .column(song_artist::Column::SongId)
            .column(artist::Column::Name)
            .inner_join(artist::Entity)
            .into_tuple()
            .all(&self.db)
            .await?;

        let mut pm_map: HashMap<i64, Vec<(String, String)>> = HashMap::new();
        for (sid, p, pid) in pms {
            if valid.contains(&sid) {
                pm_map.entry(sid).or_default().push((p, pid));
            }
        }
        let mut art_map: HashMap<i64, Vec<String>> = HashMap::new();
        for (sid, name) in arts {
            if valid.contains(&sid) {
                art_map.entry(sid).or_default().push(name);
            }
        }

        Ok(rows
            .into_iter()
            .map(|(id, music_name, ts)| GroupInput {
                song_id: id,
                music_name: serde_json::from_value(music_name).unwrap_or_default(),
                artists: art_map.remove(&id).unwrap_or_default(),
                platform_mappings: pm_map.remove(&id).unwrap_or_default(),
                commit_timestamp: ts,
            })
            .collect())
    }

    /// 读取现存分组（用于变更检测）
    pub async fn load_song_groups(&self) -> Result<HashMap<i64, (i64, bool)>> {
        let rows: Vec<(i64, i64, bool)> = song_group::Entity::find()
            .select_only()
            .column(song_group::Column::SongId)
            .column(song_group::Column::GroupId)
            .column(song_group::Column::IsHead)
            .into_tuple()
            .all(&self.db)
            .await?;
        Ok(rows.into_iter().map(|(s, g, h)| (s, (g, h))).collect())
    }

    /// 清理软删歌曲残留的分组行（ON DELETE CASCADE 只在硬删时触发）
    pub async fn delete_orphan_song_groups(&self) -> Result<u64> {
        let res = song_group::Entity::delete_many()
            .filter(
                song_group::Column::SongId.in_subquery(
                    song::Entity::find()
                        .select_only()
                        .column(song::Column::Id)
                        .filter(song::Column::IsDeleted.eq(true))
                        .into_query(),
                ),
            )
            .exec(&self.db)
            .await?;
        Ok(res.rows_affected)
    }

    /// 批量 upsert 分组结果（调用方保证只传变更行）
    pub async fn upsert_song_groups(&self, rows: &[GroupAssignment]) -> Result<()> {
        if rows.is_empty() {
            return Ok(());
        }
        let now = chrono::Utc::now().fixed_offset();
        for chunk in rows.chunks(1000) {
            let models: Vec<song_group::ActiveModel> = chunk
                .iter()
                .map(|g| song_group::ActiveModel {
                    song_id: Set(g.song_id),
                    group_id: Set(g.group_id),
                    is_head: Set(g.is_head),
                    computed_at: Set(now),
                })
                .collect();

            song_group::Entity::insert_many(models)
                .on_conflict(
                    OnConflict::column(song_group::Column::SongId)
                        .update_columns([
                            song_group::Column::GroupId,
                            song_group::Column::IsHead,
                            song_group::Column::ComputedAt,
                        ])
                        .to_owned(),
                )
                .exec_without_returning(&self.db)
                .await?;
        }
        Ok(())
    }

    pub async fn count_song_groups(&self) -> Result<i64> {
        Ok(song_group::Entity::find().count(&self.db).await? as i64)
    }
}
