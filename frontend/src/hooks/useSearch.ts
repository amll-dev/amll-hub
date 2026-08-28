import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { SearchField, SearchHit } from '@/lib/types';

interface State {
  hits: SearchHit[];
  loading: boolean;
  error: string | null;
  totalHits: number;
}

// debounce 延迟（毫秒）
const DEBOUNCE_MS = 300;
// 每页条数（与后端 limit 一致，一次请求拿一页）
const PAGE_SIZE = 20;

/**
 * 搜索 hook：输入即触发（debounce 300ms），同时支持按钮/回车立即触发。
 * hasQuery 基于"是否已进入搜索模式"，而非 query 是否为空 ——
 * 这样输入过程中页面不会频繁切换，只在首次真正发起搜索后才切换。
 *
 * 分页：服务端分页，每次翻页请求对应 offset 的一页数据。
 * totalHits 来自后端，用于分页页数计算。
 */
export function useSearch() {
  const [query, setQuery] = useState('');
  const [field, setField] = useState<SearchField>('all');
  // 是否已进入搜索模式（控制页面切换）
  const [hasQuery, setHasQuery] = useState(false);
  const [page, setPageState] = useState(1);
  const [state, setState] = useState<State>({
    hits: [],
    loading: false,
    error: null,
    totalHits: 0,
  });

  // 请求序号：仅最新一次请求的结果允许写入 state，防止慢的旧响应覆盖新结果
  const reqSeq = useRef(0);

  // 实际执行搜索（请求指定页的数据）
  const executeSearch = useCallback((q: string, f: SearchField, p: number) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setHasQuery(false);
      setState({ hits: [], loading: false, error: null, totalHits: 0 });
      return;
    }
    setHasQuery(true);
    setState((s) => ({ ...s, loading: true, error: null }));
    const seq = ++reqSeq.current;
    api
      .search({
        q: trimmed,
        field: f,
        limit: PAGE_SIZE,
        offset: (p - 1) * PAGE_SIZE,
      })
      .then((res) => {
        if (seq !== reqSeq.current) return;
        setState({
          hits: res.hits,
          loading: false,
          error: null,
          totalHits: res.totalHits,
        });
      })
      .catch((err: unknown) => {
        if (seq !== reqSeq.current) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : '搜索失败',
        }));
      });
  }, []);

  // debounce 输入触发：query/field 变化重置到第 1 页
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      // 退出搜索模式时（首页）：morph 回 Hero 前先瞬时回顶。
      // layoutId morph 按页面坐标测量，滚动位置 ≠ 0 时旧快照与新测量的
      // 滚动差会被误判为位移（搜索框飞出屏幕）。非首页无 morph 配对，不处理
      if (hasQuery && window.location.pathname === '/') {
        window.scrollTo(0, 0);
      }
      setHasQuery(false);
      setState({ hits: [], loading: false, error: null, totalHits: 0 });
      return;
    }
    // query/field 变化 → 回到第 1 页
    setPageState(1);
    const timer = setTimeout(() => {
      // 新搜索滚回顶部。必须用瞬时滚动：smooth 滚动与 searchbar 的
      // layoutId morph 动画并发时，滚动事件会触发 framer-motion 重新投影，
      // 打断进行中的 layout 动画直接吸附终点（表现为搜索框瞬移）
      window.scrollTo(0, 0);
      executeSearch(trimmed, field, 1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, field, executeSearch]);

  // 立即触发（按钮/回车用）：跳过 debounce，回到第 1 页。
  // 滚动用瞬时模式，避免与 layoutId morph 动画竞争（同上）
  const submit = useCallback(() => {
    setPageState(1);
    window.scrollTo(0, 0);
    executeSearch(query, field, 1);
  }, [query, field, executeSearch]);

  // 切换页码：请求目标页数据，并滚到结果顶部
  const setPage = useCallback(
    (p: number) => {
      setPageState(p);
      executeSearch(query, field, p);
    },
    [query, field, executeSearch]
  );

  return {
    query,
    setQuery,
    field,
    setField,
    submit,
    hasQuery,
    page,
    setPage,
    pageSize: PAGE_SIZE,
    hits: state.hits,
    totalHits: state.totalHits,
    loading: state.loading,
    error: state.error,
  };
}
