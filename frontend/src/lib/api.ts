import type {
  ApiResponse,
  Announcement,
  AnnouncementAudience,
  AnnouncementListResult,
  DailyLikeStatus,
  DailyRecommendation,
  DailyRecListResult,
  EditorContext,
  GithubMigratedList,
  GithubMigrationStatus,
  GithubMigrationTask,
  IdentityMethod,
  IdentityStatus,
  LatestSongItem,
  LyricRequest,
  LyricRequestComment,
  LyricRequestListResult,
  LyricRequestPayload,
  LyricRequestStatus,
  CreateLyricRequestResult,
  PetitionLinkItem,
  LyricVersionsResult,
  LyricViewResponse,
  MessageType,
  NotificationListResult,
  NcmMusicInfo,
  NcmPlaylistResult,
  NcmSearchResult,
  NotFoundRankingResult,
  OnlineLyric,
  OnlinePlatform,
  OnlineSearchResult,
  OnlineSongDetail,
  QmMusicInfo,
  QmPlaylistResult,
  QmSearchResult,
  QmSong,
  ReviewAction,
  ReviewerListResult,
  SaveRevisionPayload,
  SaveSubmitterContentPayload,
  SearchField,
  SearchIpListResult,
  SearchIpSubmissionDetail,
  SearchResult,
  SearchCounts,
  SearchIpData,
  SearchIpMatchResult,
  Stats,
  SubmissionComment,
  SubmissionDetail,
  SubmissionListResult,
  SubmissionType,
  UserActivity,
  UserSearchResult,
  TtmlValidationResult,
  MyProfileFields,
  PublicSubmissionList,
  PublicUserProfile,
  UpdateMyProfilePayload,
  UserSubmissionSort,
  PluginAdminDetailResult,
  PluginAdminListResult,
  PluginAuditListResult,
  PluginComment,
  PluginDetailResult,
  PluginManagementItem,
  PluginManagementListResult,
  PluginManagementUpdatePayload,
  PluginRatingSummary,
  PluginReviewDetailResult,
  PluginReviewQueueResult,
  PluginStoreListResult,
  PluginSubmissionResult,
  PluginValidateResult,
  PluginChannel,
  PluginStatus,
} from './types';
import type {
  CaptchaConfig,
  GithubBindInfo,
  LoginResult,
  QrTicket,
  QrTicketStatus,
  UserProfile,
} from './auth';
import { clearAuth, getToken } from './auth';
import { triggerDownload } from './blob-download';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

const qmIdMidCache = new Map<string, { id: string; mid: string }>();

/** 未登录时的引导文案 */
function authNoticeFor(path: string): string {
  if (path.includes('/parse-music') || path.includes('/parse-playlist')) {
    return '登录后即可播放音乐';
  }
  if (path.includes('/search')) {
    return '登录后即可搜索歌曲';
  }
  return '登录后即可使用该功能';
}

/** 拉取库内歌词 TTML；不存在返回 null */
async function fetchLyricTtml(folder: string, name: string): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/v1/lyrics/${folder}/${encodeURIComponent(name)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`获取歌词失败：HTTP ${res.status}`);
  }
  return res.text();
}

/** 请求超时（毫秒）：防止挂起的连接卡死 UI */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * 后端业务错误（响应体 code !== 200 或 401）。
 * 区别于网络层错误：TanStack Query 据此跳过重试。
 */
export class ApiError extends Error {
  readonly code: number;
  readonly details?: unknown;
  constructor(message: string, code: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

/**
 * 统一请求管道（所有 JSON API 的唯一入口，等价于 axios 拦截器）：
 * 1. 注入 Authorization（有 token 时）
 * 2. 401 统一处理：清登录态 + 派发 auth:unauthorized（AuthProvider 弹登录窗）
 * 3. 业务码/HTTP 状态统一转换为 ApiError
 * 4. dev 环境统一请求日志（方法/路径/耗时/状态）
 */
async function baseRequest<T>(
  path: string,
  init: RequestInit,
  jsonHeaders: boolean,
  timeoutMs = REQUEST_TIMEOUT_MS,
  opts: { fileSizeMb?: string; networkErrorMessage?: string } = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(jsonHeaders ? { 'Content-Type': 'application/json' } : {}),
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  const method = init?.method ?? 'GET';

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('请求超时，请稍后重试', { cause: err });
    }
    if (opts.networkErrorMessage) {
      throw new Error(opts.networkErrorMessage, { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  if (import.meta.env.DEV) {
    console.debug(
      `[api] ${method} ${path} → ${res.status} (${Math.round(performance.now() - startedAt)}ms)`
    );
  }

  // 401：若是带 token 的请求，说明 token 失效，清登录态并弹登录窗；
  // 若未带 token（如找回密码接口验证码错误），仅抛错，不触发登录窗
  if (res.status === 401) {
    let msg = '登录已失效，请重新登录';
    try {
      const j = (await res.json()) as ApiResponse<T>;
      if (j.message) msg = j.message;
    } catch {
      // 忽略解析失败
    }
    if (token) {
      clearAuth();
      window.dispatchEvent(new Event('auth:unauthorized'));
    } else if (!path.startsWith('/api/v1/auth')) {
      window.dispatchEvent(
        new CustomEvent('auth:required', { detail: { notice: authNoticeFor(path) } })
      );
    }
    throw new ApiError(msg, 401);
  }

  if (res.status === 413) {
    throw new Error(
      opts.fileSizeMb
        ? `上传失败：文件过大（${opts.fileSizeMb} MB），服务器拒绝接收 413 Content Too Large`
        : '请求失败：文件过大（413）'
    );
  }

  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new Error(`请求失败：HTTP ${res.status}`);
  }

  if (json.code !== 200) {
    throw new ApiError(json.message || `请求失败：HTTP ${res.status}`, json.code, json.data);
  }
  return json.data as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return baseRequest<T>(path, init ?? {}, true);
}

/** multipart/form-data 请求（不设置 Content-Type，交给浏览器生成 boundary） */
async function requestForm<T>(
  path: string,
  form: FormData,
  options: { timeoutMs?: number; fileSizeMb?: string; networkErrorMessage?: string } = {}
): Promise<T> {
  return baseRequest<T>(path, { method: 'POST', body: form }, false, options.timeoutMs ?? 180_000, {
    networkErrorMessage: '上传失败：网络连接中断，请检查网络后重试',
    ...options,
  });
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const api = {
  getStats(): Promise<Stats> {
    return request<Stats>('/api/v1/stats');
  },

  /** 无歌词排行榜 */
  getNotFoundRanking(params: {
    limit?: number | 'all';
    days?: number;
    platform?: string;
  }): Promise<NotFoundRankingResult> {
    const qs = buildQuery({
      limit: params.limit ?? 'all',
      days: params.days ?? 7,
      platform: params.platform,
    });
    return request<NotFoundRankingResult>(`/api/v1/not-found-ranking${qs}`);
  },
  search(params: {
    q: string;
    field?: SearchField;
    limit?: number;
    offset?: number;
    /** 返回全部命中 */
    all?: boolean;
  }): Promise<SearchResult> {
    const qs = buildQuery({
      q: params.q,
      field: params.field,
      limit: params.limit,
      offset: params.offset,
      all: params.all ? 'true' : undefined,
    });
    return request<SearchResult>(`/api/v1/search${qs}`);
  },

  /** 搜索结果页各 Tab 的命中数 GET /api/v1/search/counts */
  searchCounts(q: string): Promise<SearchCounts> {
    return request<SearchCounts>(`/api/v1/search/counts${buildQuery({ q })}`);
  },

  /** 按用户名/昵称搜索用户 GET /api/v1/users/search */
  searchUsers(q: string, params: { limit?: number } = {}): Promise<UserSearchResult> {
    return request<UserSearchResult>(
      `/api/v1/users/search${buildQuery({ q, limit: params.limit })}`
    );
  },

  /** 下载歌词 */
  rawLyricDownloadURL(rawLyricFile: string): string {
    return `${API_BASE}/api/v1/lyrics/raw-lyrics/${encodeURIComponent(rawLyricFile)}`;
  },

  /**
   * 查看歌词。
   * 后端 GET /api/v1/lyrics/view/:filename
   */
  viewLyric(filename: string): Promise<LyricViewResponse> {
    return request<LyricViewResponse>(`/api/v1/lyrics/view/${encodeURIComponent(filename)}`);
  },

  /**
   * 获取歌词的全部历史版本（按平台 ID 传递关联）。
   * 后端 GET /api/v1/lyrics/versions/:filename
   */
  lyricVersions(filename: string): Promise<LyricVersionsResult> {
    return request<LyricVersionsResult>(`/api/v1/lyrics/versions/${encodeURIComponent(filename)}`);
  },

  /**
   * 解析任意 TTML 文本为结构化歌词数据
   * 后端 POST /api/v1/lyrics/parse，body = 原始 TTML 文本
   */
  parseLyric(ttmlText: string): Promise<LyricViewResponse> {
    return request<LyricViewResponse>('/api/v1/lyrics/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: ttmlText,
    });
  },

  /**
   * 解析网易云单曲：获取播放链接等信息。
   * 后端 GET /api/v1/ncm/parse-music?songId=&level=
   */
  async parseNcmMusic(songId: string, level = 'exhigh'): Promise<NcmMusicInfo> {
    const qs = buildQuery({ songId, level });
    // 后端响应：{ code, message, data: MusicResponse }
    // MusicResponse 字段：url/name/pic/ar_name/al_name/lyric/tlyric 等
    const d = await request<Record<string, unknown>>(`/api/v1/ncm/parse-music${qs}`);
    return {
      url: asString(d.url ?? d.URL),
      name: asString(d.name ?? d.songName),
      artists: asString(d.ar_name ?? d.artistName),
      cover: asString(d.cover ?? d.coverUrl ?? d.pic ?? d.albumPic),
      duration: asNumber(d.duration ?? d.dt),
      level: asString(d.level),
      size: asNumber(d.size),
      lyric: asString(d.lyric),
      tlyric: asString(d.tlyric),
    };
  },

  /**
   * 搜索网易云音乐。
   * 后端 GET /api/v1/ncm/search?q=&limit=
   */
  searchNcm(q: string, limit = 10): Promise<NcmSearchResult> {
    const qs = buildQuery({ q, limit });
    return request<NcmSearchResult>(`/api/v1/ncm/search${qs}`);
  },

  /**
   * 解析网易云歌单。
   * 后端 GET /api/v1/ncm/parse-playlist?playlistId=
   */
  parseNcmPlaylist(playlistId: string): Promise<NcmPlaylistResult> {
    const qs = buildQuery({ playlistId });
    return request<NcmPlaylistResult>(`/api/v1/ncm/parse-playlist${qs}`);
  },

  parseQmMusic(songId: string, level = 'hq'): Promise<QmMusicInfo> {
    const qs = buildQuery({ songId, level });
    return request<QmMusicInfo>(`/api/v1/qm/parse-music${qs}`);
  },
  searchQm(q: string, limit = 10): Promise<QmSearchResult> {
    const qs = buildQuery({ q, limit });
    return request<QmSearchResult>(`/api/v1/qm/search${qs}`);
  },
  parseQmPlaylist(playlistId: string): Promise<QmPlaylistResult> {
    const qs = buildQuery({ playlistId });
    return request<QmPlaylistResult>(`/api/v1/qm/parse-playlist${qs}`);
  },
  qmSong(id: string): Promise<QmSong> {
    const qs = buildQuery({ id });
    return request<QmSong>(`/api/v1/qm/song${qs}`);
  },
  qmCoverUrl(mid: string, size = 300): string {
    const qs = buildQuery({ mid, size });
    return `${API_BASE}/api/v1/qm/cover${qs}`;
  },

  /**
   * 获取 ncm-lyrics 文件夹下的 TTML 歌词（按歌曲 ID）。
   * 后端 GET /api/v1/lyrics/ncm-lyrics/:songId 直接返回 TTML 字节流。
   */
  async getNcmLyricTtml(songId: string): Promise<string | null> {
    return fetchLyricTtml('ncm-lyrics', songId);
  },

  async getQqLyricTtml(songIdOrMid: string): Promise<string | null> {
    const key = songIdOrMid.trim();
    if (!key) return null;

    const direct = await fetchLyricTtml('qq-lyrics', key);
    if (direct !== null) return direct;

    const pair = await this.qmIdMidPair(key);
    if (!pair) return null;
    const alt = /^\d+$/.test(key) ? pair.mid : pair.id;
    if (!alt || alt === key) return null;
    return fetchLyricTtml('qq-lyrics', alt);
  },

  /** QQ 歌曲 id / mid 互转 */
  async qmIdMidPair(input: string): Promise<{ id: string; mid: string } | null> {
    const key = input.trim();
    if (!key) return null;
    const cached = qmIdMidCache.get(key);
    if (cached) return cached;
    try {
      const song = await this.qmSong(key);
      const pair = { id: String(song.id), mid: song.mid };
      if (!pair.mid) return null;
      // 两种形态都缓存，命中任一都能直接拿到映射
      qmIdMidCache.set(pair.id, pair);
      qmIdMidCache.set(pair.mid, pair);
      qmIdMidCache.set(key, pair);
      return pair;
    } catch {
      return null;
    }
  },

  /**
   * 获取原始 TTML 歌词文本（raw-lyrics folder）。
   * 后端 GET /api/v1/lyrics/raw-lyrics/:filename 直接返回 TTML 字节流。
   */
  async getRawLyricTtml(rawLyricFile: string): Promise<string> {
    const res = await fetch(this.rawLyricDownloadURL(rawLyricFile));
    if (!res.ok) {
      throw new Error(`获取歌词失败：HTTP ${res.status}`);
    }
    return res.text();
  },

  // ===== 认证 =====

  /** 密码登录 POST /api/v1/auth/login */
  login(username: string, password: string): Promise<LoginResult> {
    return request<LoginResult>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  /** 验证码登录 POST /api/v1/auth/login-code */
  loginByCode(dest: string, code: string): Promise<LoginResult> {
    return request<LoginResult>('/api/v1/auth/login-code', {
      method: 'POST',
      body: JSON.stringify({ dest, code }),
    });
  },

  /** 注册 POST /api/v1/auth/register */
  register(params: {
    username: string;
    password: string;
    phone: string;
    code: string;
    email: string;
    emailCode: string;
    displayName: string;
  }): Promise<void> {
    return request<void>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  /** 发送验证码 POST /api/v1/auth/send-code */
  sendCode(params: {
    checkType: string;
    dest: string;
    method?: string;
    captchaType: string;
    captchaToken: string;
  }): Promise<void> {
    return request<void>('/api/v1/auth/send-code', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  /** 检查账号是否存在 POST /api/v1/auth/check-user（不需要人机验证）*/
  checkUser(params: { checkType: string; dest: string; method: string }): Promise<void> {
    return request<void>('/api/v1/auth/check-user', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  /** 找回密码 POST /api/v1/auth/forgot-password */
  forgotPassword(dest: string, code: string, newPassword: string): Promise<void> {
    return request<void>('/api/v1/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ dest, code, newPassword }),
    });
  },

  /** 获取验证码配置 GET /api/v1/auth/captcha */
  getCaptcha(): Promise<CaptchaConfig> {
    return request<CaptchaConfig>('/api/v1/auth/captcha');
  },

  /** 申请扫码登录票据 POST /api/v1/auth/qrcode */
  createQrTicket(): Promise<QrTicket> {
    return request<QrTicket>('/api/v1/auth/qrcode', { method: 'POST' });
  },

  /** 轮询扫码登录票据状态 GET /api/v1/auth/qrcode/status */
  getQrTicketStatus(ticket: string): Promise<QrTicketStatus> {
    return request<QrTicketStatus>(
      `/api/v1/auth/qrcode/status?ticket=${encodeURIComponent(ticket)}`
    );
  },

  /** 获取个人资料 GET /api/v1/auth/profile */
  getProfile(): Promise<UserProfile> {
    return request<UserProfile>('/api/v1/auth/profile');
  },

  /** 更新个人资料 PUT /api/v1/auth/profile */
  updateProfile(params: {
    displayName?: string;
    email?: string;
    code?: string;
    phone?: string;
    phoneCode?: string;
    avatar?: string;
  }): Promise<UserProfile> {
    return request<UserProfile>('/api/v1/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(params),
    });
  },

  /** 修改密码 POST /api/v1/auth/change-password
   *  oldPassword 可为空：此时要求已通过手机 / 邮箱身份验证 */
  changePassword(oldPassword: string, newPassword: string): Promise<void> {
    return request<void>('/api/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    });
  },

  /** 身份验证状态 GET /api/v1/auth/identity */
  getIdentityStatus(): Promise<IdentityStatus> {
    return request<IdentityStatus>('/api/v1/auth/identity');
  },

  /** 向自身已绑定的手机 / 邮箱发送身份验证验证码 POST /api/v1/auth/identity/code */
  sendIdentityCode(params: {
    method: IdentityMethod;
    captchaType: string;
    captchaToken: string;
  }): Promise<void> {
    return request<void>('/api/v1/auth/identity/code', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  /** 身份验证 POST /api/v1/auth/identity/verify */
  verifyIdentity(params: { method: IdentityMethod; code: string }): Promise<{
    verified: boolean;
    expiresIn: number;
  }> {
    return request<{ verified: boolean; expiresIn: number }>('/api/v1/auth/identity/verify', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  /**
   * 上传头像 POST /api/v1/auth/avatar
   * multipart/form-data，需单独 fetch
   */
  async uploadAvatar(file: File): Promise<string> {
    const form = new FormData();
    form.append('file', file);
    const data = await requestForm<{ avatar: string }>('/api/v1/auth/avatar', form);
    return data.avatar;
  },

  /**
   * 创建搜索IP投稿 POST /api/v1/search-ip/submissions
   */
  async createSearchIpSubmission(params: {
    title?: string;
    jsonData: SearchIpData;
    tempKeys: Record<string, string>;
  }): Promise<{ id: number; imageCount: number }> {
    const form = new FormData();
    if (params.title) form.append('title', params.title);
    form.append('data', JSON.stringify(params.jsonData));
    form.append('tempKeys', JSON.stringify(params.tempKeys));
    return requestForm<{ id: number; imageCount: number }>('/api/v1/search-ip/submissions', form);
  },

  /**
   * 上传单张图片到临时区 POST /api/v1/search-ip/upload-temp
   * 返回 { tempKey, abort } —— onProgress 用于进度回调，abort 可取消上传
   */
  uploadTempImage(
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<{ tempKey: string; abort: () => void }> {
    const token = getToken();
    const form = new FormData();
    form.append('file', file, file.name);
    const xhr = new XMLHttpRequest();
    const promise = new Promise<{ tempKey: string }>((resolve, reject) => {
      xhr.open('POST', `${API_BASE}/api/v1/search-ip/upload-temp`);
      xhr.timeout = 120_000;
      xhr.ontimeout = () => reject(new Error('上传超时，请稍后重试'));
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        try {
          const json = JSON.parse(xhr.responseText) as ApiResponse<{ tempKey: string }>;
          if (xhr.status === 200 && json.code === 200 && json.data) {
            resolve({ tempKey: json.data.tempKey });
          } else {
            reject(new Error(json.message || `上传失败：HTTP ${xhr.status}`));
          }
        } catch {
          reject(new Error(`上传失败：HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('上传失败：网络错误'));
      xhr.send(form);
    });
    const abort = () => xhr.abort();
    return promise.then(({ tempKey }) => ({ tempKey, abort }));
  },

  /** 匹配搜索IP POST /api/v1/search-ip/match */
  matchSearchIp(artists: string[]): Promise<SearchIpMatchResult> {
    return request<SearchIpMatchResult>('/api/v1/search-ip/match', {
      method: 'POST',
      body: JSON.stringify({ artists }),
    });
  },

  /** 搜索IP图片 URL */
  searchIpImageUrl(key: string): string {
    return `${API_BASE}/api/v1/search-ip/image/${encodeURIComponent(key)}`;
  },

  /** 投稿列表 GET /api/v1/submissions */
  listSubmissions(params: {
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<SubmissionListResult> {
    const sp = new URLSearchParams();
    sp.set('mode', 'creator');
    sp.set('status', params.status ?? 'all');
    if (params.page) sp.set('page', String(params.page));
    if (params.limit) sp.set('limit', String(params.limit));
    return request<SubmissionListResult>(`/api/v1/submissions?${sp.toString()}`);
  },

  /** 全部投稿列表 (审核中心用) GET /api/v1/submissions?mode=review */
  listAllSubmissions(params: {
    status?: string;
    search?: string;
    language?: string;
    page?: number;
    limit?: number;
  }): Promise<SubmissionListResult> {
    const sp = new URLSearchParams();
    sp.set('mode', 'review');
    sp.set('status', params.status ?? 'all');
    if (params.search) sp.set('search', params.search);
    if (params.language) sp.set('language', params.language);
    if (params.page) sp.set('page', String(params.page));
    if (params.limit) sp.set('limit', String(params.limit));
    return request<SubmissionListResult>(`/api/v1/submissions?${sp.toString()}`);
  },

  /** 投稿详情 GET /api/v1/submissions/:id */
  getSubmissionDetail(id: number): Promise<SubmissionDetail> {
    return request<SubmissionDetail>(`/api/v1/submissions/${id}`);
  },

  /** 个人中心活动统计 GET /api/v1/users/me/activity?year= */
  getUserActivity(year: number): Promise<UserActivity> {
    return request<UserActivity>(`/api/v1/users/me/activity?year=${year}`);
  },

  // ---------- 公开用户主页 ----------

  /** 公开主页聚合资料 GET /api/v1/users/:name */
  getUserProfile(name: string): Promise<PublicUserProfile> {
    return request<PublicUserProfile>(`/api/v1/users/${encodeURIComponent(name)}`);
  },

  /** 公开投稿列表 GET /api/v1/users/:name/submissions（访客强制 approved） */
  getUserSubmissions(
    name: string,
    params: {
      status?: string;
      language?: string;
      sort?: UserSubmissionSort;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<PublicSubmissionList> {
    const qs = buildQuery({
      status: params.status,
      language: params.language,
      sort: params.sort,
      page: params.page,
      limit: params.limit,
    });
    return request<PublicSubmissionList>(
      `/api/v1/users/${encodeURIComponent(name)}/submissions${qs}`
    );
  },

  /** 公开贡献墙 GET /api/v1/users/:name/activity?year=（仅 approved） */
  getUserActivityOf(name: string, year: number): Promise<UserActivity> {
    return request<UserActivity>(`/api/v1/users/${encodeURIComponent(name)}/activity?year=${year}`);
  },

  /** 更新本地主页资料 PUT /api/v1/users/me/profile */
  updateMyProfile(payload: UpdateMyProfilePayload): Promise<MyProfileFields> {
    return request<MyProfileFields>('/api/v1/users/me/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  /** 上传主页背景图 POST /api/v1/users/me/banner（multipart） */
  async uploadBanner(file: File): Promise<string> {
    const form = new FormData();
    form.append('file', file);
    const data = await requestForm<{ bannerKey: string }>('/api/v1/users/me/banner', form);
    return data.bannerKey;
  },

  /** MinIO 对象 key → 匿名可读的文件 URL */
  uploadFileUrl(key: string): string {
    if (!key) return '';
    return `${API_BASE}/api/v1/uploads/file/${key}`;
  },
  /**
   * TTML 校验 POST /api/v1/submissions/validate
   * body = 原始 TTML 文本 (text/plain), 经 Go 后端代理到 Worker
   */
  validateTtml(content: string): Promise<TtmlValidationResult> {
    return request<TtmlValidationResult>('/api/v1/submissions/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: content,
    });
  },

  /**
   * 上传 TTML 文件到 MinIO 待审核区 POST /api/v1/uploads/ttml
   * multipart/form-data: file + fileName
   */
  async uploadTtml(file: Blob, fileName: string): Promise<{ fileName: string }> {
    const form = new FormData();
    form.append('file', file, fileName);
    form.append('fileName', fileName);
    return requestForm<{ fileName: string }>('/api/v1/uploads/ttml', form);
  },

  /**
   * 上传投稿音频（含可选封面）POST /api/v1/uploads/audio
   * multipart/form-data：audio + submissionId + 可选元数据/封面。
   * title/artist/album 留空时后端会从音频 ID3 元数据自动解析回填。
   */
  async uploadAudio(
    submissionId: number,
    audioFile: File,
    coverFile?: File,
    meta?: {
      title?: string;
      artist?: string;
      album?: string;
      platform?: string;
      platformId?: string;
    }
  ): Promise<void> {
    const form = new FormData();
    form.append('audio', audioFile);
    form.append('submissionId', String(submissionId));
    if (meta?.title) form.append('title', meta.title);
    if (meta?.artist) form.append('artist', meta.artist);
    if (meta?.album) form.append('album', meta.album);
    if (meta?.platform) form.append('platform', meta.platform);
    if (meta?.platformId) form.append('platformId', meta.platformId);
    if (coverFile) form.append('cover', coverFile);

    const sizeMb = (audioFile.size / (1024 * 1024)).toFixed(1);
    await requestForm<unknown>('/api/v1/uploads/audio', form, {
      timeoutMs: 5 * 60_000,
      fileSizeMb: sizeMb,
      networkErrorMessage: `上传失败：连接中断，文件（${sizeMb} MB）可能超过服务器允许的上传大小，请压缩或更换更小的文件后重试`,
    });
  },

  /**
   * 创建投稿 POST /api/v1/submissions
   * metadata 直接使用 ttml_processor 的 TTMLMetadata 序列化格式 (snake_case)
   */
  createSubmission(params: {
    title: string;
    metadata: Record<string, unknown>;
    fileName: string;
    notes?: string;
    tags?: string[];
    language?: string;
    languages?: string[];
    isUnrearranged?: boolean;
    unrearrangedReason?: string;
    /** 投稿提交类型 */
    submissionType?: SubmissionType;
    /** 修正投稿指向的曲库歌曲 id */
    targetSongId?: number;
    /** 修正投稿指向的原歌词文件名 */
    targetRawLyricFile?: string;
    /** 修正差异快照（buildDiffSnapshot 生成） */
    diffSnapshot?: unknown;
    type?: string;
    status?: 'pending' | 'draft';
    /** 关联的歌词请愿 ID */
    petitionIds?: number[];
  }): Promise<{ id: number; petitionLinkFailed?: boolean }> {
    return request<{ id: number; petitionLinkFailed?: boolean }>('/api/v1/submissions', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  /** 更新投稿文件 PUT /api/v1/submissions/:id/file */
  updateSubmissionFile(
    id: number,
    params: {
      fileName: string;
      metadata?: {
        title: string;
        metadata: Record<string, unknown>;
        notes?: string;
        tags?: string[];
        language?: string;
        languages?: string[];
        isUnrearranged?: boolean;
        unrearrangedReason?: string;
        type?: string;
      };
    }
  ): Promise<void> {
    return request<void>(`/api/v1/submissions/${id}/file`, {
      method: 'PUT',
      body: JSON.stringify(params),
    });
  },

  /** 关闭投稿 POST /api/v1/submissions/:id/close */
  closeSubmission(id: number): Promise<void> {
    return request<void>(`/api/v1/submissions/${id}/close`, {
      method: 'POST',
    });
  },

  /** 审核 POST /api/v1/submissions/:id/review */
  reviewSubmission(id: number, action: ReviewAction, comment: string): Promise<void> {
    return request<void>(`/api/v1/submissions/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, comment }),
    });
  },

  /**
   * 标记为审核中 POST /api/v1/submissions/:id/mark-reviewing
   * 返回 held：是否真的由自己持有（他人已占用时 held=false，且不会抢占）
   */
  markReviewing(id: number): Promise<{ held: boolean }> {
    return request<{ held: boolean }>(`/api/v1/submissions/${id}/mark-reviewing`, {
      method: 'POST',
    });
  },

  /**
   * 审核占用心跳 POST /api/v1/submissions/:id/review-heartbeat
   * held 表示该投稿当前是否仍由自己持有（租约超时被释放时 held=false）；
   * status 为投稿最新状态，用于他人审核完成后同步本页状态
   */
  reviewHeartbeat(id: number): Promise<{ held: boolean; status: string }> {
    return request<{ held: boolean; status: string }>(
      `/api/v1/submissions/${id}/review-heartbeat`,
      { method: 'POST' }
    );
  },

  /**
   * 释放审核占用（恢复待审核）POST /api/v1/submissions/:id/release-review
   * @param keepalive 页面卸载（pagehide/beforeunload）期间调用时置 true，保证请求发出
   */
  releaseReview(id: number, keepalive = false): Promise<void> {
    return request<void>(`/api/v1/submissions/${id}/release-review`, {
      method: 'POST',
      keepalive,
    });
  },

  /** 审核员编辑器上下文 GET /api/v1/submissions/:id/editor-context */
  getEditorContext(id: number): Promise<EditorContext> {
    return request<EditorContext>(`/api/v1/submissions/${id}/editor-context`);
  },

  /** 投稿者编辑器上下文 GET /api/v1/submissions/:id/edit-context */
  getSubmitterEditorContext(id: number): Promise<EditorContext> {
    return request<EditorContext>(`/api/v1/submissions/${id}/edit-context`);
  },

  /** 投稿者保存编辑器修改 PUT /api/v1/submissions/:id/content */
  saveSubmitterContent(id: number, payload: SaveSubmitterContentPayload): Promise<void> {
    return request<void>(`/api/v1/submissions/${id}/content`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  /** 保存审核员修订 POST /api/v1/submissions/:id/revision */
  saveRevision(id: number, payload: SaveRevisionPayload): Promise<void> {
    return request<void>(`/api/v1/submissions/${id}/revision`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /** 读取审核员修订版 TTML 原文 GET /api/v1/submissions/:id/revision/ttml */
  async getRevisionTtml(id: number): Promise<string> {
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/v1/submissions/${id}/revision/ttml`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`获取修订版失败: ${res.status}`);
    return res.text();
  },

  /** 投稿者确认采用审核员修订版 POST /api/v1/submissions/:id/revision/adopt */
  adoptRevision(id: number): Promise<void> {
    return request<void>(`/api/v1/submissions/${id}/revision/adopt`, { method: 'POST' });
  },

  /** 投稿者保留原版、退回需修改 POST /api/v1/submissions/:id/revision/reject */
  rejectRevision(id: number, reason: string): Promise<void> {
    return request<void>(`/api/v1/submissions/${id}/revision/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  /** 评论列表 GET /api/v1/submissions/:id/comments */
  listSubmissionComments(id: number): Promise<SubmissionComment[]> {
    return request<SubmissionComment[]>(`/api/v1/submissions/${id}/comments`);
  },

  /** 添加评论 POST /api/v1/submissions/:id/comments */
  addSubmissionComment(id: number, content: string): Promise<void> {
    return request<void>(`/api/v1/submissions/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },

  /**
   * 获取投稿 TTML 纯文本 GET /api/v1/submissions/:id/ttml
   * 返回原始 TTML 文本 (非 JSON), 审核员或投稿者本人可访问
   */
  async getSubmissionTtml(id: number): Promise<string> {
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/v1/submissions/${id}/ttml`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (res.status === 401) {
      clearAuth();
      window.dispatchEvent(new Event('auth:unauthorized'));
      throw new Error('登录已失效');
    }
    if (!res.ok) {
      throw new Error(`获取 TTML 失败：HTTP ${res.status}`);
    }
    return res.text();
  },

  /** 搜索IP投稿列表 GET /api/v1/search-ip/submissions */
  listSearchIpSubmissions(
    params: {
      page?: number;
      limit?: number;
    } = {}
  ): Promise<SearchIpListResult> {
    const qs = buildQuery({ page: params.page, limit: params.limit });
    return request<SearchIpListResult>(`/api/v1/search-ip/submissions${qs}`);
  },

  /** 搜索IP投稿详情 GET /api/v1/search-ip/submissions/:id */
  getSearchIpSubmission(id: number): Promise<SearchIpSubmissionDetail> {
    return request<SearchIpSubmissionDetail>(`/api/v1/search-ip/submissions/${id}`);
  },

  /** 全部搜索IP投稿列表（审核中心用，仅审核员）GET /api/v1/search-ip/submissions/all */
  listAllSearchIpSubmissions(
    params: {
      status?: string;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<SearchIpListResult> {
    const qs = buildQuery({ status: params.status, page: params.page, limit: params.limit });
    return request<SearchIpListResult>(`/api/v1/search-ip/submissions/all${qs}`);
  },

  /** 审核搜索IP投稿（仅审核员）POST /api/v1/search-ip/submissions/:id/review */
  reviewSearchIpSubmission(id: number, action: 'approve' | 'reject'): Promise<void> {
    return request<void>(`/api/v1/search-ip/submissions/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
  },

  // ===== 审核员管理 =====

  /** 列出全部审核员 */
  listReviewers(): Promise<ReviewerListResult> {
    return request<ReviewerListResult>('/api/v1/admin/reviewers');
  },

  /** 添加审核员 */
  addReviewer(username: string): Promise<void> {
    return request<void>('/api/v1/admin/reviewers', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
  },

  /** 移除审核员 */
  removeReviewer(username: string): Promise<void> {
    return request<void>(`/api/v1/admin/reviewers/${encodeURIComponent(username)}`, {
      method: 'DELETE',
    });
  },

  // ===== 每日推荐 =====

  /**
   * 每日推荐封面图片 URL
   *
   * @param key 封面对象 key
   * @param width 传值则请求缩略图（列表页用，避免拉原图）；不传返回原图（下载海报、创作者预览用）
   */
  dailyCoverUrl(key: string, width?: number): string {
    const base = `${API_BASE}/api/v1/daily-recommendations/image/${encodeURIComponent(key)}`;
    return width ? `${base}?w=${width}` : base;
  },

  /**
   * 上传每日推荐封面到临时区 POST /api/v1/daily-recommendations/upload-temp
   * XHR 上传，支持进度回调
   */
  uploadDailyCover(
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<{ tempKey: string; abort: () => void }> {
    const token = getToken();
    const form = new FormData();
    form.append('file', file, file.name);
    const xhr = new XMLHttpRequest();
    const promise = new Promise<{ tempKey: string }>((resolve, reject) => {
      xhr.open('POST', `${API_BASE}/api/v1/daily-recommendations/upload-temp`);
      xhr.timeout = 120_000;
      xhr.ontimeout = () => reject(new Error('上传超时，请稍后重试'));
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        try {
          const json = JSON.parse(xhr.responseText) as ApiResponse<{ tempKey: string }>;
          if (xhr.status === 200 && json.code === 200 && json.data) {
            resolve({ tempKey: json.data.tempKey });
          } else {
            reject(new Error(json.message || `上传失败：HTTP ${xhr.status}`));
          }
        } catch {
          reject(new Error(`上传失败：HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('上传失败：网络错误'));
      xhr.send(form);
    });
    const abort = () => xhr.abort();
    return promise.then(({ tempKey }) => ({ tempKey, abort }));
  },

  /**
   * 通过 URL 代理上传每日推荐封面到临时区
   * POST /api/v1/daily-recommendations/upload-temp-from-url
   */
  uploadDailyCoverFromUrl(url: string): Promise<{ tempKey: string }> {
    return request<{ tempKey: string }>('/api/v1/daily-recommendations/upload-temp-from-url', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  },

  /** 检查日期是否可用 GET /api/v1/daily-recommendations/check-date */
  checkDailyDate(date: string): Promise<{ available: boolean }> {
    return request<{ available: boolean }>(
      `/api/v1/daily-recommendations/check-date?date=${encodeURIComponent(date)}`
    );
  },

  /**
   * 创建每日推荐投稿 POST /api/v1/daily-recommendations
   * multipart/form-data: songName, artist, coverTempKey, date, comment, ncmId
   */
  async createDailyRecommendation(params: {
    songName: string;
    artist: string;
    coverTempKey: string;
    date: string;
    comment: string;
    ncmId?: string;
    qqId?: string;
  }): Promise<{ id: number }> {
    const form = new FormData();
    form.append('songName', params.songName);
    form.append('artist', params.artist);
    form.append('coverTempKey', params.coverTempKey);
    form.append('date', params.date);
    form.append('comment', params.comment);
    if (params.ncmId) form.append('ncmId', params.ncmId);
    if (params.qqId) form.append('qqId', params.qqId);
    return requestForm<{ id: number }>('/api/v1/daily-recommendations', form);
  },

  /** 获取所有已通过的每日推荐 GET /api/v1/daily-recommendations（公开） */
  listDailyRecommendations(): Promise<DailyRecommendation[]> {
    return request<DailyRecommendation[]>('/api/v1/daily-recommendations');
  },

  /** 每日推荐点赞状态 GET /api/v1/daily-recommendations/like/:id（需登录） */
  getDailyLikeStatus(id: number): Promise<DailyLikeStatus> {
    return request<DailyLikeStatus>(`/api/v1/daily-recommendations/like/${id}`);
  },

  /** 切换每日推荐点赞 POST /api/v1/daily-recommendations/like/:id（需登录） */
  toggleDailyLike(id: number): Promise<DailyLikeStatus> {
    return request<DailyLikeStatus>(`/api/v1/daily-recommendations/like/${id}`, {
      method: 'POST',
    });
  },

  /** 获取今日推荐 GET /api/v1/daily-recommendations/today（公开） */
  getTodayRecommendation(): Promise<DailyRecommendation | null> {
    return request<DailyRecommendation | null>('/api/v1/daily-recommendations/today');
  },

  /** 获取最新收录列表 GET /api/v1/latest-songs（公开） */
  getLatestSongs(): Promise<LatestSongItem[]> {
    return request<LatestSongItem[]>('/api/v1/latest-songs');
  },

  /** 我的每日推荐投稿列表 GET /api/v1/daily-recommendations/submissions */
  listDailySubmissions(
    params: {
      page?: number;
      limit?: number;
    } = {}
  ): Promise<DailyRecListResult> {
    const qs = buildQuery({ page: params.page, limit: params.limit });
    return request<DailyRecListResult>(`/api/v1/daily-recommendations/submissions${qs}`);
  },

  /** 每日推荐投稿详情 GET /api/v1/daily-recommendations/submissions/:id */
  getDailySubmission(id: number): Promise<DailyRecommendation> {
    return request<DailyRecommendation>(`/api/v1/daily-recommendations/submissions/${id}`);
  },

  // ===== 在线搜索（多平台歌词） =====

  /** 搜索歌曲 GET /api/v1/online/search?q=&platform=&limit= */
  onlineSearch(q: string, platform: OnlinePlatform, limit = 15): Promise<OnlineSearchResult> {
    const qs = buildQuery({ q, platform, limit });
    return request<OnlineSearchResult>(`/api/v1/online/search${qs}`);
  },

  /** 获取歌曲详情 GET /api/v1/online/songs/:platform/:songId */
  getOnlineSong(platform: OnlinePlatform, songId: string): Promise<OnlineSongDetail> {
    return request<OnlineSongDetail>(
      `/api/v1/online/songs/${platform}/${encodeURIComponent(songId)}`
    );
  },

  /** 获取歌词 GET /api/v1/online/lyrics/:platform/:songId */
  getOnlineLyric(platform: OnlinePlatform, songId: string): Promise<OnlineLyric> {
    return request<OnlineLyric>(`/api/v1/online/lyrics/${platform}/${encodeURIComponent(songId)}`);
  },

  // ===== 消息中心 =====

  /** 消息列表 GET /api/v1/notifications?page=&limit=&type= */
  getNotifications(
    params: {
      page?: number;
      limit?: number;
      type?: MessageType | 'all';
    } = {}
  ): Promise<NotificationListResult> {
    const qs = buildQuery({
      page: params.page,
      limit: params.limit,
      type: params.type && params.type !== 'all' ? params.type : undefined,
    });
    return request<NotificationListResult>(`/api/v1/notifications${qs}`);
  },

  /** 未读数 GET /api/v1/notifications/unread-count */
  getUnreadCount(): Promise<{ unread: number }> {
    return request<{ unread: number }>('/api/v1/notifications/unread-count');
  },

  /** 标记单条已读 POST /api/v1/notifications/:id/read */
  markNotificationRead(id: number): Promise<{ id: number; read: boolean }> {
    return request<{ id: number; read: boolean }>(`/api/v1/notifications/${id}/read`, {
      method: 'POST',
    });
  },

  /** 全部已读 POST /api/v1/notifications/read-all */
  markAllNotificationsRead(): Promise<{ updated: number }> {
    return request<{ updated: number }>('/api/v1/notifications/read-all', { method: 'POST' });
  },

  /** 删除单条 DELETE /api/v1/notifications/:id */
  deleteNotification(id: number): Promise<{ id: number }> {
    return request<{ id: number }>(`/api/v1/notifications/${id}`, { method: 'DELETE' });
  },

  /** 发布前预览 */
  getAnnouncementAudience(): Promise<AnnouncementAudience> {
    return request<AnnouncementAudience>('/api/v1/manage/announcements/audience');
  },

  /** 公告历史 GET /api/v1/manage/announcements（审核员 / 超管） */
  listAnnouncements(page = 1, limit = 20): Promise<AnnouncementListResult> {
    const sp = new URLSearchParams({ page: String(page), limit: String(limit) });
    return request<AnnouncementListResult>(`/api/v1/manage/announcements?${sp.toString()}`);
  },

  /** 发布公告 POST /api/v1/manage/announcements */
  publishAnnouncement(params: {
    title: string;
    content: string;
    actionPath?: string;
    actionLabel?: string;
    sendMail?: boolean;
  }): Promise<Announcement> {
    return request<Announcement>('/api/v1/manage/announcements', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  /** 单条公告状态：发布后轮询邮件发送进度 */
  getAnnouncement(id: number): Promise<Announcement> {
    return request<Announcement>(`/api/v1/manage/announcements/${id}`);
  },

  //GitHub OAuth 登录/绑定

  /** GitHub 授权跳转地址（匿名登录/注册，整页跳转） */
  githubLoginURL(): string {
    return `${API_BASE}/api/v1/auth/github/login`;
  },

  /** 取已登录用户绑定 GitHub 的授权地址（前端取到后整页跳转，避免 JWT 入 URL） */
  async githubBindStart(): Promise<string> {
    const res = await request<{ url: string }>('/api/v1/auth/github/bind-url');
    return res.url;
  },

  /** 绑定页预填信息 POST /api/v1/auth/github/bind/info（票据走请求体，避免入日志） */
  getGithubBindInfo(token: string): Promise<GithubBindInfo> {
    return request<GithubBindInfo>('/api/v1/auth/github/bind/info', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  /** 登录已有账号并绑定 GitHub POST /api/v1/auth/github/bind/login */
  githubBindLogin(params: {
    token: string;
    account: string;
    password: string;
  }): Promise<LoginResult> {
    return request<LoginResult>('/api/v1/auth/github/bind/login', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  /** 注册新账号并绑定 GitHub POST /api/v1/auth/github/bind/register */
  githubBindRegister(params: {
    token: string;
    username: string;
    password: string;
    phone: string;
    code: string;
    email: string;
    emailCode: string;
    displayName: string;
  }): Promise<LoginResult> {
    return request<LoginResult>('/api/v1/auth/github/bind/register', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  /** 解绑 GitHub DELETE /api/v1/user/github/binding */
  unbindGithub(): Promise<void> {
    return request<void>('/api/v1/user/github/binding', { method: 'DELETE' });
  },

  // ===== 投稿数据迁移 =====

  /** 迁移页状态 GET /api/v1/migration/github/status */
  getMigrationStatus(): Promise<GithubMigrationStatus> {
    return request<GithubMigrationStatus>('/api/v1/migration/github/status');
  },

  /** 创建迁移任务 POST /api/v1/migration/github/start */
  startMigration(): Promise<GithubMigrationTask> {
    return request<GithubMigrationTask>('/api/v1/migration/github/start', { method: 'POST' });
  },

  /** 查询迁移任务进度 GET /api/v1/migration/github/tasks/:id */
  getMigrationTask(id: number): Promise<GithubMigrationTask> {
    return request<GithubMigrationTask>(`/api/v1/migration/github/tasks/${id}`);
  },

  /** 已迁移 PR 列表（含 PR 标题） GET /api/v1/migration/github/migrated */
  getMigratedPrs(limit = 100): Promise<GithubMigratedList> {
    return request<GithubMigratedList>(`/api/v1/migration/github/migrated?limit=${limit}`);
  },

  /** 重试迁移任务 POST /api/v1/migration/github/tasks/:id/retry */
  retryMigration(id: number): Promise<GithubMigrationTask> {
    return request<GithubMigrationTask>(`/api/v1/migration/github/tasks/${id}/retry`, {
      method: 'POST',
    });
  },

  // 歌词请愿

  /** 全站请愿列表 GET /api/v1/lyric-requests */
  listLyricRequests(
    params: {
      status?: LyricRequestStatus;
      sort?: 'latest' | 'hot';
      q?: string;
      page?: number;
      pageSize?: number;
    } = {}
  ): Promise<LyricRequestListResult> {
    return request<LyricRequestListResult>(
      `/api/v1/lyric-requests${buildQuery({
        status: params.status,
        sort: params.sort,
        q: params.q,
        page: params.page,
        pageSize: params.pageSize,
      })}`
    );
  },

  /** 我发起的请愿 GET /api/v1/lyric-requests/mine */
  listMyLyricRequests(
    params: {
      status?: LyricRequestStatus;
      q?: string;
      page?: number;
      pageSize?: number;
    } = {}
  ): Promise<LyricRequestListResult> {
    return request<LyricRequestListResult>(
      `/api/v1/lyric-requests/mine${buildQuery({
        status: params.status,
        q: params.q,
        page: params.page,
        pageSize: params.pageSize,
      })}`
    );
  },

  /** 首页/侧栏热门请愿 GET /api/v1/lyric-requests/hot */
  getHotLyricRequests(limit = 6): Promise<LyricRequestListResult> {
    return request<LyricRequestListResult>(`/api/v1/lyric-requests/hot${buildQuery({ limit })}`);
  },

  /** 请愿详情 GET /api/v1/lyric-requests/:id */
  getLyricRequest(id: number): Promise<LyricRequest> {
    return request<LyricRequest>(`/api/v1/lyric-requests/${id}`);
  },

  /** 发起请愿 POST /api/v1/lyric-requests */
  createLyricRequest(payload: LyricRequestPayload): Promise<CreateLyricRequestResult> {
    return request<CreateLyricRequestResult>('/api/v1/lyric-requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /** 编辑请愿 PUT /api/v1/lyric-requests/:id */
  updateLyricRequest(id: number, payload: LyricRequestPayload): Promise<void> {
    return request<void>(`/api/v1/lyric-requests/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  /** 撤回请愿 DELETE /api/v1/lyric-requests/:id */
  withdrawLyricRequest(id: number): Promise<void> {
    return request<void>(`/api/v1/lyric-requests/${id}`, { method: 'DELETE' });
  },

  /** 支持 / 取消支持 POST /api/v1/lyric-requests/:id/support */
  toggleLyricRequestSupport(id: number): Promise<{ supported: boolean; supportCount: number }> {
    return request<{ supported: boolean; supportCount: number }>(
      `/api/v1/lyric-requests/${id}/support`,
      { method: 'POST' }
    );
  },

  /** 请愿评论列表 GET /api/v1/lyric-requests/:id/comments */
  listLyricRequestComments(id: number): Promise<LyricRequestComment[]> {
    return request<LyricRequestComment[]>(`/api/v1/lyric-requests/${id}/comments`);
  },

  /** 发表请愿评论 POST /api/v1/lyric-requests/:id/comments */
  createLyricRequestComment(id: number, content: string): Promise<LyricRequestComment> {
    return request<LyricRequestComment>(`/api/v1/lyric-requests/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },

  /** 投稿时按平台 ID 匹配请愿 POST /api/v1/lyric-requests/match */
  matchLyricRequests(ids: {
    ncm?: string[];
    qq?: string[];
    spotify?: string[];
    apple?: string[];
  }): Promise<{ items: LyricRequest[] }> {
    return request<{ items: LyricRequest[] }>('/api/v1/lyric-requests/match', {
      method: 'POST',
      body: JSON.stringify({ platformIds: ids }),
    });
  },

  /** 投稿关联的请愿 GET /api/v1/submissions/:id/petitions */
  getSubmissionPetitions(id: number): Promise<{ items: PetitionLinkItem[] }> {
    return request<{ items: PetitionLinkItem[] }>(`/api/v1/submissions/${id}/petitions`);
  },

  /** 解除投稿与请愿的关联 DELETE /api/v1/submissions/:id/petitions/:requestId */
  unbindSubmissionPetition(id: number, requestId: number): Promise<void> {
    return request<void>(`/api/v1/submissions/${id}/petitions/${requestId}`, {
      method: 'DELETE',
    });
  },

  /** 管理员标记请愿状态 POST /api/v1/admin/lyric-requests/:id/status */
  setLyricRequestStatus(id: number, status: LyricRequestStatus): Promise<void> {
    return request<void>(`/api/v1/admin/lyric-requests/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  },

  // ===== 插件广场 =====
  pluginStore: {
    /** 公开列表 GET /api/v1/store/plugins */
    list(params: {
      page?: number;
      pageSize?: number;
      q?: string;
      channel?: PluginChannel | '';
      sort?: 'recent' | 'downloads' | 'name';
    }): Promise<PluginStoreListResult> {
      return request<PluginStoreListResult>(
        `/api/v1/store/plugins${buildQuery({
          page: params.page,
          page_size: params.pageSize,
          q: params.q,
          channel: params.channel || undefined,
          sort: params.sort,
        })}`
      );
    },

    /** 公开详情 GET /api/v1/store/plugins/:key */
    detail(key: string): Promise<PluginDetailResult> {
      return request<PluginDetailResult>(`/api/v1/store/plugins/${encodeURIComponent(key)}`);
    },

    /** 提交评分 POST /api/v1/store/plugins/:key/ratings */
    rate(key: string, score: number): Promise<{ rating: PluginRatingSummary; myScore: number }> {
      return request<{ rating: PluginRatingSummary; myScore: number }>(
        `/api/v1/store/plugins/${encodeURIComponent(key)}/ratings`,
        {
          method: 'POST',
          body: JSON.stringify({ score }),
        }
      );
    },

    /** 预校验 POST /api/v1/store/submissions/validate */
    validateSubmission(form: FormData): Promise<PluginValidateResult> {
      return requestForm<PluginValidateResult>('/api/v1/store/submissions/validate', form);
    },

    /** 上传投稿 POST /api/v1/store/submissions */
    createSubmission(form: FormData): Promise<PluginSubmissionResult> {
      return requestForm<PluginSubmissionResult>('/api/v1/store/submissions', form);
    },

    /** 发布者插件列表 GET /api/v1/store/my/plugins */
    myPlugins(params: {
      page?: number;
      pageSize?: number;
      q?: string;
    }): Promise<PluginManagementListResult> {
      return request<PluginManagementListResult>(
        `/api/v1/store/my/plugins${buildQuery({
          page: params.page,
          page_size: params.pageSize,
          q: params.q,
        })}`
      );
    },

    /** 发布者单个插件详情 GET /api/v1/store/my/plugins/:key */
    myPluginDetail(key: string): Promise<PluginManagementItem> {
      return request<PluginManagementItem>(`/api/v1/store/my/plugins/${encodeURIComponent(key)}`);
    },

    /** 编辑插件级展示信息 PUT /api/v1/store/my/plugins/:key */
    updateMyPlugin(key: string, payload: PluginManagementUpdatePayload): Promise<void> {
      return request<void>(`/api/v1/store/my/plugins/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    },

    /** 下架插件 POST /api/v1/store/my/plugins/:key/unlist */
    unlistMyPlugin(key: string): Promise<void> {
      return request<void>(`/api/v1/store/my/plugins/${encodeURIComponent(key)}/unlist`, {
        method: 'POST',
      });
    },

    /** 回滚到历史版本 POST /api/v1/store/my/plugins/:key/versions/:id/rollback */
    rollbackMyPluginVersion(key: string, versionId: number): Promise<void> {
      return request<void>(
        `/api/v1/store/my/plugins/${encodeURIComponent(key)}/versions/${versionId}/rollback`,
        { method: 'POST' }
      );
    },

    /** 审核员读取插件详情 GET /api/v1/store/review/plugins/:key */
    reviewPluginDetail(key: string): Promise<PluginManagementItem> {
      return request<PluginManagementItem>(
        `/api/v1/store/review/plugins/${encodeURIComponent(key)}`
      );
    },

    /** 带鉴权下载插件包（直接打开链接不会携带 token） */
    async downloadSubmissionArtifact(versionId: number, filename: string): Promise<void> {
      const token = getToken();
      const res = await fetch(`/api/v1/store/submissions/${versionId}/artifact`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        let message = '下载失败';
        try {
          const data = (await res.json()) as { message?: string };
          if (data?.message) message = data.message;
        } catch {
          // 忽略非 JSON 响应
        }
        throw new Error(message);
      }
      triggerDownload(await res.blob(), filename);
    },

    /** 上传插件图标 POST /api/v1/store/plugins/:key/icon */
    uploadIcon(key: string, form: FormData): Promise<{ iconUrl: string }> {
      return requestForm<{ iconUrl: string }>(
        `/api/v1/store/plugins/${encodeURIComponent(key)}/icon`,
        form
      );
    },

    /** 插件评论列表 GET /api/v1/store/plugins/:key/comments */
    pluginComments(key: string): Promise<PluginComment[]> {
      return request<PluginComment[]>(`/api/v1/store/plugins/${encodeURIComponent(key)}/comments`);
    },

    /** 发表插件评论 POST /api/v1/store/plugins/:key/comments */
    addPluginComment(key: string, content: string): Promise<void> {
      return request<void>(`/api/v1/store/plugins/${encodeURIComponent(key)}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
    },

    /** 审核队列 GET /api/v1/store/review/queue */
    reviewQueue(params: {
      page?: number;
      pageSize?: number;
      q?: string;
      status?: string;
    }): Promise<PluginReviewQueueResult> {
      return request<PluginReviewQueueResult>(
        `/api/v1/store/review/queue${buildQuery({
          page: params.page,
          page_size: params.pageSize,
          q: params.q,
          status: params.status,
        })}`
      );
    },

    /** 审核详情 GET /api/v1/store/review/:id */
    reviewDetail(id: number): Promise<PluginReviewDetailResult> {
      return request<PluginReviewDetailResult>(`/api/v1/store/review/${id}`);
    },

    /** 审核通过 / 拒绝 POST /api/v1/store/review/:id/decision */
    decideReview(id: number, action: 'approve' | 'reject', comment: string): Promise<void> {
      return request<void>(`/api/v1/store/review/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ action, comment }),
      });
    },

    /** 管理端插件列表 GET /api/v1/store/admin/plugins */
    adminList(params: {
      page?: number;
      pageSize?: number;
      q?: string;
    }): Promise<PluginAdminListResult> {
      return request<PluginAdminListResult>(
        `/api/v1/store/admin/plugins${buildQuery({
          page: params.page,
          page_size: params.pageSize,
          q: params.q,
        })}`
      );
    },

    /** 管理端插件详情 GET /api/v1/store/admin/plugins/:id */
    adminDetail(id: number): Promise<PluginAdminDetailResult> {
      return request<PluginAdminDetailResult>(`/api/v1/store/admin/plugins/${id}`);
    },

    /** 上架 / 下架 / yank POST /api/v1/store/admin/versions/:id/listing */
    adminListing(id: number, action: 'list' | 'unlist' | 'yank', reason = ''): Promise<void> {
      return request<void>(`/api/v1/store/admin/versions/${id}/listing`, {
        method: 'POST',
        body: JSON.stringify({ action, reason }),
      });
    },

    /** 插件状态 POST /api/v1/store/admin/plugins/:id/status */
    adminStatus(id: number, status: PluginStatus, reason = ''): Promise<void> {
      return request<void>(`/api/v1/store/admin/plugins/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status, reason }),
      });
    },

    /** 硬删除版本 DELETE /api/v1/store/admin/versions/:id */
    adminDeleteVersion(id: number, reason = ''): Promise<void> {
      return request<void>(`/api/v1/store/admin/versions/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
      });
    },

    /** 硬删除插件 DELETE /api/v1/store/admin/plugins/:id */
    adminDeletePlugin(id: number, reason = ''): Promise<void> {
      return request<void>(`/api/v1/store/admin/plugins/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
      });
    },

    /** 审计列表 GET /api/v1/store/admin/audit */
    adminAudit(params: {
      page?: number;
      pageSize?: number;
      targetType?: string;
      targetId?: number;
      operator?: string;
      action?: string;
    }): Promise<PluginAuditListResult> {
      return request<PluginAuditListResult>(
        `/api/v1/store/admin/audit${buildQuery({
          page: params.page,
          page_size: params.pageSize,
          target_type: params.targetType,
          target_id: params.targetId,
          operator: params.operator,
          action: params.action,
        })}`
      );
    },
  },
};

// ===== 内部小工具：loose 字段提取 =====
function asString(v: unknown): string | undefined {
  if (typeof v === 'string' && v !== '') return v;
  return undefined;
}
function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  return undefined;
}
