import type { RevisionDiffSnapshot } from '@/lib/review/revision-diff';

// 后端统一响应格式 { code, message, data }
export interface ApiResponse<T> {
  code: number;
  message: string;
  data?: T;
}

// 逐字歌词段（平台歌词 QRC/KRC）
export interface OnlineSyllable {
  /** 毫秒（绝对时间） */
  time: number;
  /** 毫秒 */
  duration?: number;
  text: string;
}

// 逐字歌词单元（对应 backend LyricViewWord，毫秒）
export interface LyricViewWord {
  startTime: number;
  endTime: number;
  /** 空白分隔渲染时按间距处理 */
  word: string;
  romanWord?: string;
  emptyBeat?: number;
}

// 歌词查看页单行（对应 backend LyricViewLine）
export interface LyricViewLine {
  startTime: number;
  endTime: number;
  text: string;
  translatedLyric?: string;
  romanLyric?: string;
  isBg: boolean;
  isDuet: boolean;
  /** 逐字时间轴，仅 TTML 等带字级时间的数据源有 */
  words?: LyricViewWord[];
}

// 歌词查看页响应（对应 backend LyricViewResponse）
export interface LyricViewResponse {
  metadata: Record<string, string[]>;
  lines: LyricViewLine[];
}

// GET /api/v1/stats — 对应 backend/internal/service/stats_service.go StatsResponse
export interface Stats {
  totalSongs: number;
  totalArtists: number;
  totalAlbums: number;
  totalWords: number;
  totalLines: number;
  platformDistribution: Record<string, number>;
  lastSyncAt: string;
}

// 搜索字段 — 对应 backend SearchRequest.Field
export type SearchField = 'all' | 'song' | 'artist' | 'album' | 'lyric' | 'id' | 'author';

/** 搜索结果页的 Tab：歌曲各字段 + 用户 */
export type SearchTab = SearchField | 'user';

/** GET /api/v1/search/counts 返回：各 Tab 的命中数 */
export interface SearchCounts {
  totals: Partial<Record<SearchTab, number>>;
  /** 用户匹配数是否已达统计上限（前端渲染 “N+”） */
  userMore: boolean;
}

/** GET /api/v1/users/search 结果项 */
export interface UserSearchItem {
  name: string;
  displayName: string;
  avatar: string;
  bio: string;
  approvedCount: number;
  createdTime?: string;
}

export interface UserSearchResult {
  items: UserSearchItem[];
  /** 本次返回的条数（Casdoor 不提供命中总数） */
  total: number;
  limit: number;
  hasMore: boolean;
}

// GET /api/v1/search 命中 — 对应 backend SearchHitResult
export interface SearchHit {
  id: string;
  musicNames: string[];
  artists: string[];
  albums: string[];
  platformIds: Record<string, string[]>;
  rawLyricFile: string;
  wordCount: number;
  lineCount: number;
  commitTimestamp?: number | null;
  lyricSnippet?: string;
  ttmlAuthorGithub?: string;
  ttmlAuthorGithubLogin?: string;
}

export interface SearchResult {
  hits: SearchHit[];
  totalHits: number;
  limit: number;
  offset: number;
  processingTimeMs: number;
}

// 网易云解析结果（loose，从后端 MusicResponse 提取播放所需字段）
export interface NcmMusicInfo {
  url?: string;
  name?: string;
  /** 来自 ar_name */
  artists?: string;
  /** 来自 pic */
  cover?: string;
  /** 时长（毫秒） */
  duration?: number;
  /** 音质等级（level 回显，如 exhigh/lossless） */
  level?: string;
  /** 文件大小（字节） */
  size?: number;
  /** NCM LRC 主歌词 */
  lyric?: string;
  /** NCM LRC 翻译 */
  tlyric?: string;
}

// ===== 网易云搜索/歌单=====

// 对应 models.Song（/ncm/search 返回的 data 数组元素）
export interface NcmSong {
  id: number;
  name: string;
  fee: number;
  picUrl: string;
  artists: { id: number; name: string }[];
  album: { id: number; name: string; picUrl: string };
  /** 注意是 string */
  duration: string;
  alias?: string;
}

// 对应 models.SearchResponse（data 字段）
export interface NcmSearchResult {
  code: number;
  data: NcmSong[];
  time?: string;
  error?: string;
}

// 对应 models.Track（歌单曲目）
export interface NcmPlaylistTrack {
  id: number;
  name: string;
  ar: { id: number; name: string }[];
  al: { id: number; name: string; picUrl: string };
  /** 毫秒 */
  dt: number;
  fee: number;
}

// 对应 models.PlaylistDetail
export interface NcmPlaylistDetail {
  id: number;
  name: string;
  coverImgUrl: string;
  trackCount: number;
  creator: { userId: number; nickname: string; avatarUrl: string };
  tracks: NcmPlaylistTrack[];
}

// 对应 models.PlaylistResponse
export interface NcmPlaylistResult {
  code: number;
  playlist: NcmPlaylistDetail;
  time?: string;
  error?: string;
}

// ===== 投稿管理 =====

/** 投稿提交类型 */
export type SubmissionType = 'new' | 'revision';
// 投稿状态：对应 backend/internal/model/submission.go
export type SubmissionStatus =
  | 'draft'
  | 'pending'
  | 'reviewing'
  | 'need_revision'
  | 'missing_audio'
  | 'revised'
  | 'approved'
  | 'rejected'
  | 'closed';

// 用户信息
export interface UserInfo {
  username: string;
  displayName: string;
  avatar: string;
}

/** 身份验证方式（对应 backend service.IdentityMethodXxx；仅验证码方式） */
export type IdentityMethod = 'phone' | 'email';

/** GET /api/v1/auth/identity 身份验证状态 */
export interface IdentityStatus {
  /** 当前账号可用的验证方式（只含已绑定的手机 / 邮箱） */
  methods: IdentityMethod[];
  /** 是否已通过验证（凭证未过期） */
  verified: boolean;
  /** 已通过的验证方式 */
  verifiedMethod?: IdentityMethod;
  /** 凭证剩余有效秒数 */
  remaining: number;
}

// GET /api/v1/submissions 列表项 / 详情基础
// 对应 backend/internal/service/submission_svc.go Submission
export interface SubmissionListItem {
  id: number;
  title: string;
  artist: string;
  album: string;
  ncmId?: string;
  qqId?: string;
  amId?: string;
  spotifyId?: string;
  fileName: string;
  notes?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  language: string;
  /** 多选语言（含自定义语言名）；老投稿可能为空，此时回落到 language */
  languages?: string[];
  /** true 表示上传的是未经重排的原始歌词文件 */
  isUnrearranged?: boolean;
  /** 投稿者填写的未重排原因说明 */
  unrearrangedReason?: string;
  /** 投稿提交类型 */
  submissionType?: SubmissionType;
  /** 修正投稿指向的曲库歌曲 id */
  targetSongId?: number;
  /** 修正投稿指向的原歌词文件名 */
  targetRawLyricFile?: string;
  status: SubmissionStatus;
  /** 是否为「首篇通过审核之前」提交的投稿 */
  isFirstSubmission?: boolean;
  submitter: string;
  submitterInfo?: UserInfo;
  provider?: string;
  createdAt: string;
  updatedAt: string;
  fileUpdatedAt?: string;
  revisionRequestedAt?: string;
  closedAt?: string;
  closedBy?: string;
  closedByInfo?: UserInfo;
  reviewer?: string;
  /** 审核员信息（占用时写入，用于展示“谁在审核”） */
  reviewerInfo?: UserInfo;
  reviewedAt?: string;
  reviewComment?: string;
}

export interface SubmissionListResult {
  total: number;
  items: SubmissionListItem[];
}

// 审核历史
export interface ReviewHistoryItem {
  id: number;
  submissionId: number;
  reviewer: string;
  reviewerInfo: UserInfo;
  status: string;
  comment: string;
  reviewedAt: string;
}

// 文件更新历史
export interface FileHistoryItem {
  id: number;
  submissionId: number;
  uploader: string;
  uploaderInfo: UserInfo;
  fileName: string;
  uploadedAt: string;
}

// 评论
export interface SubmissionComment {
  id: number;
  submissionId: number;
  author: UserInfo;
  content: string;
  createdAt: string;
}

// 音频附件
export interface SubmissionAudio {
  id: number;
  submissionId: number;
  fileName: string;
  coverUrl?: string;
  title: string;
  artist: string;
  album: string;
  platform: string;
  platformId: string;
  uploadedBy: string;
  uploadedAt: string;
}

// GET /api/v1/submissions/:id 详情
export interface SubmissionDetail extends SubmissionListItem {
  reviewHistory: ReviewHistoryItem[];
  fileHistory: FileHistoryItem[];
  comments: SubmissionComment[];
  audio?: SubmissionAudio;
  audios?: SubmissionAudio[];
  // 审核员修订版
  hasRevision?: boolean;
  revisionFileName?: string;
  revisionMetadata?: TtmlMetadata;
  revisionAt?: string;
  revisionReviewer?: string;
  revisionReviewerInfo?: UserInfo;
  /** 修正投稿的差异快照 */
  diffSnapshot?: RevisionDiffSnapshot;
}

// ===== 审核员修订版 =====

/** 编辑器上下文里的最近一轮审核要求 */
export interface EditorReviewRequirement {
  /** report = 结构化审核报告；comment = 文字审核意见 */
  source: 'report' | 'comment';
  action?: string;
  comment?: string;
  reportMd?: string;
  structured?: Record<string, unknown>;
  reviewer?: string;
  reviewerInfo?: UserInfo;
  createdAt?: string;
}

/** GET /api/v1/submissions/:id/editor-context */
export interface EditorContext {
  /** 原始投稿 TTML 原文 */
  ttml: string;
  fileName: string;
  audios: SubmissionAudio[];
  ncmId?: string;
  status: string;
  hasRevision: boolean;
  /** 最近一轮审核要求（没有则为空） */
  review?: EditorReviewRequirement | null;
}

/** PUT /api/v1/submissions/:id/content 入参（投稿者编辑器保存） */
export interface SaveSubmitterContentPayload {
  /** 编辑器导出的 TTML */
  ttml: string;
  /** 编辑器元数据，key → 多值 */
  metadata?: Record<string, string[]>;
  /** 自动生成并可编辑的修改摘要（Markdown） */
  reportMd?: string;
}

/** POST /api/v1/submissions/:id/revision 入参 */
export interface SaveRevisionPayload {
  uploadTtml: boolean;
  ttmlContent?: string;
  metadata?: Record<string, unknown>;
  reportMd: string;
  structured?: Record<string, unknown>;
  comment?: string;
  action?: ReviewAction;
}

// 审核操作类型
export type ReviewAction = 'approve' | 'reject' | 'revision' | 'missing_audio';

// ===== TTML 校验 =====

// ttml_processor 的 TTMLMetadata 序列化格式
export interface TtmlMetadata {
  language?: string;
  timing_mode?: string;
  songwriters?: string[];
  title?: string[];
  artist?: string[];
  album?: string[];
  isrc?: string[];
  author_ids?: string[];
  author_names?: string[];
  agents?: Record<string, unknown>;
  platform_ids?: {
    ncm_music_id?: string[];
    qq_music_id?: string[];
    spotify_id?: string[];
    apple_music_id?: string[];
  };
  raw_properties?: Record<string, string[]>;
}

// GET /api/v1/users/me/activity 返回
export interface UserActivityDay {
  /** YYYY-MM-DD */
  date: string;
  count: number;
  byType: Record<string, number>;
}

export interface UserActivity {
  year: number;
  /** 有记录的年份（供切换） */
  years: number[];
  days: UserActivityDay[];
  total: number;
  byType: Record<string, number>;
}

// POST /api/v1/submissions/validate 返回
export interface TtmlValidationResult {
  valid: boolean;
  errors: string[];
  parseError: string;
  regeneratedTtml: string;
  metadata: TtmlMetadata;
}

// GET /api/v1/search-ip/submissions 列表项
export interface SearchIpListItem {
  id: number;
  title: string; // group 名拼接
  status: string;
  submitter: string;
  createdAt: string;
}

export interface SearchIpListResult {
  total: number;
  items: SearchIpListItem[];
}

// GET /api/v1/search-ip/submissions/:id 详情
// 对应 backend/internal/service/search_ip_svc.go SearchIpDetail
export interface SearchIpSubmissionMember {
  authors: string[];
  pictures: string;
  pictures_big?: string;
  color: string;
}
export interface SearchIpSubmissionGroup {
  aliases: string[];
  album?: string;
  pictures: string;
  pictures_big?: string;
  color: string;
  members?: SearchIpSubmissionMember[];
}
export interface SearchIpSubmissionData {
  groups: Record<string, SearchIpSubmissionGroup>;
}
export interface SearchIpSubmissionDetail {
  id: number;
  title: string;
  data: SearchIpSubmissionData;
  imageKeys: Record<string, string>;
  submitter: string;
  submitterInfo: Record<string, unknown>;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// ===== 无歌词排行榜 =====

// GET /api/v1/not-found-ranking 返回的单条项
// 对应 backend/internal/service/not_found_service.go RankingItem
export interface NotFoundRankingItem {
  id: number;
  platform: string;
  platformId: string;
  songName: string;
  artists: string[];
  cover: string;
  album: string;
  requestCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  category: string;
}

export interface NotFoundRankingResult {
  total: number;
  returned: number;
  requestedLimit: string;
  days: number;
  items: NotFoundRankingItem[];
}

// ===== 搜索IP显示投稿 =====

export interface SearchIpMember {
  authors: string[];
  pictures: string;
  pictures_big: string;
  color: string;
}

export interface SearchIpGroup {
  aliases: string[];
  album: string;
  pictures: string;
  pictures_big: string;
  color: string;
  members: SearchIpMember[];
}

export interface SearchIpData {
  groups: Record<string, SearchIpGroup>;
}

export interface SearchIpMatchTeam {
  name: string;
  logoKey: string;
  color: string;
}

export interface SearchIpMatchMember {
  name: string;
  avatarKey: string;
  color: string;
  team: string;
}

export interface SearchIpMatchResult {
  teams: Record<string, SearchIpMatchTeam>;
  members: Record<string, SearchIpMatchMember>;
}

// ===== 每日推荐 =====

// GET /api/v1/daily-recommendations 公开列表项 / 详情
// 对应 backend/internal/model/daily_recommendation.go
export interface DailyRecommendation {
  id: number;
  date: string; // YYYY-MM-DD
  songName: string;
  artist: string;
  coverKey: string; // MinIO key
  ncmId: string;
  comment: string;
  submitter: string;
  submitterInfo: Record<string, unknown>;
  status: string;
  likeCount: number;
  createdAt: string;
  updatedAt: string;
}

// GET/POST /api/v1/daily-recommendations/like/:id 点赞状态
export interface DailyLikeStatus {
  liked: boolean;
  likeCount: number;
}

// GET /api/v1/latest-songs 最新收录列表项
export interface LatestSongItem {
  id: number;
  songId: number;
  ncmId: string;
  title: string;
  artist: string;
  coverUrl: string;
}

// GET /api/v1/daily-recommendations/submissions 列表项
// 对应 backend/internal/service/daily_recommendation_svc.go DailyRecListItem
export interface DailyRecListItem {
  id: number;
  date: string;
  songName: string;
  artist: string;
  status: string;
  createdAt: string;
}

export interface DailyRecListResult {
  total: number;
  items: DailyRecListItem[];
}

// ===== 在线搜索（多平台歌词搜索） =====

export type OnlinePlatform = 'ncm' | 'qq' | 'kugou';

// GET /api/v1/online/search 单条结果（对应 backend OnlineSearchHit）
export interface OnlineSearchHit {
  songName: string;
  artists: string[];
  albumName: string;
  platform: OnlinePlatform;
  platformId: string;
  /** 时长（秒） */
  duration: number;
  coverUrl: string;
}

// GET /api/v1/online/search 返回（对应 backend OnlineSearchResult）
export interface OnlineSearchResult {
  hits: OnlineSearchHit[];
  total: number;
}

// GET /api/v1/online/songs/:platform/:songId（对应 backend OnlineSongDetail）
export interface OnlineSongDetail {
  songName: string;
  artists: string[];
  albumName: string;
  albumId: string;
  platform: OnlinePlatform;
  platformId: string;
  /** 时长（秒） */
  duration: number;
  coverUrl: string;
  payStatus: string;
  platformExtra: Record<string, unknown>;
}

// GET /api/v1/online/lyrics/:platform/:songId 歌词行
export interface OnlineLyricLine {
  /** 毫秒 */
  time: number;
  /** 毫秒 */
  duration: number;
  text: string;
  /** 逐字时间轴（QRC/KRC） */
  syllables?: OnlineSyllable[];
}

// GET /api/v1/online/lyrics/:platform/:songId 返回（对应 backend OnlineLyric）
export interface OnlineLyric {
  raw: string;
  lines: OnlineLyricLine[];
  translation: OnlineLyricLine[];
  romanization: OnlineLyricLine[];
}

// ===== 消息中心 =====

/** 消息类型（对应 backend notifications.type） */
export type MessageType = 'system' | 'review' | 'submission' | 'comment';

/** 审核结果细分（对应 backend notifications.result，仅 type=review 有值） */
export type ReviewResult =
  | 'approved'
  | 'rejected'
  | 'need_revision'
  | 'missing_audio'
  // 审核员已提交修订版 TTML，等投稿者确认（后端 model.NotifyResultRevised）
  | 'revised'
  | 'closed';

/** 跳转动作 */
export interface MessageAction {
  path: string;
  label: string;
}

/** 单条站内消息（对应 backend service.NotificationDTO） */
export interface Message {
  id: number;
  type: MessageType;
  /** 审核结果细分，仅 type=review 时后端返回（用于区分图标） */
  result?: ReviewResult;
  title: string;
  content: string;
  read: boolean;
  /** RFC3339 */
  createdAt: string;
  action?: MessageAction;
}

/** 消息列表结果（对应 backend service.NotificationListDTO） */
export interface NotificationListResult {
  items: Message[];
  total: number;
  unread: number;
}

// 系统公告

/** 公告邮件发送状态 */
export type AnnouncementMailStatus = 'none' | 'sending' | 'done';

/** 公告发布记录 */
export interface Announcement {
  id: number;
  title: string;
  content: string;
  /** 站内信跳转路径，空串表示不跳转 */
  actionPath: string;
  actionLabel: string;
  /** 发布人用户名 */
  sender: string;
  /** 本次发布是否勾选了发送邮件 */
  mailEnabled: boolean;
  /** 站内信收件人总数 */
  audienceCount: number;
  mailSent: number;
  mailFailed: number;
  /** Casdoor 查不到邮箱而跳过的用户数 */
  mailSkipped: number;
  mailStatus: AnnouncementMailStatus;
  createdAt: string;
  mailFinishedAt?: string;
}

/** 公告历史列表 */
export interface AnnouncementListResult {
  items: Announcement[];
  total: number;
}

/** 发布前预览 */
export interface AnnouncementAudience {
  count: number;
  /** 全局 EMAIL_ENABLED + SMTP 配置齐全时为 true */
  mailAvailable: boolean;
}

// 审核员管理

/** 审核员展示信息 */
export interface ReviewerItem {
  name: string;
  displayName: string;
  avatar: string;
}

/** 审核员名单 */
export interface ReviewerListResult {
  items: ReviewerItem[];
  total: number;
}

// ===== GitHub 投稿数据迁移 =====

/** 迁移任务/关闭 PR 状态 */
export type MigrationStatus = 'pending' | 'running' | 'completed' | 'failed';

/** 迁移任务（对应 backend model.GithubMigrationTask） */
export interface GithubMigrationTask {
  id: number;
  username: string;
  githubLogin: string;
  status: MigrationStatus;
  totalPrs: number;
  processedPrs: number;
  createdCount: number;
  skippedCount: number;
  failedCount: number;
  cursor?: string;
  error?: string;
  closePrStatus: MigrationStatus;
  closedPrCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/** 迁移页状态概览（对应 backend service.MigrationStatus） */
export interface GithubMigrationStatus {
  bound: boolean;
  githubLogin?: string;
  githubEmail?: string;
  githubAvatar?: string;
  boundAt?: string;
  hasActive: boolean;
  activeTask?: GithubMigrationTask;
  latestTask?: GithubMigrationTask;
  /** 迁移起始 PR 号（数据截止点） */
  startPrNumber: number;
}

/** 已迁移的单个 PR（迁移页展示） */
export interface GithubMigratedPr {
  prNumber: number;
  /** GitHub PR 标题 */
  prTitle: string;
  submissionId?: number;
  /** 站点稿件标题（取自 TTML 元数据） */
  submissionTitle: string;
  fileName: string;
  migratedAt: string;
}

/** 已迁移 PR 列表结果（对应 backend service.MigrationList） */
export interface GithubMigratedList {
  total: number;
  items: GithubMigratedPr[];
}

// ---------- 公开用户主页 ----------

/** 性别（与后端 user_profiles.gender CHECK 约束一致） */
export type Gender = 'male' | 'female' | 'other' | 'unknown';

/** GET /api/v1/users/:name 返回的聚合资料 */
export interface PublicUserProfile {
  name: string;
  displayName: string;
  avatar: string;
  /** Casdoor 注册时间（原样字符串，可能为空） */
  createdTime?: string;
  bio: string;
  /** MinIO 对象 key；空串表示未设置 */
  bannerKey: string;
  /** YYYY-MM-DD；未填写为 null */
  birthday: string | null;
  gender: Gender;
  /** 当前查看者是否为本人 */
  isSelf: boolean;
  /** 访客只有 approved；本人含全部状态 */
  stats: Partial<Record<SubmissionStatus, number>>;
}

/** 公开主页的投稿列表项（后端裁剪过，不含评审信息） */
export interface PublicSubmissionItem {
  id: number;
  title: string;
  artist: string;
  album: string;
  language: string;
  languages?: string[];
  status: SubmissionStatus;
  createdAt: string;
  updatedAt: string;
  fileUpdatedAt?: string;
}

export interface PublicSubmissionList {
  total: number;
  items: PublicSubmissionItem[];
}

export type UserSubmissionSort = 'newest' | 'oldest' | 'updated';

/** PUT /api/v1/users/me/profile 的入参与回执 */
export interface MyProfileFields {
  bio: string;
  bannerKey: string;
  birthday: string | null;
  gender: Gender;
}

export interface UpdateMyProfilePayload {
  bio: string;
  birthday: string | null;
  gender: Gender;
}
