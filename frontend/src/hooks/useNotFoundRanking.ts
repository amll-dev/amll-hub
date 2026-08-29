import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import type { NotFoundRankingResult } from '@/lib/types';

interface UseNotFoundRankingParams {
  limit?: number | 'all';
  days?: number;
  platform?: string;
}

/**
 * 无歌词排行榜请求 hook。
 * 参数（days/platform/limit）变化时自动重新请求；
 * 竞态与去重由 Query 按 queryKey 处理，翻页/切参数期间保留旧数据（keepPreviousData）。
 */
export function useNotFoundRanking(params: UseNotFoundRankingParams = {}) {
  const { limit, days, platform } = params;

  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.notFoundRanking({ limit, days, platform }),
    queryFn: () => api.getNotFoundRanking({ limit, days, platform }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    select: (raw: NotFoundRankingResult) => ({
      ...raw,
      // 兜底：旧缓存或异常数据可能缺失 artists 等字段
      items: (raw?.items ?? []).map((it) => ({
        ...it,
        songName: it.songName ?? '',
        artists: Array.isArray(it.artists) ? it.artists : [],
        cover: it.cover ?? '',
        album: it.album ?? '',
      })),
    }),
  });

  return {
    data: data ?? null,
    loading: isPending,
    isFetching,
    error: error ? (error instanceof Error ? error.message : '加载失败') : null,
    refresh: refetch,
  };
}
