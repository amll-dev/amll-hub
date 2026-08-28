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

// 歌词查看页单行（对应 backend LyricViewLine）
export interface LyricViewLine {
  startTime: number;
  endTime: number;
  text: string;
  translatedLyric?: string;
  romanLyric?: string;
  isBg: boolean;
  isDuet: boolean;
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

// 投稿状态：对应 backend/internal/model/submission.go
export type SubmissionStatus =
  | 'draft'
  | 'pending'
  | 'reviewing'
  | 'need_revision'
  | 'missing_audio'
  | 'approved'
  | 'rejected'
  | 'closed';

// 用户信息
export interface UserInfo {
  username: string;
  displayName: string;
  avatar: string;
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
  status: SubmissionStatus;
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
