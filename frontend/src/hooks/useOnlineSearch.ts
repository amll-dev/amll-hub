import { useCallback } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useQuery } from '@tanstack/react-query';
import type { OnlinePlatform, OnlineSearchResult } from '@/lib/types';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import {
  onlineInputValueAtom,
  onlineQueryAtom,
  onlinePlatformAtom,
  onlineCommittedAtom,
} from '@/atoms/onlineSearch';

export interface OnlineSearchContextValue {
  // 搜索
  /** 输入框当前值（未提交） */
  inputValue: string;
  setInputValue: (v: string) => void;
  query: string;
  setQuery: (v: string) => void;
  platform: OnlinePlatform;
  setPlatform: (v: OnlinePlatform) => void;
  searchLoading: boolean;
  searchError: string | null;
  searchResults: OnlineSearchResult | null;
  /** @param overrideQ 覆盖搜索词 @param overridePlatform 覆盖平台（切换平台立即重搜时传入，避免闭包旧值） */
  doSearch: (q?: string, overridePlatform?: OnlinePlatform) => Promise<void>;
}

/**
 * 平台歌词搜索状态（jotai atoms，全局可用，无需 Provider）。
 * 搜索请求由 TanStack Query 按 {关键词, 平台} 缓存去重，竞态由 queryKey 隔离。
 * 歌曲详情与歌词不在此维护选中态：查看页（LyricViewer 的 online 模式）
 * 用自己的 queryKey 独立加载并渲染错误态，语义与旧"失败降级为无歌词"一致。
 */
export function useOnlineSearch(): OnlineSearchContextValue {
  const [inputValue, setInputValue] = useAtom(onlineInputValueAtom);
  const [query, setQuery] = useAtom(onlineQueryAtom);
  const [platform, setPlatform] = useAtom(onlinePlatformAtom);
  const committed = useAtomValue(onlineCommittedAtom);
  const [, setCommitted] = useAtom(onlineCommittedAtom);

  const doSearch = useCallback(
    async (overrideQ?: string, overridePlatform?: OnlinePlatform) => {
      const q = (overrideQ ?? query).trim();
      const p = overridePlatform ?? platform;
      if (!q) return;

      // 同步已提交搜索词（页面不再单独调 setQuery）
      setQuery(q);
      setCommitted({ q, platform: p });
    },
    [query, platform, setQuery, setCommitted]
  );

  const searchQuery = useQuery({
    queryKey: queryKeys.onlineSearch(committed?.q ?? '', committed?.platform ?? 'ncm'),
    queryFn: () => api.onlineSearch(committed!.q, committed!.platform),
    enabled: !!committed?.q,
    staleTime: 60_000,
  });

  return {
    inputValue,
    setInputValue,
    query,
    setQuery,
    platform,
    setPlatform,
    searchLoading: searchQuery.isFetching,
    searchError: searchQuery.error
      ? searchQuery.error instanceof Error
        ? searchQuery.error.message
        : '搜索失败'
      : null,
    searchResults: committed ? (searchQuery.data ?? null) : null,
    doSearch,
  };
}
