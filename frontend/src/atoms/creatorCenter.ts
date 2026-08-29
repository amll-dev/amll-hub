import { atom, getDefaultStore } from 'jotai';

// ===== 创作中心页状态 atoms（替代 CreatorCenter 页的 useState） =====

/** 页面主视图：首页 / 内容管理 / 投稿 */
export type View = 'home' | 'content' | 'submit';

/** 投稿 Tab：歌词 / 每日推荐 / 搜索IP */
export type SubmitTab = 'lyrics' | 'daily' | 'search-ip';

/** 内容管理主 Tab：歌词 / 每日推荐 / 搜索IP */
export type ContentMainTab = 'lyrics' | 'daily' | 'search-ip';

/** 当前页面视图 */
export const viewAtom = atom<View>('home');
/** 当前投稿 Tab */
export const submitTabAtom = atom<SubmitTab>('lyrics');
/** 内容管理主 Tab（投稿成功后跳转内容管理时作为初始 tab） */
export const contentTabAtom = atom<ContentMainTab>('lyrics');

/** 复位创作中心页状态（页面卸载时调用，保持与原 useState 卸载即重置一致的语义） */
export function resetCreatorCenter() {
  const store = getDefaultStore();
  store.set(viewAtom, 'home');
  store.set(submitTabAtom, 'lyrics');
  store.set(contentTabAtom, 'lyrics');
}
