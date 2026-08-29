import { atom, getDefaultStore } from 'jotai';

// ===== 审核中心页面状态 atoms（替代 ReviewCenter 页的 useState） =====

/** 歌词审核列表状态筛选 */
export type ReviewTab =
  | 'all'
  | 'pending'
  | 'reviewing'
  | 'need_revision'
  | 'missing_audio'
  | 'approved'
  | 'rejected'
  | 'closed';

/** 搜索IP投稿列表状态筛选 */
export type SearchIpTab = 'all' | 'pending' | 'approved' | 'rejected';

/** 审核中心主视图 */
type View = 'home' | 'content' | 'search-ip';

/** 审核中心当前视图（首页 / 歌词审核 / IP显示投稿） */
export const reviewViewAtom = atom<View>('home');
/** 歌词审核列表的状态筛选 */
export const reviewTabAtom = atom<ReviewTab>('all');
/** 歌词审核列表的搜索关键词 */
export const reviewSearchAtom = atom('');
/** 搜索IP投稿列表的状态筛选 */
export const searchIpTabAtom = atom<SearchIpTab>('all');
/** 搜索IP投稿当前打开的详情 ID（null 表示停留在列表） */
export const searchIpDetailIdAtom = atom<number | null>(null);

/** 复位审核中心页面状态（页面卸载时调用，保持与原 useState 卸载即重置一致的语义） */
export function resetReviewCenterState() {
  const store = getDefaultStore();
  store.set(reviewViewAtom, 'home');
  store.set(reviewTabAtom, 'all');
  store.set(reviewSearchAtom, '');
  store.set(searchIpTabAtom, 'all');
  store.set(searchIpDetailIdAtom, null);
}
