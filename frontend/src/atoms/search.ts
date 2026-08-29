import { atom } from 'jotai';
import type { SearchField } from '@/lib/types';

/** 已提交的搜索请求（debounce 后 / 立即提交 / 翻页才更新），驱动 useQuery */
export interface CommittedSearch {
  q: string;
  field: SearchField;
  page: number;
}

// ===== 搜索 atoms（全局唯一，替代原 SearchProvider 内的 useState） =====

/** 输入框当前值（未提交） */
export const searchQueryAtom = atom('');
/** 搜索字段 */
export const searchFieldAtom = atom<SearchField>('all');
/** 是否已进入搜索模式（控制页面切换；基于"是否已发起过搜索"而非 query 非空） */
export const searchHasQueryAtom = atom(false);
/** 当前页码（1-based） */
export const searchPageAtom = atom(1);
/** 已提交的搜索 */
export const searchCommittedAtom = atom<CommittedSearch | null>(null);
