use anyhow::{Context, Result};
use serde::Deserialize;

/// raw-lyrics-index.jsonl 单行结构
///
/// 实际仓库格式：
/// {"metadata":[["album",["..."]],["artists",["..."]],["musicName",["..."]],["ncmMusicId",["..."]],...],"rawLyricFile":"...-GithubId-xxx.ttml"}
///
/// metadata 为 [["key", ["val1", "val2"]], ...] 格式的键值对数组
/// 旧格式（扁平字段）也兼容：{"ncmMusicId":"...","rawLyricFile":"..."}
#[derive(Debug, Clone, Deserialize, Default)]
pub struct IndexEntry {
    #[serde(default, alias = "rawLyricFile")]
    pub raw_lyric_file: Option<String>,

    /// 新格式：metadata 为 [["key", ["val1", "val2"]], ...] 的键值对数组
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,

    // 旧格式扁平字段（metadata 缺失时作为回退）
    #[serde(default, alias = "ncmMusicId")]
    ncm_music_id: Option<String>,
    #[serde(default, alias = "qqMusicId")]
    qq_music_id: Option<String>,
    #[serde(default, alias = "spotifyId")]
    spotify_id: Option<String>,
    #[serde(default, alias = "appleMusicId")]
    apple_music_id: Option<String>,
    #[serde(default, alias = "musicName")]
    music_name: Option<serde_json::Value>,
    #[serde(default, alias = "album")]
    album: Option<serde_json::Value>,
    #[serde(default, alias = "isrc")]
    isrc: Option<String>,
    #[serde(default, alias = "ttmlAuthorGithub")]
    ttml_author_github: Option<String>,
    #[serde(default, alias = "ttmlAuthorGithubLogin")]
    ttml_author_github_login: Option<String>,
}

impl IndexEntry {
    /// 提取 rawLyricFile（必须存在）
    pub fn raw_file(&self) -> Option<&str> {
        self.raw_lyric_file.as_deref()
    }

    /// 从 rawLyricFile 文件名中提取 GitHub ID 与时间戳
    /// 文件名格式：{timestamp}-{githubId}-{random}.ttml
    pub fn parse_file_meta(&self) -> Option<(u64, Option<String>)> {
        let raw = self.raw_file()?;
        let stem = raw.strip_suffix(".ttml").unwrap_or(raw);
        let mut parts = stem.splitn(3, '-');
        let ts: u64 = parts.next()?.parse().ok()?;
        let github_id = parts.next().map(|s| s.to_string());
        Some((ts, github_id))
    }

    /// 从 metadata 中提取指定 key 的字符串数组
    /// metadata 格式: [["key1", ["val1", "val2"]], ["key2", ["val3"]]]
    fn meta_strings(&self, key: &str) -> Option<Vec<String>> {
        self.metadata.as_ref().and_then(|m| m.as_array()).and_then(|arr| {
            arr.iter().find_map(|pair| {
                let pair_arr = pair.as_array()?;
                if pair_arr.first()?.as_str()? == key {
                    let vals = pair_arr.get(1)?.as_array()?;
                    Some(vals.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect::<Vec<_>>())
                } else {
                    None
                }
            })
        })
    }

    /// 从 metadata 中提取指定 key 的第一个字符串值
    fn meta_string(&self, key: &str) -> Option<String> {
        self.meta_strings(key).and_then(|v| v.into_iter().next())
    }

    /// 收集所有非空平台映射 (platform, platform_id)
    ///
    /// 同一平台可能有多个 ID（一首歌出现在多个专辑版本中），
    /// 因此使用 meta_strings() 提取该平台 key 下的全部值，全部入库。
    pub fn platform_mappings(&self) -> Vec<(String, String)> {
        let mut out = Vec::new();

        // 优先从 metadata 提取（新格式：每个 key 对应数组，支持多值）
        if self.metadata.is_some() {
            for (key, platform) in &[
                ("ncmMusicId", "ncm"),
                ("qqMusicId", "qq"),
                ("spotifyId", "spotify"),
                ("appleMusicId", "apple"),
            ] {
                if let Some(ids) = self.meta_strings(key) {
                    for id in ids {
                        if !id.is_empty() {
                            out.push((platform.to_string(), id));
                        }
                    }
                }
            }
        } else {
            // 回退到扁平字段（旧格式仅支持单值）
            for (id, platform) in &[
                (&self.ncm_music_id, "ncm"),
                (&self.qq_music_id, "qq"),
                (&self.spotify_id, "spotify"),
                (&self.apple_music_id, "apple"),
            ] {
                if let Some(id) = id
                    && !id.is_empty()
                {
                    out.push((platform.to_string(), id.clone()));
                }
            }
        }
        out
    }

    /// 将 music_name 字段规范化为 Vec<String>（优先从 metadata 提取）
    pub fn music_names(&self) -> Vec<String> {
        if let Some(names) = self.meta_strings("musicName") {
            return names;
        }
        json_to_string_array(&self.music_name)
    }

    /// 将 album 字段规范化为 Vec<String>（优先从 metadata 提取）
    pub fn albums(&self) -> Vec<String> {
        if let Some(albums) = self.meta_strings("album") {
            return albums;
        }
        json_to_string_array(&self.album)
    }

    /// 从 metadata 中提取 artists（新格式特有）
    pub fn artists(&self) -> Vec<String> {
        self.meta_strings("artists").unwrap_or_default()
    }

    /// 获取 ISRC（优先从 metadata 提取）
    pub fn isrc(&self) -> Option<String> {
        self.meta_string("isrc").or_else(|| self.isrc.clone())
    }

    /// 获取 ttmlAuthorGithub（优先从 metadata 提取）
    pub fn ttml_author_github(&self) -> Option<String> {
        self.meta_string("ttmlAuthorGithub")
            .or_else(|| self.ttml_author_github.clone())
    }

    /// 获取 ttmlAuthorGithubLogin（优先从 metadata 提取）
    pub fn ttml_author_github_login(&self) -> Option<String> {
        self.meta_string("ttmlAuthorGithubLogin")
            .or_else(|| self.ttml_author_github_login.clone())
    }
}

fn json_to_string_array(v: &Option<serde_json::Value>) -> Vec<String> {
    match v {
        Some(serde_json::Value::Array(arr)) => arr
            .iter()
            .filter_map(|x| x.as_str().map(|s| s.to_string()))
            .collect(),
        Some(serde_json::Value::String(s)) => vec![s.clone()],
        _ => Vec::new(),
    }
}

/// 解析整份 raw-lyrics-index.jsonl
pub fn parse_index(text: &str) -> Result<Vec<IndexEntry>> {
    let mut entries = Vec::new();
    for (lineno, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let entry: IndexEntry =
            serde_json::from_str(line).with_context(|| format!("parse line {}", lineno + 1))?;
        if entry.raw_file().is_some() {
            entries.push(entry);
        }
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_flat_format() {
        let jsonl =
            r#"{"ncmMusicId":"3370944459","rawLyricFile":"1778433565542-115442729-B1QRSIWy.ttml"}"#;
        let parsed = parse_index(jsonl).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(
            parsed[0].raw_file(),
            Some("1778433565542-115442729-B1QRSIWy.ttml")
        );
        assert_eq!(parsed[0].ncm_music_id.as_deref(), Some("3370944459"));
        let (ts, gid) = parsed[0].parse_file_meta().unwrap();
        assert_eq!(ts, 1778433565542);
        assert_eq!(gid.as_deref(), Some("115442729"));
        let maps = parsed[0].platform_mappings();
        assert_eq!(maps, vec![("ncm".to_string(), "3370944459".to_string())]);
    }

    #[test]
    fn parses_metadata_format() {
        let jsonl = r#"{"metadata":[["album",["ウェザーステーション"]],["artists",["稲葉曇","歌愛ユキ"]],["musicName",["ラグトレイン"]],["ncmMusicId",["1921983207"]],["ttmlAuthorGithub",["83578994"]],["ttmlAuthorGithubLogin",["mizuhara37"]]],"rawLyricFile":"1689227417000-83578994-dbf4bcef.ttml"}"#;
        let parsed = parse_index(jsonl).unwrap();
        assert_eq!(parsed.len(), 1);
        let entry = &parsed[0];

        // rawLyricFile
        assert_eq!(entry.raw_file(), Some("1689227417000-83578994-dbf4bcef.ttml"));

        // musicName
        assert_eq!(entry.music_names(), vec!["ラグトレイン"]);

        // album
        assert_eq!(entry.albums(), vec!["ウェザーステーション"]);

        // artists
        assert_eq!(entry.artists(), vec!["稲葉曇", "歌愛ユキ"]);

        // platform mappings
        let maps = entry.platform_mappings();
        assert_eq!(maps, vec![("ncm".to_string(), "1921983207".to_string())]);

        // ttml author
        assert_eq!(entry.ttml_author_github(), Some("83578994".to_string()));
        assert_eq!(entry.ttml_author_github_login(), Some("mizuhara37".to_string()));
    }

    #[test]
    fn parses_metadata_format_multiple_lines() {
        let jsonl = r#"{"metadata":[["album",["ウェザーステーション"]],["artists",["稲葉曇","歌愛ユキ"]],["musicName",["ラグトレイン"]],["ncmMusicId",["1921983207"]],["ttmlAuthorGithub",["83578994"]],["ttmlAuthorGithubLogin",["mizuhara37"]]],"rawLyricFile":"1689227417000-83578994-dbf4bcef.ttml"}
{"metadata":[["album",["アイドル"]],["artists",["YOASOBI"]],["musicName",["アイドル"]],["ncmMusicId",["2034742057"]],["ttmlAuthorGithub",["83578994"]],["ttmlAuthorGithubLogin",["mizuhara37"]]],"rawLyricFile":"1689318244000-83578994-c5a7522e.ttml"}"#;
        let parsed = parse_index(jsonl).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].music_names(), vec!["ラグトレイン"]);
        assert_eq!(parsed[1].music_names(), vec!["アイドル"]);
        assert_eq!(parsed[1].artists(), vec!["YOASOBI"]);
    }

    #[test]
    fn parses_multiple_platform_ids_per_platform() {
        // 一首歌在同一平台有多个 ID（出现在多个专辑版本中），应全部提取
        let jsonl = r#"{"metadata":[["musicName",["Never Gonna Give You Up"]],["ncmMusicId",["18520488","1399616170","1822638886"]],["qqMusicId",["100963973","5114785"]],["spotifyId",["4PTG3Z6ehGkBFwjybzWkR8","4L7qMw8HI3vM57hHRMyb4Y"]],["appleMusicId",["1559885421","1559523359"]]],"rawLyricFile":"1734183883954-50987405-073c6dc6.ttml"}"#;
        let parsed = parse_index(jsonl).unwrap();
        let maps = parsed[0].platform_mappings();
        // ncm 3 个
        let ncm: Vec<&str> = maps.iter().filter(|(p, _)| p == "ncm").map(|(_, v)| v.as_str()).collect();
        assert_eq!(ncm, vec!["18520488", "1399616170", "1822638886"]);
        // qq 2 个
        let qq: Vec<&str> = maps.iter().filter(|(p, _)| p == "qq").map(|(_, v)| v.as_str()).collect();
        assert_eq!(qq, vec!["100963973", "5114785"]);
        // spotify 2 个
        let sp: Vec<&str> = maps.iter().filter(|(p, _)| p == "spotify").map(|(_, v)| v.as_str()).collect();
        assert_eq!(sp, vec!["4PTG3Z6ehGkBFwjybzWkR8", "4L7qMw8HI3vM57hHRMyb4Y"]);
        // apple 2 个
        let ap: Vec<&str> = maps.iter().filter(|(p, _)| p == "apple").map(|(_, v)| v.as_str()).collect();
        assert_eq!(ap, vec!["1559885421", "1559523359"]);
        // 总计 9 个映射
        assert_eq!(maps.len(), 9);
    }
}
