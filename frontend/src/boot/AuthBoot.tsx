import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDefaultStore } from 'jotai';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { getToken, setStoredUser, clearAuth } from '@/lib/auth';
import { userAtom, handleAuthRequired, handleUnauthorized } from '@/atoms/auth';

const store = getDefaultStore();

/** 登录态引导 */
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

  // 校验失败
  useEffect(() => {
    if (!profileQuery.isError) return;
    const status = profileQuery.error instanceof ApiError ? profileQuery.error.code : undefined;
    if (status === 401) {
      clearAuth();
      store.set(userAtom, null);
    }
  }, [profileQuery.isError, profileQuery.error]);

  // 监听 401 事件（api.ts 派发）：清登录态并弹窗
  useEffect(() => {
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  // 未登录访问需鉴权接口
  useEffect(() => {
    const onAuthRequired = (e: Event) => {
      const notice = (e as CustomEvent<{ notice?: string }>).detail?.notice;
      handleAuthRequired(notice);
    };
    window.addEventListener('auth:required', onAuthRequired);
    return () => window.removeEventListener('auth:required', onAuthRequired);
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
