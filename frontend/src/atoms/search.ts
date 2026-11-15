import { atom } from 'jotai';
import type { SearchTab } from '@/lib/types';

/** 已提交的搜索请求（debounce 后 / 立即提交 / 翻页 / 切 Tab 才更新），驱动 useQuery */
export interface CommittedSearch {
  q: string;
  tab: SearchTab;
  page: number;
}

// ===== 搜索 atoms（全局唯一，替代原 SearchProvider 内的 useState） =====

/** 输入框当前值（未提交） */
export const searchQueryAtom = atom('');
/** 当前搜索 Tab（歌曲各字段 + 用户） */
export const searchTabAtom = atom<SearchTab>('all');
/** 当前页码（1-based） */
export const searchPageAtom = atom(1);
/** 已提交的搜索 */
export const searchCommittedAtom = atom<CommittedSearch | null>(null);
/**
 * 是否已进入搜索模式（控制页面切换；基于"是否已发起过搜索"而非 query 非空）。
 * 由 `searchCommittedAtom` 派生：两处手写同步只要漏一处，首页就会停在
 * 结果页但结果为空。
 */
export const searchHasQueryAtom = atom((get) => get(searchCommittedAtom) !== null);
