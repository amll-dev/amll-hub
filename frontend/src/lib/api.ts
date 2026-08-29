import type {
  ApiResponse,
  DailyLikeStatus,
  DailyRecommendation,
  DailyRecListResult,
  LatestSongItem,
  LyricViewResponse,
  NcmMusicInfo,
  NcmPlaylistResult,
  NcmSearchResult,
  NotFoundRankingResult,
  OnlineLyric,
  OnlinePlatform,
  OnlineSearchResult,
  OnlineSongDetail,
  ReviewAction,
  SearchField,
  SearchIpListResult,
  SearchIpSubmissionDetail,
  SearchResult,
  SearchIpData,
  SearchIpMatchResult,
  Stats,
  SubmissionComment,
  SubmissionDetail,
  SubmissionListResult,
  TtmlValidationResult,
} from './types';
import type { CaptchaConfig, LoginResult, UserProfile } from './auth';
import { clearAuth, getToken } from './auth';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

/** 请求超时（毫秒）：防止挂起的连接卡死 UI */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * 后端业务错误（响应体 code !== 200 或 401）。
 * 区别于网络层错误：TanStack Query 据此跳过重试。
 */
export class ApiError extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

/**
 * 统一请求管道（所有 JSON API 的唯一入口，等价于 axios 拦截器）：
 * 1. 注入 Authorization（有 token 时）
 * 2. 401 统一处理：清登录态 + 派发 auth:unauthorized（AuthProvider 弹登录窗）
 * 3. 业务码/HTTP 状态统一转换为 ApiError
 * 4. dev 环境统一请求日志（方法/路径/耗时/状态）
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();
  const method = init?.method ?? 'GET';

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('请求超时，请稍后重试', { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  if (import.meta.env.DEV) {
    console.debug(`[api] ${method} ${path} → ${res.status} (${Math.round(performance.now() - startedAt)}ms)`);
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
    }
    throw new ApiError(msg, 401);
  }

  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new Error(`请求失败：HTTP ${res.status}`);
  }

  if (json.code !== 200) {
    throw new ApiError(json.message || `请求失败：HTTP ${res.status}`, json.code);
  }
  return json.data as T;
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
    const res = await fetch(`${API_BASE}/api/v1/ncm/parse-music${qs}`);
    const json = (await res.json()) as ApiResponse<Record<string, unknown>>;
    if (json.code !== 200 || !json.data) {
      throw new Error(json.message || `解析失败：HTTP ${res.status}`);
    }
    const d = json.data;
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

  /**
   * 获取 ncm-lyrics 文件夹下的 TTML 歌词（按歌曲 ID）。
   * 后端 GET /api/v1/lyrics/ncm-lyrics/:songId 直接返回 TTML 字节流。
   */
  async getNcmLyricTtml(songId: string): Promise<string | null> {
    const res = await fetch(`${API_BASE}/api/v1/lyrics/ncm-lyrics/${encodeURIComponent(songId)}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`获取歌词失败：HTTP ${res.status}`);
    }
    return res.text();
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

  /** 修改密码 POST /api/v1/auth/change-password */
  changePassword(oldPassword: string, newPassword: string): Promise<void> {
    return request<void>('/api/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    });
  },

  /**
   * 上传头像 POST /api/v1/auth/avatar
   * multipart/form-data，需单独 fetch
   */
  async uploadAvatar(file: File): Promise<string> {
    const token = getToken();
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/api/v1/auth/avatar`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    const json = (await res.json()) as ApiResponse<{ avatar: string }>;
    if (json.code !== 200 || !json.data) {
      throw new Error(json.message || `上传失败：HTTP ${res.status}`);
    }
    return json.data.avatar;
  },

  /**
   * 创建搜索IP投稿 POST /api/v1/search-ip/submissions
   */
  async createSearchIpSubmission(params: {
    title?: string;
    jsonData: SearchIpData;
    tempKeys: Record<string, string>;
  }): Promise<{ id: number; imageCount: number }> {
    const token = getToken();
    const form = new FormData();
    if (params.title) form.append('title', params.title);
    form.append('data', JSON.stringify(params.jsonData));
    form.append('tempKeys', JSON.stringify(params.tempKeys));
    const res = await fetch(`${API_BASE}/api/v1/search-ip/submissions`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    const json = (await res.json()) as ApiResponse<{ id: number; imageCount: number }>;
    if (json.code !== 200 || !json.data) {
      throw new Error(json.message || `投稿失败：HTTP ${res.status}`);
    }
    return json.data;
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
    const token = getToken();
    const form = new FormData();
    form.append('file', file, fileName);
    form.append('fileName', fileName);
    const res = await fetch(`${API_BASE}/api/v1/uploads/ttml`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    const json = (await res.json()) as ApiResponse<{ fileName: string }>;
    if (json.code !== 200 || !json.data) {
      throw new Error(json.message || `上传失败：HTTP ${res.status}`);
    }
    return json.data;
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
    const token = getToken();
    const form = new FormData();
    form.append('audio', audioFile);
    form.append('submissionId', String(submissionId));
    if (meta?.title) form.append('title', meta.title);
    if (meta?.artist) form.append('artist', meta.artist);
    if (meta?.album) form.append('album', meta.album);
    if (meta?.platform) form.append('platform', meta.platform);
    if (meta?.platformId) form.append('platformId', meta.platformId);
    if (coverFile) form.append('cover', coverFile);

    const res = await fetch(`${API_BASE}/api/v1/uploads/audio`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    if (!res.ok) {
      let message = `上传失败：HTTP ${res.status}`;
      try {
        const json = (await res.json()) as ApiResponse<unknown>;
        if (json.message) message = json.message;
      } catch {
        // 响应非 JSON，使用默认消息
      }
      throw new Error(message);
    }
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
    type?: string;
    status?: 'pending' | 'draft';
  }): Promise<{ id: number }> {
    return request<{ id: number }>('/api/v1/submissions', {
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

  /** 标记为审核中 POST /api/v1/submissions/:id/mark-reviewing */
  markReviewing(id: number): Promise<void> {
    return request<void>(`/api/v1/submissions/${id}/mark-reviewing`, {
      method: 'POST',
    });
  },

  /**
   * 释放审核占用（恢复待审核）POST /api/v1/submissions/:id/release-review
   * @param keepalive 页面卸载（beforeunload）期间调用时置 true，保证请求发出
   */
  releaseReview(id: number, keepalive = false): Promise<void> {
    return request<void>(`/api/v1/submissions/${id}/release-review`, {
      method: 'POST',
      keepalive,
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
  listSearchIpSubmissions(): Promise<SearchIpListResult> {
    return request<SearchIpListResult>(`/api/v1/search-ip/submissions`);
  },

  /** 搜索IP投稿详情 GET /api/v1/search-ip/submissions/:id */
  getSearchIpSubmission(id: number): Promise<SearchIpSubmissionDetail> {
    return request<SearchIpSubmissionDetail>(`/api/v1/search-ip/submissions/${id}`);
  },

  /** 全部搜索IP投稿列表（审核中心用，仅审核员）GET /api/v1/search-ip/submissions/all */
  listAllSearchIpSubmissions(status?: string): Promise<SearchIpListResult> {
    const qs = buildQuery({ status });
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

  /** 列出全部审核员用户名 */
  listReviewers(): Promise<{ items: string[]; total: number }> {
    return request<{ items: string[]; total: number }>('/api/v1/admin/reviewers');
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

  /** 每日推荐封面图片 URL */
  dailyCoverUrl(key: string): string {
    return `${API_BASE}/api/v1/daily-recommendations/image/${encodeURIComponent(key)}`;
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
  }): Promise<{ id: number }> {
    const token = getToken();
    const form = new FormData();
    form.append('songName', params.songName);
    form.append('artist', params.artist);
    form.append('coverTempKey', params.coverTempKey);
    form.append('date', params.date);
    form.append('comment', params.comment);
    if (params.ncmId) form.append('ncmId', params.ncmId);
    const res = await fetch(`${API_BASE}/api/v1/daily-recommendations`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    const json = (await res.json()) as ApiResponse<{ id: number }>;
    if (json.code !== 200 || !json.data) {
      throw new Error(json.message || `投稿失败：HTTP ${res.status}`);
    }
    return json.data;
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
  listDailySubmissions(): Promise<DailyRecListResult> {
    return request<DailyRecListResult>('/api/v1/daily-recommendations/submissions');
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
