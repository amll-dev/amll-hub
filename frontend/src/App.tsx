import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { Player } from '@/components/Player';
import { AuthDialog } from '@/components/AuthDialog';
import { AuthProvider } from '@/context/AuthContext';
import { SearchProvider } from '@/context/SearchContext';
import { PlayerProvider } from '@/context/PlayerContext';
import { NcmParseProvider } from '@/context/NcmParseContext';
import { OnlineSearchProvider } from '@/context/OnlineSearchContext';

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
  return (
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <Suspense fallback={<PageLoading />}>
        <Outlet />
      </Suspense>
    </motion.div>
  );
}

/** 全局布局：Provider 层 + Header/Footer + 全局播放器 + 登录弹窗 */
export function Layout() {
  const location = useLocation();
  const useCustomHeader =
    location.pathname.startsWith('/creator') || location.pathname.startsWith('/review');
  return (
    <AuthProvider>
      <SearchProvider>
        <PlayerProvider>
          <NcmParseProvider>
            <OnlineSearchProvider>
              <div className="flex min-h-screen flex-col">
                {!useCustomHeader && <Header />}
                <main className="flex-1">
                  <AnimatedOutlet />
                </main>
                {!useCustomHeader && <Footer />}
              </div>
              <Player />
            </OnlineSearchProvider>
          </NcmParseProvider>
        </PlayerProvider>
      </SearchProvider>
      <AuthDialog />
    </AuthProvider>
  );
}
