import { useAtomValue } from 'jotai';
import type { UserProfile } from '@/lib/auth';
import {
  userAtom,
  loginOpenAtom,
  loginRedirectAtom,
  login,
  logout,
  openLogin,
  closeLogin,
  clearLoginRedirect,
  refreshUser,
} from '@/atoms/auth';
import { useAuthLoading } from '@/boot/AuthBoot';

export interface AuthContextValue {
  user: UserProfile | null;
  /** 初始化校验 token 中 */
  loading: boolean;
  /** 登录弹窗是否打开 */
  loginOpen: boolean;
  /** 登录成功后要跳转的路径（点击需登录功能时带入，登录完成后自动前往） */
  loginRedirect: string | null;
  login: (token: string, user: UserProfile) => void;
  logout: () => void;
  /** 打开登录弹窗，可携带登录成功后的跳转目标 */
  openLogin: (redirectTo?: string) => void;
  closeLogin: () => void;
  /** 清除登录后的跳转目标 */
  clearLoginRedirect: () => void;
  /** 拉取最新资料并更新 state（资料页保存后用） */
  refreshUser: () => Promise<void>;
}

/** 读取登录态（jotai atoms，全局可用，无需 Provider） */
export function useAuth(): AuthContextValue {
  return {
    user: useAtomValue(userAtom),
    loading: useAuthLoading(),
    loginOpen: useAtomValue(loginOpenAtom),
    loginRedirect: useAtomValue(loginRedirectAtom),
    login,
    logout,
    openLogin,
    closeLogin,
    clearLoginRedirect,
    refreshUser,
  };
}
