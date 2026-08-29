import { atom } from 'jotai';

// ===== 登录弹窗状态 atoms（替代 AuthDialog 的 useState；弹窗常驻 Layout，
// 关闭时由组件内 resetForm 复位，无需卸载重置） =====

/** 登录方式 tab */
export type LoginTab = 'password' | 'code';

export const loginTabAtom = atom<LoginTab>('password');
/** 「忘记密码」小弹窗是否打开 */
export const forgotOpenAtom = atom(false);
/** 验证码登录类型：phone / email */
export const loginCodeTypeAtom = atom<'phone' | 'email'>('phone');
/** 弹窗级错误信息 */
export const loginErrorAtom = atom('');
/** 人机验证弹窗是否打开 */
export const loginCaptchaOpenAtom = atom(false);
