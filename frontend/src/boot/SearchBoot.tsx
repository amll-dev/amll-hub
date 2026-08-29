import { useEffect, useRef } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  searchQueryAtom,
  searchFieldAtom,
  searchHasQueryAtom,
  searchPageAtom,
  searchCommittedAtom,
} from '@/atoms/search';

// debounce 延迟（毫秒）
const DEBOUNCE_MS = 300;

/** 共享 input ref — SearchBar 注册 input 元素，搜索退出后恢复焦点 */
export const searchInputRef: { current: HTMLInputElement | null } = { current: null };

/** 注册/注销 input 元素（供 SearchBar 的 ref 回调使用） */
export function registerSearchInput(el: HTMLInputElement | null) {
  searchInputRef.current = el;
}

/**
 * 搜索引导（替代原 SearchProvider 的全局副作用宿主）。
 * debounce 提交、非首页输入时导航回首页、退出搜索恢复焦点。
 * 这些 effect 必须全局只跑一份，因此独立成 Boot 组件挂在 Layout 顶层。
 * 渲染 null。
 */
export function SearchBoot() {
  const query = useAtomValue(searchQueryAtom);
  const field = useAtomValue(searchFieldAtom);
  const hasQuery = useAtomValue(searchHasQueryAtom);
  const [, setHasQuery] = useAtom(searchHasQueryAtom);
  const [, setPage] = useAtom(searchPageAtom);
  const [, setCommitted] = useAtom(searchCommittedAtom);
  const navigate = useNavigate();
  const location = useLocation();

  const hasQueryRef = useRef(false);

  // query/field 变化重置到第 1 页；debounce 后提交搜索
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      // 退出搜索模式时（首页）：morph 回 Hero 前先瞬时回顶。
      // layoutId morph 按页面坐标测量，滚动位置 ≠ 0 时旧快照与新测量的
      // 滚动差会被误判为位移（搜索框飞出屏幕）。非首页无 morph 配对，不处理
      if (hasQueryRef.current && window.location.pathname === '/') {
        window.scrollTo(0, 0);
      }
      hasQueryRef.current = false;
      setHasQuery(false);
      setPage(1);
      setCommitted(null);
      return;
    }
    setPage(1);
    const timer = setTimeout(() => {
      // 新搜索滚回顶部。必须用瞬时滚动：smooth 滚动与 searchbar 的
      // layoutId morph 动画并发时，滚动事件会触发 framer-motion 重新投影，
      // 打断进行中的 layout 动画直接吸附终点（表现为搜索框瞬移）
      window.scrollTo(0, 0);
      hasQueryRef.current = true;
      setHasQuery(true);
      setCommitted({ q: trimmed, field, page: 1 });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, field, setHasQuery, setPage, setCommitted]);

  // 监听 query 变化：在非首页输入搜索词时，导航回首页展示结果
  const prevQuery = useRef('');
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed && trimmed !== prevQuery.current && location.pathname !== '/') {
      navigate('/');
    }
    prevQuery.current = trimmed;
  }, [query, location.pathname, navigate]);

  // 监听 hasQuery 变化：退出搜索时恢复焦点
  const wasSearching = useRef(false);
  useEffect(() => {
    if (hasQuery) {
      wasSearching.current = true;
    } else if (wasSearching.current) {
      wasSearching.current = false;
      // 用 requestAnimationFrame 轮询等待 input 可用
      let attempts = 0;
      const tryFocus = () => {
        if (searchInputRef.current) {
          searchInputRef.current.focus();
          const len = searchInputRef.current.value.length;
          searchInputRef.current.setSelectionRange(len, len);
        } else if (attempts < 30) {
          // 最多尝试 30 帧（约 500ms）
          attempts++;
          requestAnimationFrame(tryFocus);
        }
      };
      // 等待 Home exit 完成 + Hero SearchBar 挂载
      setTimeout(tryFocus, 450);
    }
  }, [hasQuery]);

  return null;
}
