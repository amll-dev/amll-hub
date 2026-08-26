use anyhow::{Context, Result};
use meilisearch_sdk::client::Client;
use meilisearch_sdk::indexes::Index;
use serde_json::Value;

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
        })
    }
}

/// 批量更新 MeiliSearch 索引
pub async fn add_documents_in_batches(
    client: &Client,
    index_name: &str,
    documents: Vec<MeiliDocument>,
    batch_size: usize,
) -> Result<()> {
    let index: Index = client.index(index_name);
    let batch_size = if batch_size == 0 { 100 } else { batch_size };

    for chunk in documents.chunks(batch_size) {
        let docs: Vec<Value> = chunk.iter().map(|d| d.to_json()).collect();
        index
            .add_documents(&docs, Some("id"))
            .await
            .context("add_documents")?
            .wait_for_completion(client, None, None)
            .await
            .context("wait add_documents")?;
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
