import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/button';

/** 路由要求的最低权限 */
export type RouteRequirement = 'auth' | 'reviewer' | 'admin';

/**
 * 统一的路由守卫。
 *
 * 之前 /review、/creator、/plugins/admin 都是直接渲染，权限判断散落在各页面内部：
 * 漏写一处就是白屏 / 空列表，而不是「跳登录」。这里在路由层收口一次：
 * - 未登录：自动弹登录框（带上当前路径，登录后原路返回），不渲染页面内容
 * - 已登录但权限不足：渲染无权限占位，不进入页面（避免页面内请求 401/403 刷屏）
 */
export function RouteGuard({
  require,
  children,
}: {
  require: RouteRequirement;
  children: ReactNode;
}) {
  const { user, loading, openLogin } = useAuth();
  const location = useLocation();
  const redirectTo = `${location.pathname}${location.search}`;
  // 只要成功挂载过一次页面，后续登录态刷新就绝不再卸载 children。
  // 歌词编辑器的卸载清理会 forceStop() 并 suspend AudioContext，还会重发
  // worklet 的 INIT；一次 token 刷新就把正在播放的音频链路打断。
  const everMountedRef = useRef(false);

  // 登录态还在校验时先别弹窗，否则首屏刷新会闪一下登录框
  useEffect(() => {
    if (!loading && user) everMountedRef.current = true;
    if (loading || user) return;
    openLogin(redirectTo);
  }, [loading, user, openLogin, redirectTo]);

  if (loading) {
    if (everMountedRef.current) return <>{children}</>;
    return <ListSkeleton rows={4} />;
  }

  if (!user) {
    // 登录框由上面的 effect 打开，这里只占位，避免页面内容（与它的请求）先跑起来
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-card px-4 py-12 text-center">
        <ShieldCheck className="h-10 w-10 text-ink-3" />
        <p className="mt-3 text-sm text-ink-2">请先登录</p>
        <Button className="mt-4" onClick={() => openLogin(redirectTo)}>
          登录
        </Button>
      </div>
    );
  }

  const allowed =
    require === 'auth' ||
    (require === 'reviewer' ? Boolean(user.isReviewer || user.isAdmin) : Boolean(user.isAdmin));

  if (!allowed) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title={require === 'admin' ? '需要超级管理员权限' : '需要审核员权限'}
        description="如果认为这是误判，请联系管理员开通权限"
        action={
          <Button asChild variant="outline">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
              返回首页
            </Link>
          </Button>
        }
      />
    );
  }

  return <>{children}</>;
}
