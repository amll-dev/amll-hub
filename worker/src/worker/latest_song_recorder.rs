use std::collections::HashSet;
use std::sync::Arc;

use sea_orm::Set;
use tracing::{info, warn};

use crate::app::AppState;
use crate::db::models::latest_song;
use crate::db::repository::Repository;
use crate::not_found::ncm_api;

/// 最新收录列表最大保留条数
const LATEST_SONGS_MAX: usize = 9;

/// 同步完成后记录最新收录歌曲快照
pub async fn record_latest_songs(app: &Arc<AppState>, repo: &Repository, history_id: i64) {
    // 查询同步历史获取时间窗口
    let history = match repo.get_sync_history_by_id(history_id).await {
        Ok(Some(h)) => h,
        Ok(None) => {
            warn!(history_id, "latest_songs: sync history not found");
            return;
        }
        Err(e) => {
            warn!(error = %e, history_id, "latest_songs: query sync history failed");
            return;
        }
    };

    let started_at = history.started_at;
    let completed_at = match history.completed_at {
        Some(t) => t,
        None => {
            warn!(history_id, "latest_songs: sync history has no completed_at");
            return;
        }
    };

    // 查询同步窗口内新增的歌曲
    let songs = match repo.query_new_songs_in_window(started_at, completed_at, 9).await {
        Ok(s) => s,
        Err(e) => {
            warn!(error = %e, history_id, "latest_songs: query new songs failed");
            return;
        }
    };

    if songs.is_empty() {
        info!(history_id, "latest_songs: no new songs in this sync, skipping");
        return;
    }

    // 新增歌曲 id 集合，合并旧记录时用于去重
    let new_song_ids: HashSet<i64> = songs.iter().map(|(s, _)| s.id).collect();

    // 构建新记录（置于列表头部，sort_order 从 0 开始）
    let now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().into();
    let mut items: Vec<latest_song::ActiveModel> = Vec::with_capacity(LATEST_SONGS_MAX);
    for (i, (song_model, ncm_id)) in songs.into_iter().enumerate() {
        // 从 songs 表 music_name (JSON 数组) 获取标题
        let music_name: Vec<String> =
            serde_json::from_value(song_model.music_name.clone()).unwrap_or_default();
        let mut title = music_name.join(" / ");

        // 从网易云 API 获取歌曲信息（标题、艺术家、封面）
        let mut artist = String::new();
        let mut cover_url = String::new();
        if let Some(ref ncm) = ncm_id
            && let Some((ncm_title, ncm_artist, ncm_cover)) =
                ncm_api::fetch_song_meta(&app.http_client, &app.cfg.ncm.api_base, ncm).await
        {
            if !ncm_title.is_empty() {
                title = ncm_title;
            }
            artist = ncm_artist;
            cover_url = ncm_cover;
        }

        // 网易云信息失败时回退到 songs 表数据
        if artist.is_empty()
            && let Ok(names) = repo.get_artists_by_song_id(song_model.id).await
        {
            artist = names.join(" / ");
        }

        items.push(latest_song::ActiveModel {
            sync_history_id: Set(history_id),
            song_id: Set(song_model.id),
            ncm_id: Set(ncm_id.unwrap_or_default()),
            title: Set(title),
            artist: Set(artist),
            cover_url: Set(cover_url),
            sort_order: Set(i as i32),
            created_at: Set(now),
            ..Default::default()
        });
    }

    // 查询现有记录，顺延合并到新记录之后（保留原有的 sync_history_id / created_at）
    let existing = match repo.list_latest_songs().await {
        Ok(rows) => rows,
        Err(e) => {
            warn!(error = %e, history_id, "latest_songs: query existing records failed");
            return;
        }
    };
    let kept_before = existing.len();
    for old in existing {
        // 与新歌曲重复的旧记录不再保留；列表满 LATEST_SONGS_MAX 条后丢弃尾部多余旧记录
        if new_song_ids.contains(&old.song_id) || items.len() >= LATEST_SONGS_MAX {
            continue;
        }
        items.push(latest_song::ActiveModel {
            sync_history_id: Set(old.sync_history_id),
            song_id: Set(old.song_id),
            ncm_id: Set(old.ncm_id),
            title: Set(old.title),
            artist: Set(old.artist),
            cover_url: Set(old.cover_url),
            sort_order: Set(items.len() as i32),
            created_at: Set(old.created_at),
            ..Default::default()
        });
    }

    let new_count = new_song_ids.len();
    let kept_old = items.len() - new_count;
    match repo.replace_all_latest_songs(items).await {
        Ok(()) => info!(
            history_id,
            new_count,
            kept_old,
            dropped_old = kept_before.saturating_sub(kept_old),
            "latest_songs: recorded new sync snapshot"
        ),
        Err(e) => warn!(error = %e, history_id, "latest_songs: replace records failed"),
    }
}
