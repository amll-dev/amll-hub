import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { NotFoundRankingResult } from '@/lib/types';

interface UseNotFoundRankingParams {
  limit?: number | 'all';
  days?: number;
  platform?: string;
}

interface State {
  data: NotFoundRankingResult | null;
  loading: boolean;
  error: string | null;
}

/**
 * 无歌词排行榜请求 hook。
 * 参数（days/platform/limit）变化时自动重新请求；取消竞态用 active flag。
 */
export function useNotFoundRanking(params: UseNotFoundRankingParams = {}) {
  const { limit, days, platform } = params;
  const [state, setState] = useState<State>({
    data: null,
    loading: true,
    error: null,
  });

  // 命名为 loadRanking，避免遮蔽全局 fetch
  const loadRanking = useCallback(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .getNotFoundRanking({ limit, days, platform })
      .then((raw) => {
        if (!active) return;
        // 兜底：旧缓存或异常数据可能缺失 artists 等字段
        const items = (raw?.items ?? []).map((it) => ({
          ...it,
          songName: it.songName ?? '',
          artists: Array.isArray(it.artists) ? it.artists : [],
          cover: it.cover ?? '',
          album: it.album ?? '',
        }));
        setState({ data: { ...raw, items }, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (active)
          setState((s) => ({
            ...s,
            loading: false,
            error: err instanceof Error ? err.message : '加载失败',
          }));
      });
    return () => {
      active = false;
    };
  }, [limit, days, platform]);

  useEffect(() => {
    return loadRanking();
  }, [loadRanking]);

  const refresh = useCallback(() => {
    loadRanking();
  }, [loadRanking]);

  return { ...state, refresh };
}
