import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from './api';

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

  // 在线歌词搜索
  onlineSearch: (q: string, platform: string) => ['online-search', { q, platform }] as const,

  // 网易云解析
  ncmSearch: (q: string) => ['ncm-search', { q }] as const,
  ncmPlaylist: (id: string) => ['ncm-playlist', { id }] as const,

  // 认证
  profile: ['auth', 'profile'] as const,
  captcha: ['auth', 'captcha'] as const,

  // 投稿（page 不进 key：无限滚动由 useInfiniteQuery 的 pageParam 管理）
  submissions: (params: {
    mode: 'creator' | 'review';
    status?: string;
    search?: string;
    language?: string;
    limit?: number;
  }) => ['submissions', params] as const,
  submission: (id: number) => ['submission', id] as const,
  submissionComments: (id: number) => ['submission', id, 'comments'] as const,
  submissionTtml: (id: number) => ['submission', id, 'ttml'] as const,

  // 搜索IP投稿
  searchIpSubmissions: (scope: 'mine' | 'all', status?: string) =>
    ['search-ip-submissions', scope, status] as const,
  searchIpSubmission: (id: number) => ['search-ip-submission', id] as const,

  // 每日推荐
  dailyList: ['daily-recommendations'] as const,
  dailyToday: ['daily-recommendations', 'today'] as const,
  dailyLikeStatus: (id: number) => ['daily-recommendations', id, 'like'] as const,
  dailySubmissions: ['daily-recommendations', 'submissions'] as const,
  dailySubmission: (id: number) => ['daily-recommendations', 'submissions', id] as const,
  dailyDateCheck: (date: string) => ['daily-recommendations', 'date-check', date] as const,

  // 歌词查看
  viewLyric: (filename: string) => ['view-lyric', filename] as const,
  parseLyric: (hash: string) => ['parse-lyric', hash] as const,
  onlineViewLyric: (platform: string, songId: string) =>
    ['online-view-lyric', platform, songId] as const,

  // 审核员管理
  reviewers: ['admin', 'reviewers'] as const,
} as const;
