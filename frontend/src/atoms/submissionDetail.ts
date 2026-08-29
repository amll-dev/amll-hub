import { atom, getDefaultStore } from 'jotai';

// ===== 投稿详情页状态 atoms（替代 SubmissionDetailPage 的 useState） =====

/** 详情页标签页 */
export type DetailTab = 'info' | 'song' | 'file';

/** 文件标签页视图模式 */
type FileView = 'effect' | 'raw';

/** 当前标签页 */
export const detailTabAtom = atom<DetailTab>('info');
/** 文件标签页视图模式（效果 / 原文件） */
export const fileViewAtom = atom<FileView>('effect');
/** 更新歌词区域开关 */
export const showUpdateLyricAtom = atom(false);
/** 上传音频区域开关 */
export const showUploadAudioAtom = atom(false);

/** 复位投稿详情页状态（页面卸载时调用，保持与原 useState 卸载即重置一致的语义） */
export function resetSubmissionDetailState() {
  const store = getDefaultStore();
  store.set(detailTabAtom, 'info');
  store.set(fileViewAtom, 'effect');
  store.set(showUpdateLyricAtom, false);
  store.set(showUploadAudioAtom, false);
}
