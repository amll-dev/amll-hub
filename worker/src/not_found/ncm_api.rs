use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

/// 解析上下文（包含 API 地址配置）
#[derive(Debug, Clone)]
pub struct ParseContext {
    pub ncm_api_base: String,
}

impl ParseContext {
    pub fn new(ncm_api_base: String) -> Self {
        Self { ncm_api_base }
    }
}

/// 网易云歌曲详情响应
#[derive(Debug, Deserialize)]
struct SongDetailResponse {
    code: i32,
    songs: Option<Vec<SongDetail>>,
}

#[derive(Debug, Deserialize)]
struct SongDetail {
    #[serde(rename = "t")]
    song_type: Option<i32>,
    name: Option<String>,
    #[serde(default)]
    ar: Vec<Artist>,
    al: Option<Album>,
}

#[derive(Debug, Deserialize)]
struct Artist {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Album {
    name: Option<String>,
    #[serde(rename = "picUrl")]
    pic_url: Option<String>,
}

/// 从详情接口提取的歌曲元数据
#[derive(Debug, Default, Clone)]
pub struct SongMeta {
    pub song_type: Option<i32>,
    pub name: String,
    pub artists: Vec<String>,
    pub album: String,
    pub cover: String,
}

/// 网易云歌词响应
#[derive(Debug, Deserialize)]
struct LyricResponse {
    code: i32,
    lrc: Option<LrcContent>,
}

#[derive(Debug, Deserialize)]
struct LrcContent {
    lyric: Option<String>,
}

/// 解析结果分类
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ParseCategory {
    /// 纯音乐
    PureMusic,
    /// 云盘音乐
    CloudMusic,
    /// 无歌词
    NotFound,
    /// API 调用失败
    ApiFailed,
}

#[derive(Debug, Serialize)]
pub struct ParseResult {
    pub category: ParseCategory,
    pub song_name: String,
    pub artists: Vec<String>,
    pub cover: String,
    pub album: String,
}

/// 调用网易云详情 API 检查歌曲类型并提取元数据
pub async fn fetch_song_detail(
    client: &reqwest::Client,
    api_base: &str,
    platform_id: &str,
) -> Result<SongMeta> {
    // platform_id 来自消息队列，需 URL 编码防止破坏查询串
    let url = format!(
        "{}/song/detail?ids={}",
        api_base,
        urlencoding::encode(platform_id)
    );
    let resp = client.get(&url).send().await.context("fetch song detail")?;

    if !resp.status().is_success() {
        anyhow::bail!("song detail API returned status: {}", resp.status());
    }

    let body: SongDetailResponse = resp.json().await.context("parse song detail response")?;

    if body.code != 200 {
        anyhow::bail!("song detail API code: {}", body.code);
    }

    if let Some(first) = body.songs.and_then(|songs| songs.into_iter().next()) {
        let artists = first
            .ar
            .into_iter()
            .filter_map(|a| a.name.filter(|n| !n.is_empty()))
            .collect();
        let (album, cover) = first
            .al
            .map(|al| (al.name.unwrap_or_default(), al.pic_url.unwrap_or_default()))
            .unwrap_or_default();
        return Ok(SongMeta {
            song_type: first.song_type,
            name: first.name.unwrap_or_default(),
            artists,
            album,
            cover,
        });
    }

    Ok(SongMeta::default())
}

/// 获取歌曲的展示元数据
pub async fn fetch_song_meta(
    client: &reqwest::Client,
    api_base: &str,
    platform_id: &str,
) -> Option<(String, String, String)> {
    let meta = fetch_song_detail(client, api_base, platform_id).await.ok()?;
    let artist = meta.artists.join(" / ");
    Some((meta.name, artist, meta.cover))
}

/// 调用网易云歌词 API 检查是否纯音乐
async fn fetch_lyric(client: &reqwest::Client, api_base: &str, platform_id: &str) -> Result<Option<String>> {
    let url = format!(
        "{}/lyric?id={}",
        api_base,
        urlencoding::encode(platform_id)
    );
    let resp = client.get(&url).send().await.context("fetch lyric")?;

    if !resp.status().is_success() {
        anyhow::bail!("lyric API returned status: {}", resp.status());
    }

    let body: LyricResponse = resp.json().await.context("parse lyric response")?;

    if body.code != 200 {
        anyhow::bail!("lyric API code: {}", body.code);
    }

    Ok(body.lrc.and_then(|l| l.lyric))
}

/// 纯音乐关键词匹配
fn is_pure_music_keyword(text: &str) -> bool {
    let text_lower = text.to_lowercase();
    let keywords = [
        "pure",
        "instrumental",
        "karaoke",
        "accompaniment",
        "纯音乐",
        "伴奏",
        "器乐",
        "无歌词",
    ];
    keywords.iter().any(|k| text_lower.contains(k))
}

/// 解析单个歌曲并返回分类
pub async fn parse_and_categorize(
    client: &reqwest::Client,
    ctx: &ParseContext,
    platform: &str,
    platform_id: &str,
) -> Result<ParseResult> {
    // 目前仅支持 ncm 平台
    if platform != "ncm" {
        return Ok(ParseResult {
            category: ParseCategory::NotFound,
            song_name: String::new(),
            artists: Vec::new(),
            cover: String::new(),
            album: String::new(),
        });
    }

    // 1. 查询歌曲详情
    let meta = match fetch_song_detail(client, &ctx.ncm_api_base, platform_id).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, platform_id, "fetch song detail failed");
            return Ok(ParseResult {
                category: ParseCategory::ApiFailed,
                song_name: String::new(),
                artists: Vec::new(),
                cover: String::new(),
                album: String::new(),
            });
        }
    };

    // 2. t=1 或 t=2则云盘音乐
    if matches!(meta.song_type, Some(1) | Some(2)) {
        return Ok(ParseResult {
            category: ParseCategory::CloudMusic,
            song_name: meta.name,
            artists: meta.artists,
            cover: meta.cover,
            album: meta.album,
        });
    }

    // 3. t=0 或 None则查歌词判断纯音乐
    let lyric = match fetch_lyric(client, &ctx.ncm_api_base, platform_id).await {
        Ok(l) => l,
        Err(e) => {
            tracing::warn!(error = %e, platform_id, "fetch lyric failed");
            return Ok(ParseResult {
                category: ParseCategory::ApiFailed,
                song_name: meta.name,
                artists: meta.artists,
                cover: meta.cover,
                album: meta.album,
            });
        }
    };

    if let Some(ref lyric_text) = lyric
        && is_pure_music_keyword(lyric_text)
    {
        return Ok(ParseResult {
            category: ParseCategory::PureMusic,
            song_name: meta.name,
            artists: meta.artists,
            cover: meta.cover,
            album: meta.album,
        });
    }

    // 4. 不是纯音乐也不是云盘则无歌词
    Ok(ParseResult {
        category: ParseCategory::NotFound,
        song_name: meta.name,
        artists: meta.artists,
        cover: meta.cover,
        album: meta.album,
    })
}
