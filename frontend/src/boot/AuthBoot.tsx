import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDefaultStore } from 'jotai';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { getToken, setStoredUser, clearAuth } from '@/lib/auth';
import { userAtom, handleUnauthorized } from '@/atoms/auth';

const store = getDefaultStore();

/**
 * 登录态引导（替代原 AuthProvider 的全局副作用宿主）。
 * 只做三件事：profile 校验 Query、结果/错误同步进 atom、401 事件监听。
 * 渲染 null，挂在 Layout 顶层一次即可。
 */
export function AuthBoot() {
  const profileQuery = useQuery({
    queryKey: queryKeys.profile,
    queryFn: () => api.getProfile(),
    enabled: !!getToken(),
    staleTime: 5 * 60_000,
    // 登录校验失败即定局（token 无效），网络抖动也不自动重试，避免 loading 抖动
    retry: false,
  });

  // 校验成功：持久化并写入 atom（jotai 对同引用赋值不会触发订阅者重渲染）
  useEffect(() => {
    if (profileQuery.data) {
      setStoredUser(profileQuery.data);
      store.set(userAtom, profileQuery.data);
    }
  }, [profileQuery.data]);

  // 校验失败：token 无效，清登录态（带 token 的 401 已由 api 层派发事件弹登录窗）
  useEffect(() => {
    if (profileQuery.isError) {
      clearAuth();
      store.set(userAtom, null);
    }
  }, [profileQuery.isError]);

  // 监听 401 事件（api.ts 派发）：清登录态并弹窗
  useEffect(() => {
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  return null;
}

/** 初始化校验 token 中（仅初始化期间为 true；查询与 AuthBoot 共享同一 queryKey 状态） */
export function useAuthLoading(): boolean {
  const { isPending, fetchStatus } = useQuery({
    queryKey: queryKeys.profile,
    queryFn: () => api.getProfile(),
    enabled: false,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return !!getToken() && isPending && fetchStatus === 'fetching';
}
