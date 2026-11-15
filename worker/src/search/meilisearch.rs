use std::time::Duration;

use anyhow::{Context, Result};
use meilisearch_sdk::client::Client;
use meilisearch_sdk::indexes::Index;
use serde_json::Value;

/// 单批提交的最大尝试次数（含首次）
const BATCH_MAX_ATTEMPTS: u32 = 3;
/// wait_for_completion 的显式超时：大批量歌词文本索引不能用 SDK 默认超时
const TASK_TIMEOUT: Duration = Duration::from_secs(600);
/// 批次重试的基础退避
const BATCH_RETRY_DELAY: Duration = Duration::from_secs(2);

/// 索引文档
pub struct MeiliDocument {
    pub id: String,
    pub music_names: Vec<String>,
    pub music_names_pinyin: Vec<String>,
    /// 歌名拼音首字母
    pub music_names_initials: Vec<String>,
    pub artists: Vec<String>,
    pub artists_pinyin: Vec<String>,
    pub artists_initials: Vec<String>,
    pub albums: Vec<String>,
    pub albums_pinyin: Vec<String>,
    pub albums_initials: Vec<String>,
    pub lyric_text: String,
    /// 平台 ID 列表
    pub platform_ids_ncm: Vec<String>,
    pub platform_ids_qq: Vec<String>,
    pub platform_ids_spotify: Vec<String>,
    pub platform_ids_apple: Vec<String>,
    pub raw_lyric_file: String,
    pub ttml_author_github: Option<String>,
    pub ttml_author_github_login: Option<String>,
    pub word_count: i64,
    pub line_count: i64,
    /// 提交时间戳（毫秒），用于搜索结果按新旧排序
    pub commit_timestamp: Option<i64>,
    /// 所属分组 ID（组内最小 song_id），由同步后的分组重算写入
    pub song_group_id: i64,
    /// 是否为组内代表版本，Go 侧 isGroupHead = true 过滤依赖此字段
    pub is_group_head: bool,
}

impl MeiliDocument {
    pub fn to_json(&self) -> Value {
        serde_json::json!({
            "id": self.id,
            "musicNames": self.music_names,
            "musicNamesPinyin": self.music_names_pinyin,
            "musicNamesInitials": self.music_names_initials,
            "artists": self.artists,
            "artistsPinyin": self.artists_pinyin,
            "artistsInitials": self.artists_initials,
            "albums": self.albums,
            "albumsPinyin": self.albums_pinyin,
            "albumsInitials": self.albums_initials,
            "lyricText": self.lyric_text,
            "platformIds_ncm": self.platform_ids_ncm,
            "platformIds_qq": self.platform_ids_qq,
            "platformIds_spotify": self.platform_ids_spotify,
            "platformIds_apple": self.platform_ids_apple,
            "rawLyricFile": self.raw_lyric_file,
            "ttmlAuthorGithub": self.ttml_author_github,
            "ttmlAuthorGithubLogin": self.ttml_author_github_login,
            "wordCount": self.word_count,
            "lineCount": self.line_count,
            "commitTimestamp": self.commit_timestamp,
            "songGroupId": self.song_group_id,
            "isGroupHead": self.is_group_head,
        })
    }
}

/// 批量更新 MeiliSearch 索引
///
/// 逐批提交存在「第 k 批失败、前 k-1 批已入库」的缺口：整轮同步返回错误后
/// sync_state 不推进，下一轮 diff 以本地 DB 为准，缺失文档不会被重新提交。
/// 因此这里对失败批次做有限重试 + 显式超时；仍失败时把失败批次的文档 id 带进错误，
/// 由调用方标记该轮需全量重建索引（见 sync_task.rs 的 force_full_reindex）。
pub async fn add_documents_in_batches(
    client: &Client,
    index_name: &str,
    documents: Vec<MeiliDocument>,
    batch_size: usize,
) -> Result<()> {
    let index: Index = client.index(index_name);
    let batch_size = if batch_size == 0 { 100 } else { batch_size };

    for (batch_idx, chunk) in documents.chunks(batch_size).enumerate() {
        let docs: Vec<Value> = chunk.iter().map(|d| d.to_json()).collect();
        let ids: Vec<String> = chunk.iter().map(|d| d.id.clone()).collect();

        let mut last_err: Option<anyhow::Error> = None;
        for attempt in 1..=BATCH_MAX_ATTEMPTS {
            let submitted = async {
                index
                    .add_documents(&docs, Some("id"))
                    .await
                    .context("add_documents")?
                    .wait_for_completion(client, None, Some(TASK_TIMEOUT))
                    .await
                    .context("wait add_documents")?;
                Ok::<(), anyhow::Error>(())
            }
            .await;

            match submitted {
                Ok(()) => {
                    last_err = None;
                    break;
                }
                Err(e) => {
                    last_err = Some(e);
                    if attempt < BATCH_MAX_ATTEMPTS {
                        tracing::warn!(
                            batch = batch_idx + 1,
                            attempt,
                            docs = docs.len(),
                            error = %last_err.as_ref().unwrap(),
                            "MeiliSearch 批次提交失败，准备重试"
                        );
                        tokio::time::sleep(BATCH_RETRY_DELAY * attempt).await;
                    }
                }
            }
        }

        if let Some(e) = last_err {
            anyhow::bail!(
                "MeiliSearch 第 {} 批（{} 条）提交失败，前 {} 批已入库，需全量重建索引: {:#}；失败文档 id 前 10 个: {:?}",
                batch_idx + 1,
                docs.len(),
                batch_idx,
                e,
                &ids[..ids.len().min(10)]
            );
        }
    }

    Ok(())
}

/// 删除索引文档（按 raw_lyric_file -> id 关联，id 形如 "song_{song_id}"）
pub async fn delete_documents(client: &Client, index_name: &str, ids: &[String]) -> Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let index: Index = client.index(index_name);
    let refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
    index
        .delete_documents(&refs)
        .await
        .context("delete_documents")?
        .wait_for_completion(client, None, None)
        .await
        .context("wait delete_documents")?;
    Ok(())
}

/// 分组字段的部分更新载荷：只带主键与三个分组字段
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GroupPatch {
    pub id: String,
    #[serde(rename = "songGroupId")]
    pub song_group_id: i64,
    #[serde(rename = "isGroupHead")]
    pub is_group_head: bool,
}

/// 只更新分组的三个字段
///
/// ★ 必须用 add_or_update（PATCH 语义），不能用 add_documents
///   —— 后者是 add_or_replace 的别名，会把文档整体替换掉，歌词等字段全部丢失。
///   注意 0.27 版本没有名为 update_documents 的方法，部分更新就是 add_or_update。
pub async fn patch_group_fields(
    client: &Client,
    index_name: &str,
    patches: &[GroupPatch],
) -> Result<()> {
    if patches.is_empty() {
        return Ok(());
    }
    let index: Index = client.index(index_name);
    for chunk in patches.chunks(1000) {
        index
            .add_or_update(chunk, Some("id"))
            .await
            .context("add_or_update(group)")?
            .wait_for_completion(client, None, None)
            .await
            .context("wait add_or_update(group)")?;
    }
    Ok(())
}
