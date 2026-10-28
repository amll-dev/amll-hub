import { useCallback } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import type { SearchHit, SearchTab } from '@/lib/types';
import {
  searchQueryAtom,
  searchTabAtom,
  searchHasQueryAtom,
  searchPageAtom,
  searchCommittedAtom,
} from '@/atoms/search';
import { registerSearchInput, searchInputRef } from '@/boot/SearchBoot';

// 每页条数（与后端 limit 一致，一次请求拿一页）
const PAGE_SIZE = 20;

export interface SearchContextValue {
  query: string;
  setQuery: (q: string) => void;
  /** 当前 Tab（歌曲各字段 + 用户） */
  tab: SearchTab;
  /** 切换 Tab：立即按当前关键词重新搜索并回到第 1 页 */
  setTab: (t: SearchTab) => void;
  /** 立即触发搜索（按钮/回车用，跳过 debounce） */
  submit: () => void;
  hits: SearchHit[];
  loading: boolean;
  error: string | null;
  /** 是否处于搜索激活态（已发起搜索且 query 非空）— 控制布局切换 */
  hasQuery: boolean;
  /** 当前页码（1-based） */
  page: number;
  /** 切换页码（立即请求，无 debounce） */
  setPage: (p: number) => void;
  /** 每页条数 */
  pageSize: number;
  /** 命中总数（来自后端 totalHits） */
  totalHits: number;
  /** 各 Tab 的命中数（用于 Tab 徽章） */
  counts: Partial<Record<SearchTab, number>> | undefined;
  /** 用户匹配数是否已达统计上限（渲染 N+） */
  userMore: boolean;
  /** 共享 input ref — SearchBar 注册 input 元素，boot 在搜索退出后恢复焦点 */
  inputRef: { current: HTMLInputElement | null };
  /** 注册/注销 input 元素 */
  registerInput: (el: HTMLInputElement | null) => void;
}

/**
 * 搜索状态（jotai atoms，全局可用，无需 Provider）。
 * debounce/导航/焦点恢复等全局副作用在 boot/SearchBoot（Layout 挂一次）。
 * 请求层由 TanStack Query 接管：按 {q, tab, page} 缓存去重（多消费方共享
 * 同一 queryKey 的查询状态），翻页期间保留上一页数据，竞态由 queryKey 隔离。
 */
export function useSearchContext(): SearchContextValue {
  const [query, setQuery] = useAtom(searchQueryAtom);
  const [tab, setTabState] = useAtom(searchTabAtom);
  const hasQuery = useAtomValue(searchHasQueryAtom);
  const [page, setPageState] = useAtom(searchPageAtom);
  const committed = useAtomValue(searchCommittedAtom);
  const [, setHasQuery] = useAtom(searchHasQueryAtom);
  const [, setCommitted] = useAtom(searchCommittedAtom);
  const navigate = useNavigate();
  const location = useLocation();

  // 用户 Tab 走 Casdoor 用户搜索，不请求歌词索引
  const isUserTab = committed?.tab === 'user';

  const searchQuery = useQuery({
    queryKey: queryKeys.search(committed?.q ?? '', committed?.tab ?? 'all', committed?.page ?? 1),
    queryFn: () => {
      const c = committed!;
      return api.search({
        q: c.q,
        field: c.tab === 'user' ? 'all' : c.tab,
        limit: PAGE_SIZE,
        offset: (c.page - 1) * PAGE_SIZE,
      });
    },
    enabled: !!committed?.q && !isUserTab,
    placeholderData: keepPreviousData,
  });

  // Tab 徽章：按关键词缓存，切换 Tab 不重新请求
  const countsQuery = useQuery({
    queryKey: queryKeys.searchCounts(committed?.q ?? ''),
    queryFn: () => api.searchCounts(committed!.q),
    enabled: !!committed?.q,
    staleTime: 60_000,
  });

  // 立即触发（按钮/回车用）：跳过 debounce，回到第 1 页。
  // 滚动用瞬时模式，避免与 layoutId morph 动画竞争（见 SearchBoot 注释）
  const submit = useCallback(() => {
    const trimmed = query.trim();
    // 非首页先回首页展示结果
    if (location.pathname !== '/') navigate('/');
    setPageState(1);
    window.scrollTo(0, 0);
    if (!trimmed) {
      setHasQuery(false);
      setCommitted(null);
      return;
    }
    setHasQuery(true);
    setCommitted({ q: trimmed, tab, page: 1 });
  }, [query, tab, location.pathname, navigate, setPageState, setHasQuery, setCommitted]);

  // 切换 Tab：立即按新字段重查（不等 debounce），回到第 1 页
  const setTab = useCallback(
    (t: SearchTab) => {
      setTabState(t);
      if (!committed) return;
      setPageState(1);
      setCommitted({ ...committed, tab: t, page: 1 });
    },
    [committed, setTabState, setPageState, setCommitted]
  );

  // 切换页码：请求目标页数据
  const setPage = useCallback(
    (p: number) => {
      setPageState(p);
      if (!committed) return;
      setCommitted({ ...committed, page: p });
    },
    [committed, setPageState, setCommitted]
  );

  return {
    query,
    setQuery,
    tab,
    setTab,
    submit,
    hasQuery,
    page,
    setPage,
    pageSize: PAGE_SIZE,
    hits: searchQuery.data?.hits ?? [],
    totalHits: searchQuery.data?.totalHits ?? 0,
    loading: searchQuery.isFetching,
    counts: countsQuery.data?.totals,
    userMore: countsQuery.data?.userMore ?? false,
    error:
      searchQuery.error instanceof Error
        ? searchQuery.error.message
        : searchQuery.isError
          ? '搜索失败'
          : null,
    inputRef: searchInputRef,
    registerInput: registerSearchInput,
  };
}
