import { atom } from 'jotai';
import type { OnlinePlatform } from '@/lib/types';

// ===== 在线搜索 atoms（全局唯一，替代原 OnlineSearchProvider 内的 useState） =====

/** 输入框当前值（未提交） */
export const onlineInputValueAtom = atom('');
/** 已提交的搜索词 */
export const onlineQueryAtom = atom('');
/** 搜索平台 */
export const onlinePlatformAtom = atom<OnlinePlatform>('ncm');
/** 已提交的搜索（doSearch 时更新），驱动搜索 Query */
export const onlineCommittedAtom = atom<{ q: string; platform: OnlinePlatform } | null>(null);
