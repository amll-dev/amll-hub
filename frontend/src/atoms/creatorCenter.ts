import { atom, getDefaultStore } from 'jotai';

// 创作中心页状态 atoms

/** 页面主视图 */
export type View = 'home' | 'content' | 'submit' | 'requests' | 'request-edit' | 'plugins';

/** 投稿 Tab */
export type SubmitTab = 'lyrics' | 'daily' | 'search-ip' | 'requests' | 'plugins';

/** 内容管理主 Tab */
export type ContentMainTab = 'lyrics' | 'daily' | 'search-ip' | 'requests';

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
