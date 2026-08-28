import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import {
  clearAuth,
  clearStoredUser,
  clearToken,
  getStoredUser,
  getToken,
  setStoredUser,
  setToken,
  type UserProfile,
} from '@/lib/auth';
import { AuthContext } from '@/hooks/useAuth';

export function AuthProvider({ children }: { children: ReactNode }) {
  // 用 localStorage 缓存的 user 做初值，避免刷新时头像闪烁
  const [user, setUser] = useState<UserProfile | null>(() => getStoredUser());
  const [loading, setLoading] = useState<boolean>(() => !!getToken());
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginRedirect, setLoginRedirect] = useState<string | null>(null);

  const login = useCallback((token: string, u: UserProfile) => {
    setToken(token);
    setStoredUser(u);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setUser(null);
  }, []);

  const openLogin = useCallback((redirectTo?: string) => {
    if (redirectTo) setLoginRedirect(redirectTo);
    setLoginOpen(true);
  }, []);
  const closeLogin = useCallback(() => setLoginOpen(false), []);
  const clearLoginRedirect = useCallback(() => setLoginRedirect(null), []);

  const refreshUser = useCallback(async () => {
    const profile = await api.getProfile();
    setStoredUser(profile);
    setUser(profile);
  }, []);

  // 初始化：若有 token，校验有效性并加载 user
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    api
      .getProfile()
      .then((profile) => {
        if (cancelled) return;
        setStoredUser(profile);
        setUser(profile);
      })
      .catch(() => {
        if (cancelled) return;
        // token 无效，清登录态
        clearAuth();
        setUser(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 监听 401 事件（api.ts 派发）：清登录态并弹窗
  useEffect(() => {
    const handler = () => {
      clearToken();
      clearStoredUser();
      setUser(null);
      setLoginOpen(true);
    };
    window.addEventListener('auth:unauthorized', handler);
    return () => window.removeEventListener('auth:unauthorized', handler);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        loginOpen,
        loginRedirect,
        login,
        logout,
        openLogin,
        closeLogin,
        clearLoginRedirect,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
