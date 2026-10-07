use anyhow::{Context, Result};
use chrono::{DateTime, Utc};

use crate::migration::github_api::{PrFile, PrInfo, PrReview, TimelineEvent};

/// 「待更新」标签名（PR 上代表审核员要求修改）
pub const REVISION_LABEL: &str = "待更新";

/// GitHub bot 账号登录名（超时自动关闭的 PR 由它执行）
pub const GITHUB_ACTIONS_BOT: &str = "github-actions[bot]";

/// 站点状态常量（对齐 backend/internal/model/submission.go）
pub const STATUS_PENDING: &str = "pending";
pub const STATUS_NEED_REVISION: &str = "need_revision";
pub const STATUS_APPROVED: &str = "approved";
pub const STATUS_REJECTED: &str = "rejected";
pub const STATUS_CLOSED: &str = "closed";

/// GitHub → 站点状态映射结果（见设计文档 §4.3）
#[derive(Debug, Clone, Default)]
pub struct StatusMapping {
    pub status: String,
    pub reviewer: Option<String>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub review_comment: Option<String>,
    pub closed_at: Option<DateTime<Utc>>,
    pub closed_by: Option<String>,
    pub revision_requested_at: Option<DateTime<Utc>>,
}

/// 按 §4.3 优先级映射站点状态
pub fn map_status(pr: &PrInfo, timeline: &[TimelineEvent], reviews: &[PrReview]) -> StatusMapping {
    let last_review = last_decisive_review(reviews);
    let last_approved = reviews
        .iter()
        .filter(|r| r.state.eq_ignore_ascii_case("APPROVED"))
        .max_by_key(|r| r.submitted_at);

    // 优先级 1：已合并，或最后一次 review 结论为 APPROVED → approved
    //
    // 本仓库的审核流程是「审核员 APPROVED 后直接关闭 PR、不 merge」，
    // 只看 merged 会把通过结论误判成「审核员关闭」→ rejected，并显示上一次
    // CHANGES_REQUESTED 的理由，因此必须结合最后一条 review 的结论。
    if pr.merged || last_review.is_some_and(|r| r.state.eq_ignore_ascii_case("APPROVED")) {
        return StatusMapping {
            status: STATUS_APPROVED.to_string(),
            reviewer: last_approved.map(|r| r.reviewer().to_string()),
            reviewed_at: last_approved.and_then(|r| r.submitted_at).or(pr.merged_at),
            review_comment: last_approved.and_then(|r| non_empty(&r.body)),
            ..Default::default()
        };
    }

    if pr.state == "closed" {
        let closer = timeline
            .iter()
            .find(|e| e.event == "closed")
            .and_then(|e| e.actor.as_ref())
            .map(|a| a.login.clone());

        // 优先级 2：github-actions[bot] 超时自动关闭 → closed
        // 必须先于「作者主动放弃」判断：bot 代提交的 PR 其 author 本身就是 bot，
        // bot 关闭动作代表超时而非作者放弃
        if let Some(ref closer_login) = closer
            && closer_login.eq_ignore_ascii_case(GITHUB_ACTIONS_BOT)
        {
            return StatusMapping {
                status: STATUS_CLOSED.to_string(),
                closed_at: pr.closed_at,
                closed_by: Some(closer_login.clone()),
                ..Default::default()
            };
        }

        // 优先级 3：作者自行关闭（放弃）
        if let Some(ref closer_login) = closer
            && !closer_login.is_empty()
            && closer_login.eq_ignore_ascii_case(&pr.author_login)
        {
            return StatusMapping {
                status: STATUS_CLOSED.to_string(),
                closed_at: pr.closed_at,
                closed_by: Some(closer_login.clone()),
                ..Default::default()
            };
        }

        // 优先级 4：审核员关闭（非通过）
        let reason = reviews
            .iter()
            .rev()
            .find(|r| r.state.eq_ignore_ascii_case("CHANGES_REQUESTED"))
            .and_then(|r| non_empty(&r.body));
        return StatusMapping {
            status: STATUS_REJECTED.to_string(),
            reviewer: closer.filter(|s| !s.is_empty()),
            reviewed_at: pr.closed_at,
            review_comment: reason,
            ..Default::default()
        };
    }

    // 优先级 5：open 且当前带「待更新」标签 → need_revision
    let revision_at = timeline
        .iter()
        .filter(|e| {
            e.event == "labeled" && e.label.as_ref().is_some_and(|l| l.name == REVISION_LABEL)
        })
        .filter_map(|e| e.created_at)
        .next_back();

    if let Some(revision_at) = revision_at {
        // 同步最后一次「要求修改」的审核意见，供详情页展示修改建议
        let last_changes = reviews
            .iter()
            .rev()
            .find(|r| r.state.eq_ignore_ascii_case("CHANGES_REQUESTED"));
        return StatusMapping {
            status: STATUS_NEED_REVISION.to_string(),
            reviewer: last_changes.map(|r| r.reviewer().to_string()),
            reviewed_at: last_changes
                .and_then(|r| r.submitted_at)
                .or(Some(revision_at)),
            review_comment: last_changes.and_then(|r| non_empty(&r.body)),
            revision_requested_at: Some(revision_at),
            ..Default::default()
        };
    }

    // 优先级 6：open 无待更新 → pending
    StatusMapping {
        status: STATUS_PENDING.to_string(),
        ..Default::default()
    }
}

impl PrReview {
    pub fn reviewer(&self) -> &str {
        self.user.as_ref().map(|u| u.login.as_str()).unwrap_or("")
    }
}

/// 时间上最后一条「构成结论」的 review（APPROVED / CHANGES_REQUESTED）
///
/// GitHub 按提交时间升序返回 reviews；COMMENTED / PENDING 不是结论，
/// 若把它们也算作「最后一条」，一次普通评论就会覆盖掉之前的 APPROVED / CHANGES_REQUESTED。
fn last_decisive_review(reviews: &[PrReview]) -> Option<&PrReview> {
    reviews
        .iter()
        .filter(|r| {
            (r.state.eq_ignore_ascii_case("APPROVED")
                || r.state.eq_ignore_ascii_case("CHANGES_REQUESTED"))
                && r.submitted_at.is_some()
        })
        .max_by_key(|r| r.submitted_at)
}

/// 从 PR 文件列表定位 `raw-lyrics/*.ttml`，返回 (仓库路径, 文件名)
pub fn find_ttml_file(files: &[PrFile]) -> Option<(String, String)> {
    files.iter().find_map(|f| {
        let path = f.filename.trim();
        if !path.starts_with("raw-lyrics/") || !path.ends_with(".ttml") {
            return None;
        }
        let name = path.rsplit('/').next()?.to_string();
        if name.is_empty() {
            return None;
        }
        Some((path.to_string(), name))
    })
}

/// BCP-47 语言标签 → 站点语言代码（见 model.SubmissionLanguage）
pub fn map_language(raw: Option<&str>) -> (&'static str, Vec<String>) {
    let code = raw.unwrap_or("").trim().to_ascii_lowercase();
    let primary = if code.starts_with("zh") {
        "zh"
    } else if code.starts_with("ja") {
        "ja"
    } else if code.starts_with("en") {
        "en"
    } else if code.starts_with("ko") {
        "ko"
    } else {
        "others"
    };
    (primary, vec![primary.to_string()])
}

/// 解析 TTML，返回站点 submissions 需要的元数据
pub struct ParsedTtmlMeta {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub ncm_id: String,
    pub qq_id: String,
    pub am_id: String,
    pub spotify_id: String,
    pub language: String,
    pub languages: Vec<String>,
    pub ttml_author_github: String,
}

/// 解析 TTML 字节流（复用 ttml_processor，与 /validate 口径一致）
pub fn parse_ttml_meta(bytes: &[u8]) -> Result<ParsedTtmlMeta> {
    use ttml_processor::model::PlatformId;

    let text = String::from_utf8_lossy(bytes);
    let parsed = ttml_processor::parse_ttml(&text).context("解析 TTML 失败")?;
    let meta = parsed.metadata;

    let join = |v: Option<Vec<String>>| -> String {
        v.map(|items| items.join(" / ")).unwrap_or_default()
    };

    let mut ncm_id = String::new();
    let mut qq_id = String::new();
    let mut am_id = String::new();
    let mut spotify_id = String::new();
    if let Some(ref ids) = meta.platform_ids {
        for (key, values) in ids {
            let first = values.first().cloned().unwrap_or_default();
            match key {
                PlatformId::NcmMusicId => ncm_id = first,
                PlatformId::QqMusicId => qq_id = first,
                PlatformId::SpotifyId => spotify_id = first,
                PlatformId::AppleMusicId => am_id = first,
            }
        }
    }

    let (language, languages) = map_language(meta.language.as_deref());

    Ok(ParsedTtmlMeta {
        title: join(meta.title).chars().take(200).collect(),
        artist: join(meta.artist).chars().take(200).collect(),
        album: join(meta.album).chars().take(200).collect(),
        ncm_id,
        qq_id,
        am_id,
        spotify_id,
        language: language.to_string(),
        languages,
        ttml_author_github: meta
            .author_ids
            .as_ref()
            .and_then(|v| v.first().cloned())
            .unwrap_or_default(),
    })
}

/// 站点 UserInfo JSON（对齐 model.UserInfo 的 json 字段）
pub fn user_info(login: &str, avatar: Option<&str>) -> serde_json::Value {
    serde_json::json!({
        "username": login,
        "displayName": login,
        "avatar": avatar.unwrap_or(""),
    })
}

/// 站点 UserInfo JSON（hub 用户：用户名 / 展示名 / 头像均独立指定）
///
/// 迁移时把 GitHub login 换成 hub 用户信息，展示名与头像取自 Casdoor；
/// 查询不到时 displayName 回退为 username。
pub fn hub_user_info(username: &str, display_name: &str, avatar: &str) -> serde_json::Value {
    let display = display_name.trim();
    serde_json::json!({
        "username": username,
        "displayName": if display.is_empty() { username } else { display },
        "avatar": avatar,
    })
}

fn non_empty(s: &str) -> Option<String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migration::github_api::{RestLabel, RestUser};

    fn pr(state: &str, merged: bool, author: &str) -> PrInfo {
        let now = Utc::now();
        PrInfo {
            number: 8000,
            title: "测试稿件".to_string(),
            body: None,
            state: state.to_string(),
            merged,
            merged_at: if merged { Some(now) } else { None },
            created_at: now,
            updated_at: now,
            closed_at: if state == "closed" { Some(now) } else { None },
            url: "u".to_string(),
            author_login: author.to_string(),
            labels: Vec::new(),
            head_sha: "sha".to_string(),
        }
    }

    fn closed_event(actor: &str) -> TimelineEvent {
        TimelineEvent {
            event: "closed".to_string(),
            actor: Some(RestUser {
                login: actor.to_string(),
            }),
            created_at: Some(Utc::now()),
            label: None,
        }
    }

    fn review(login: &str, state: &str, body: &str) -> PrReview {
        PrReview {
            user: Some(RestUser {
                login: login.to_string(),
            }),
            state: state.to_string(),
            body: body.to_string(),
            submitted_at: Some(Utc::now()),
        }
    }

    #[test]
    fn merged_maps_to_approved() {
        let reviews = vec![review("reviewer1", "APPROVED", "通过")];
        let m = map_status(&pr("closed", true, "alice"), &[], &reviews);
        assert_eq!(m.status, STATUS_APPROVED);
        assert_eq!(m.reviewer.as_deref(), Some("reviewer1"));
        assert_eq!(m.review_comment.as_deref(), Some("通过"));
    }

    #[test]
    fn approved_then_closed_without_merge_maps_to_approved() {
        // 本仓库流程：审核员 APPROVED 后直接关闭、不 merge
        let mut changes = review("ASyunagi", "CHANGES_REQUESTED", "需要更改");
        changes.submitted_at = Some(Utc::now() - chrono::Duration::hours(1));
        let approved = review("ASyunagi", "APPROVED", "通过");
        let m = map_status(
            &pr("closed", false, "alice"),
            &[closed_event("ASyunagi")],
            &[changes, approved],
        );
        assert_eq!(m.status, STATUS_APPROVED);
        assert_eq!(m.reviewer.as_deref(), Some("ASyunagi"));
        assert_eq!(m.review_comment.as_deref(), Some("通过"));
    }

    #[test]
    fn trailing_comment_review_does_not_override_approval() {
        let approved = review("reviewer1", "APPROVED", "通过");
        let mut commented = review("someone", "COMMENTED", "随便说说");
        commented.submitted_at = Some(Utc::now() + chrono::Duration::seconds(1));
        let m = map_status(&pr("open", false, "alice"), &[], &[approved, commented]);
        assert_eq!(m.status, STATUS_APPROVED);
    }

    #[test]
    fn author_closed_maps_to_closed() {
        let m = map_status(&pr("closed", false, "alice"), &[closed_event("alice")], &[]);
        assert_eq!(m.status, STATUS_CLOSED);
        assert_eq!(m.closed_by.as_deref(), Some("alice"));
    }

    #[test]
    fn reviewer_closed_maps_to_rejected() {
        let m = map_status(
            &pr("closed", false, "alice"),
            &[closed_event("reviewer1")],
            &[],
        );
        assert_eq!(m.status, STATUS_REJECTED);
        assert_eq!(m.reviewer.as_deref(), Some("reviewer1"));
    }

    #[test]
    fn bot_closed_maps_to_closed() {
        let m = map_status(
            &pr("closed", false, "github-actions[bot]"),
            &[closed_event(GITHUB_ACTIONS_BOT)],
            &[],
        );
        assert_eq!(m.status, STATUS_CLOSED);
        assert_eq!(m.closed_by.as_deref(), Some(GITHUB_ACTIONS_BOT));
    }

    #[test]
    fn open_with_revision_label_maps_to_need_revision_with_comment() {
        let label = TimelineEvent {
            event: "labeled".to_string(),
            actor: Some(RestUser {
                login: "ASyunagi".to_string(),
            }),
            created_at: Some(Utc::now()),
            label: Some(RestLabel {
                name: REVISION_LABEL.to_string(),
            }),
        };
        let m = map_status(
            &pr("open", false, "github-actions[bot]"),
            &[label],
            &[review("ASyunagi", "CHANGES_REQUESTED", "第 14 行结束时间需延后")],
        );
        assert_eq!(m.status, STATUS_NEED_REVISION);
        assert_eq!(m.reviewer.as_deref(), Some("ASyunagi"));
        assert_eq!(m.review_comment.as_deref(), Some("第 14 行结束时间需延后"));
        assert!(m.revision_requested_at.is_some());
    }

    #[test]
    fn open_with_label_maps_to_need_revision() {
        let timeline = vec![TimelineEvent {
            event: "labeled".to_string(),
            actor: None,
            created_at: Some(Utc::now()),
            label: Some(crate::migration::github_api::RestLabel {
                name: REVISION_LABEL.to_string(),
            }),
        }];
        let m = map_status(&pr("open", false, "alice"), &timeline, &[]);
        assert_eq!(m.status, STATUS_NEED_REVISION);
        assert!(m.revision_requested_at.is_some());
    }

    #[test]
    fn open_without_label_maps_to_pending() {
        let m = map_status(&pr("open", false, "alice"), &[], &[]);
        assert_eq!(m.status, STATUS_PENDING);
    }

    #[test]
    fn finds_ttml_in_raw_lyrics() {
        let files = vec![
            PrFile {
                filename: "metadata/index.jsonl".to_string(),
            },
            PrFile {
                filename: "raw-lyrics/1700000000000-1-abcdefgh.ttml".to_string(),
            },
        ];
        let (path, name) = find_ttml_file(&files).unwrap();
        assert_eq!(path, "raw-lyrics/1700000000000-1-abcdefgh.ttml");
        assert_eq!(name, "1700000000000-1-abcdefgh.ttml");
        assert!(find_ttml_file(&[]).is_none());
    }

    #[test]
    fn maps_language_codes() {
        assert_eq!(map_language(Some("zh-Hans")).0, "zh");
        assert_eq!(map_language(Some("ja")).0, "ja");
        assert_eq!(map_language(Some("en-US")).0, "en");
        assert_eq!(map_language(Some("ko")).0, "ko");
        assert_eq!(map_language(None).0, "others");
        assert_eq!(map_language(Some("fr")).0, "others");
    }
}
