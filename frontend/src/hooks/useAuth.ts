import { createContext, useContext } from 'react';
import type { UserProfile } from '@/lib/auth';

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

/** 登录态 Context 实例（Provider 在 context/AuthContext.tsx） */
export const AuthContext = createContext<AuthContextValue | null>(null);

/** 读取登录态 Context，必须在 AuthProvider 内使用 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
