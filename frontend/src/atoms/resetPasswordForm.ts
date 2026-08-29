import { atom, getDefaultStore } from 'jotai';

// ===== 重置密码页状态 atoms（替代 ResetPassword 页的 useState） =====

/** 重置流程步骤：1 确认账号 → 2 重置密码 → 3 成功 */
export type ResetStep = 1 | 2 | 3;

export const resetStepAtom = atom<ResetStep>(1);
/** 手机号或邮箱 */
export const resetDestAtom = atom('');
/** 页面级错误信息 */
export const resetErrorAtom = atom('');
/** 人机验证弹窗是否打开 */
export const resetCaptchaOpenAtom = atom(false);

/** 复位重置密码页状态（页面卸载时调用，保持与原 useState 卸载即重置一致的语义） */
export function resetResetPasswordForm() {
  const store = getDefaultStore();
  store.set(resetStepAtom, 1);
  store.set(resetDestAtom, '');
  store.set(resetErrorAtom, '');
  store.set(resetCaptchaOpenAtom, false);
}
