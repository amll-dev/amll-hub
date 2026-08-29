import { atom, getDefaultStore } from 'jotai';

// ===== 个人资料页状态 atoms（替代 Profile 页的 useState） =====

/** 联系方式编辑目标："email" | "phone" | null（null 表示未在编辑） */
export type EditTarget = 'email' | 'phone' | null;

/** 操作反馈消息 */
export type FormMsg = { ok: boolean; text: string } | null;

/** 头像上传反馈消息 */
export const avatarMsgAtom = atom<FormMsg>(null);
/** 当前正在修改的联系方式（邮箱/手机号） */
export const editTargetAtom = atom<EditTarget>(null);
/** 新邮箱/手机号输入值 */
export const editValueAtom = atom('');
/** 验证码输入值 */
export const editCodeAtom = atom('');
/** 联系方式修改反馈消息 */
export const editMsgAtom = atom<FormMsg>(null);
/** 人机验证弹窗是否打开 */
export const captchaModalOpenAtom = atom(false);
/** 资料保存反馈消息 */
export const profileMsgAtom = atom<FormMsg>(null);
/** 密码修改反馈消息 */
export const pwdMsgAtom = atom<FormMsg>(null);

/** 复位个人资料页状态（页面卸载时调用，保持与原 useState 卸载即重置一致的语义） */
export function resetProfileForm() {
  const store = getDefaultStore();
  store.set(avatarMsgAtom, null);
  store.set(editTargetAtom, null);
  store.set(editValueAtom, '');
  store.set(editCodeAtom, '');
  store.set(editMsgAtom, null);
  store.set(captchaModalOpenAtom, false);
  store.set(profileMsgAtom, null);
  store.set(pwdMsgAtom, null);
}
