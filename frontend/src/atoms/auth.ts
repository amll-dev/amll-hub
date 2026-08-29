import { atom, getDefaultStore } from 'jotai';
import { queryClient, queryKeys } from '@/lib/query';
import {
  clearAuth,
  clearStoredUser,
  clearToken,
  getStoredUser,
  setStoredUser,
  setToken,
  type UserProfile,
} from '@/lib/auth';

// ===== 登录态 atoms（全局唯一，替代原 AuthContext 的 useState） =====

/** 当前用户（初值取 localStorage 缓存，避免刷新时头像闪烁） */
export const userAtom = atom<UserProfile | null>(getStoredUser());
/** 登录弹窗是否打开 */
export const loginOpenAtom = atom(false);
/** 登录成功后要跳转的路径（点击需登录功能时带入，登录完成后自动前往） */
export const loginRedirectAtom = atom<string | null>(null);

const store = getDefaultStore();

// ===== 命令式动作（组件外可直接调用，供 boot 与 hook 共用） =====

export function login(token: string, u: UserProfile) {
  setToken(token);
  setStoredUser(u);
  store.set(userAtom, u);
  // 直接写入缓存，避免 enabled 翻转后重复请求 profile
  queryClient.setQueryData(queryKeys.profile, u);
}

export function logout() {
  clearAuth();
  store.set(userAtom, null);
  // 清掉 profile 缓存，防止下次登录读到旧用户
  queryClient.removeQueries({ queryKey: queryKeys.profile });
}

export function openLogin(redirectTo?: string) {
  if (redirectTo) store.set(loginRedirectAtom, redirectTo);
  store.set(loginOpenAtom, true);
}

export function closeLogin() {
  store.set(loginOpenAtom, false);
}

export function clearLoginRedirect() {
  store.set(loginRedirectAtom, null);
}

/** 拉取最新资料并更新 user（资料页保存后用；结果由 AuthBoot 的 Query 同步进 atom） */
export async function refreshUser() {
  await queryClient.refetchQueries({ queryKey: queryKeys.profile, exact: true });
}

/** 401 事件处理（api.ts 派发）：清登录态并弹登录窗 */
export function handleUnauthorized() {
  clearToken();
  clearStoredUser();
  store.set(userAtom, null);
  store.set(loginOpenAtom, true);
}
