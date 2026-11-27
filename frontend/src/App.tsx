import { Suspense, lazy, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { loginOpenAtom } from '@/atoms/auth';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { Player } from '@/components/Player';
import { AuthBoot } from '@/boot/AuthBoot';
import { SearchBoot } from '@/boot/SearchBoot';
import { ThemeBoot } from '@/boot/ThemeBoot';
import { NotificationBoot } from '@/boot/NotificationBoot';
import { NotificationDetailDialog } from '@/components/notification/NotificationDetailDialog';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { OfflineBanner } from '@/components/OfflineBanner';

/** 路由懒加载期间的全屏 loading */
function PageLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center py-20 text-sm text-ink-3">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      加载中…
    </div>
  );
}

// 包裹 Outlet 实现路由切换淡入动效
function AnimatedOutlet() {
  const location = useLocation();
  // 路由切换时立即回到顶部
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const outlet = (
    <Suspense fallback={<PageLoading />}>
      <Outlet />
    </Suspense>
  );

  if (location.pathname.startsWith('/profile') || location.pathname.startsWith('/docs'))
    return outlet;

  return (
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {outlet}
    </motion.div>
  );
}

/** 登录弹窗懒加载：首次打开时才拉取 chunk，加载后常驻（关闭复位逻辑不变） */
const AuthDialog = lazy(() =>
  import('@/components/AuthDialog').then((m) => ({ default: m.AuthDialog }))
);

function LazyAuthDialog() {
  const loginOpen = useAtomValue(loginOpenAtom);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loginOpen) setLoaded(true);
  }, [loginOpen]);
  if (!loaded) return null;
  return (
    <Suspense fallback={null}>
      <AuthDialog />
    </Suspense>
  );
}

/** 按路径生成文档标题（多标签页可区分；详情页用通用标题） */
function titleForPath(pathname: string): string {
  if (pathname === '/') return 'AMLL Hub';
  if (pathname.startsWith('/lyrics-search')) return '在线歌词搜索 · AMLL Hub';
  if (pathname.startsWith('/ranking')) return '排行榜 · AMLL Hub';
  if (pathname.startsWith('/daily')) return '每日推荐 · AMLL Hub';
  if (pathname.startsWith('/ncm')) return '歌单解析 · AMLL Hub';
  if (pathname.startsWith('/online-lyric')) return '在线歌词 · AMLL Hub';
  if (pathname.startsWith('/lyric/')) return '歌词详情 · AMLL Hub';
  if (pathname.startsWith('/docs')) return '文档 · AMLL Hub';
  if (pathname.startsWith('/plugins')) return '插件 · AMLL Hub';
  if (pathname.startsWith('/creator')) return '创作中心 · AMLL Hub';
  if (pathname.startsWith('/review')) return '审核中心 · AMLL Hub';
  if (pathname.startsWith('/profile')) return '个人中心 · AMLL Hub';
  if (pathname.startsWith('/user/')) return '用户主页 · AMLL Hub';
  if (pathname.startsWith('/messages')) return '消息 · AMLL Hub';
  if (pathname.startsWith('/bind-account')) return '绑定账号 · AMLL Hub';
  if (pathname.startsWith('/register')) return '注册 · AMLL Hub';
  if (pathname.startsWith('/reset-password')) return '重置密码 · AMLL Hub';
  if (pathname.startsWith('/terms')) return '服务条款 · AMLL Hub';
  if (pathname.startsWith('/privacy')) return '隐私政策 · AMLL Hub';
  if (pathname.startsWith('/stats')) return '统计 · AMLL Hub';
  return 'AMLL Hub';
}

function useDocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = titleForPath(pathname);
  }, [pathname]);
}

/** 全局布局：Provider 层 + Header/Footer + 播放器 UI + 登录弹窗 */
export function Layout() {
  const location = useLocation();
  useDocumentTitle();
  const useCustomHeader =
    location.pathname.startsWith('/creator') || location.pathname.startsWith('/review');
  return (
    <TooltipProvider delayDuration={300}>
      {/* 全局状态引导：atoms 副作用宿主（渲染 null，各挂一次） */}
      <AuthBoot />
      <SearchBoot />
      <ThemeBoot />
      <NotificationBoot />
      <OfflineBanner />
      <div className="flex min-h-screen flex-col">
        {!useCustomHeader && <Header />}
        {/* min-h 撑满首屏 */}
        <main className="min-h-[calc(100vh-4rem)] flex-1">
          <AnimatedOutlet />
        </main>
        {!useCustomHeader && <Footer />}
      </div>
      <Player />
      <LazyAuthDialog />
      <NotificationDetailDialog />
      <Toaster />
    </TooltipProvider>
  );
}
