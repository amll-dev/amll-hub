import { createContext, useContext } from 'react';
import type { RefObject } from 'react';
import type { SearchField, SearchHit } from '@/lib/types';

export interface SearchContextValue {
  query: string;
  setQuery: (q: string) => void;
  field: SearchField;
  setField: (f: SearchField) => void;
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
  /** 共享 input ref — SearchBar 注册 input 元素，context 在搜索退出后恢复焦点 */
  inputRef: RefObject<HTMLInputElement | null>;
  /** 注册/注销 input 元素 */
  registerInput: (el: HTMLInputElement | null) => void;
}

/** 搜索状态 Context 实例（Provider 在 context/SearchContext.tsx） */
export const SearchContext = createContext<SearchContextValue | null>(null);

/** 读取搜索状态 Context，必须在 SearchProvider 内使用 */
export function useSearchContext() {
  const ctx = useContext(SearchContext);
  if (!ctx) {
    throw new Error('useSearchContext must be used within SearchProvider');
  }
  return ctx;
}
