import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from './api';
import type { MessageType } from './types';

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * 全局 API 错误处理（拦截器层）。
 *
 * mutation：组件里用自己的 onError 做了内联提示的（表单消息、乐观回滚等），
 * 全局不再重复弹 toast；没有任何 onError 的 mutation（漏网/未来新增）由这里兜底提示。
 * query：首次加载的错误由页面渲染错误态；这里只提示"后台重取失败"——
 * 此时页面还显示着旧数据，用户对失败完全无感知，必须给反馈。
 */
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.state.data !== undefined) {
        toast.error(toMessage(error, '刷新失败，稍后将自动重试'));
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      // 组件自带 onError 的视为已处理，避免双重提示
      if (mutation.options.onError) return;
      // 登录失效已由 api 层派发事件弹登录窗，不再弹 toast
      if (error instanceof ApiError && error.code === 401) return;
      toast.error(toMessage(error, '操作失败'));
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiError) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * 服务端数据的 queryKey 约定。
 * 统一在这里管理，避免散落的数组字面量导致 invalidate 时对不上 key。
 * 命名与 REST 路径一致：列表用复数，详情用单数 + id。
 */
export const queryKeys = {
  // 公开数据
  stats: ['stats'] as const,
  notFoundRanking: (params: { limit?: number | 'all'; days?: number; platform?: string }) =>
    ['not-found-ranking', params] as const,
  latestSongs: ['latest-songs'] as const,
  search: (q: string, field: string, page: number) => ['search', { q, field, page }] as const,
  /** 按歌曲搜索目标歌词 */
  revisionTarget: (q: string) => ['revision-target', q] as const,
  /** 搜索页各 Tab 的命中数（与分页/字段无关，按关键词缓存） */
  searchCounts: (q: string) => ['search-counts', q] as const,
  /** 用户搜索结果 */
  searchUsers: (q: string, limit: number) => ['user-search', { q, limit }] as const,

  // 在线歌词搜索
  onlineSearch: (q: string, platform: string) => ['online-search', { q, platform }] as const,

  // 网易云解析
  ncmSearch: (q: string) => ['ncm-search', { q }] as const,
  ncmPlaylist: (id: string) => ['ncm-playlist', { id }] as const,
  qmSearch: (q: string) => ['qm-search', { q }] as const,
  qmPlaylist: (id: string) => ['qm-playlist', { id }] as const,
  /** 单曲解析（同一投稿可能有多个 ID，编辑器按批量 key 缓存） */
  ncmMusics: (ids: string[]) => ['ncm-music-batch', ids.join(',')] as const,
  qmMusics: (ids: string[]) => ['qm-music-batch', ids.join(',')] as const,

  // 认证
  profile: ['auth', 'profile'] as const,
  captcha: ['auth', 'captcha'] as const,
  /** 扫码登录票据（登录弹窗打开期间申请） */
  qrTicket: ['auth', 'qr-ticket'] as const,
  /** 身份验证状态（改联系方式 / 改密码前会查询） */
  identity: ['auth', 'identity'] as const,

  // 投稿（creator 模式用无限滚动，page 不进 key；review 模式按页查询，page 进 key）
  submissions: (params: {
    mode: 'creator' | 'review';
    status?: string;
    search?: string;
    language?: string;
    limit?: number;
    page?: number;
  }) => ['submissions', params] as const,
  submission: (id: number) => ['submission', id] as const,
  submissionComments: (id: number) => ['submission', id, 'comments'] as const,
  submissionTtml: (id: number) => ['submission', id, 'ttml'] as const,
  /** 审核员编辑器上下文 */
  editorContext: (id: number) => ['submission', id, 'editor-context'] as const,
  /** 投稿者编辑器上下文 */
  submitterEditorContext: (id: number) => ['submission', id, 'submitter-editor-context'] as const,
  /** 审核员修订版 TTML 原文 */
  revisionTtml: (id: number) => ['submission', id, 'revision-ttml'] as const,
  userActivity: (year: number) => ['user-activity', year] as const,

  // 公开用户主页（与本人的 ['user-activity', year] 区分开）
  userProfile: (name: string) => ['user-profile', name] as const,
  userSubmissions: (
    name: string,
    params: { status?: string; language?: string; sort?: string; limit?: number }
  ) => ['user-submissions', name, params] as const,
  userActivityOf: (name: string, year: number) => ['user-activity', name, year] as const,

  // 搜索IP投稿
  searchIpSubmissions: (scope: 'mine' | 'all', status?: string, page?: number) =>
    ['search-ip-submissions', scope, status, page] as const,
  searchIpSubmission: (id: number) => ['search-ip-submission', id] as const,

  // 每日推荐
  dailyList: ['daily-recommendations'] as const,
  dailyToday: ['daily-recommendations', 'today'] as const,
  dailyLikeStatus: (id: number) => ['daily-recommendations', id, 'like'] as const,
  dailySubmissions: (page?: number) =>
    ['daily-recommendations', 'submissions', 'list', page] as const,
  dailySubmission: (id: number) => ['daily-recommendations', 'submissions', 'detail', id] as const,
  dailyDateCheck: (date: string) => ['daily-recommendations', 'date-check', date] as const,

  // 歌词查看
  viewLyric: (filename: string) => ['view-lyric', filename] as const,
  /** 歌词历史版本 */
  lyricVersions: (filename: string) => ['lyric-versions', filename] as const,
  parseLyric: (hash: string) => ['parse-lyric', hash] as const,
  onlineViewLyric: (platform: string, songId: string) =>
    ['online-view-lyric', platform, songId] as const,

  // 审核员管理
  reviewers: ['admin', 'reviewers'] as const,

  // 插件广场
  pluginList: (params: {
    page?: number;
    pageSize?: number;
    q?: string;
    channel?: string;
    sort?: string;
  }) => ['plugins', 'list', params] as const,
  pluginDetail: (key: string) => ['plugin', key] as const,
  myPluginSubmissions: (params: { page?: number; pageSize?: number; status?: string }) =>
    ['plugins', 'mine', params] as const,
  myPlugins: (params: { page?: number; pageSize?: number; q?: string }) =>
    ['plugins', 'mine-plugins', params] as const,
  myPluginDetail: (key: string) => ['plugins', 'mine-plugin', key] as const,
  pluginComments: (key: string) => ['plugin', key, 'comments'] as const,
  pluginReviewQueue: (params: { page?: number; pageSize?: number; q?: string; status?: string }) =>
    ['plugins', 'review-queue', params] as const,
  pluginReviewDetail: (id: number) => ['plugin-review', id] as const,
  adminPlugins: (params: { page?: number; pageSize?: number; q?: string }) =>
    ['plugins', 'admin', params] as const,
  adminPluginDetail: (id: number) => ['plugin', 'admin', id] as const,
  adminPluginAudit: (params: {
    page?: number;
    pageSize?: number;
    targetType?: string;
    targetId?: number;
  }) => ['plugins', 'audit', params] as const,

  // GitHub 投稿数据迁移
  githubMigration: ['github-migration', 'status'] as const,
  githubMigrated: ['github-migration', 'migrated'] as const,

  // 消息中心（统一前缀，removeQueries(['notifications']) 可一并清除）
  // 列表单独加一段 'list'：与未读数 query（形状为 { unread }）区分，
  // 否则按 ['notifications'] 前缀做乐观更新会命中未读数缓存并抛错。
  notifications: (params: { page: number; limit: number; type?: MessageType | 'all' }) =>
    ['notifications', 'list', params] as const,
  notificationUnread: ['notifications', 'unread'] as const,

  // 系统公告
  announcementAudience: ['announcements', 'audience'] as const,
  announcements: (page: number) => ['announcements', 'list', page] as const,
  /** 单条公告发送状态 */
  announcement: (id: number) => ['announcements', 'detail', id] as const,

  // 歌词请愿
  lyricRequests: (params: {
    status?: string;
    sort?: string;
    q?: string;
    page?: number;
    pageSize?: number;
  }) => ['lyric-requests', 'list', params] as const,
  lyricRequestsMine: (params: { status?: string; q?: string; page?: number; pageSize?: number }) =>
    ['lyric-requests', 'mine', params] as const,
  lyricRequestHot: (limit: number) => ['lyric-requests', 'hot', limit] as const,
  lyricRequest: (id: number) => ['lyric-requests', 'detail', id] as const,
  lyricRequestComments: (id: number) => ['lyric-requests', 'comments', id] as const,
  /** 投稿时按平台 ID 匹配请愿 */
  petitionMatch: (key: string) => ['lyric-requests', 'match', key] as const,
  /** 投稿详情里关联的请愿 */
  submissionPetitions: (id: number) => ['submission-petitions', id] as const,
} as const;
