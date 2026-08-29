import { atom, getDefaultStore } from 'jotai';

// ===== 注册页状态 atoms（替代 Register 页的 useState） =====

/** 待上传的头像文件 */
export const avatarFileAtom = atom<File | null>(null);
/** 头像预览 URL（objectURL） */
export const avatarPreviewAtom = atom('');
/** 页面级错误信息 */
export const registerErrorAtom = atom('');
/** 人机验证弹窗是否打开 */
export const registerCaptchaOpenAtom = atom(false);
/** 当前发送验证码的目标："phone" | "email" */
export const registerCaptchaTargetAtom = atom<'phone' | 'email'>('phone');

/** 复位注册页状态（页面卸载时调用，保持与原 useState 卸载即重置一致的语义） */
export function resetRegisterForm() {
  const store = getDefaultStore();
  const preview = store.get(avatarPreviewAtom);
  if (preview) URL.revokeObjectURL(preview);
  store.set(avatarFileAtom, null);
  store.set(avatarPreviewAtom, '');
  store.set(registerErrorAtom, '');
  store.set(registerCaptchaOpenAtom, false);
  store.set(registerCaptchaTargetAtom, 'phone');
}
