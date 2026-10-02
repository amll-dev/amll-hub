import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, Loader2, ShieldCheck, User, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { buttonTap, fadeUp, staggerContainer } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PageContainer } from '@/components/PageContainer';
import { useProfileIntro } from './intro';
import { ProfileIntroProvider } from './ProfileIntroProvider';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** 精确匹配（首页 index 路由） */
  end?: boolean;
}

const navItems: NavItem[] = [
  { to: '/profile', label: '首页', icon: Home, end: true },
  { to: '/profile/info', label: '我的信息', icon: User },
  { to: '/profile/security', label: '账号安全', icon: ShieldCheck },
];

/** 个人中心布局 */
export function ProfileLayout() {
  const { user, openLogin } = useAuth();
  // 入场动画整个会话只播一次，切换子页面时标题不再重播
  const playIntro = useProfileIntro();

  if (!user) {
    return (
      <PageContainer className="py-32 text-center">
        <h1 className="text-2xl font-bold tracking-tight">请先登录</h1>
        <p className="mt-3 text-ink-2">登录后可查看和管理个人中心</p>
        <Button {...buttonTap} onClick={() => openLogin()} className="mt-8">
          去登录
        </Button>
      </PageContainer>
    );
  }

  return (
    <ProfileIntroProvider value={playIntro}>
      <motion.div
        variants={staggerContainer}
        initial={playIntro ? 'hidden' : false}
        animate="show"
        className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-10"
      >
        <motion.h1
          variants={fadeUp}
          className="mb-6 text-2xl font-bold tracking-tight text-foreground"
        >
          个人中心
        </motion.h1>

        <div className="grid gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
          {/* 左侧导航：移动端横向滚动，桌面端竖排 */}
          <nav className="lg:sticky lg:top-24 lg:self-start">
            <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
              {navItems.map((item) => (
                <li key={item.to} className="shrink-0 lg:shrink">
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'text-ink-2 hover:bg-surface-2 hover:text-primary'
                      )
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          {/* 右侧内容（顶部用户卡片只在首页展示，由 ProfileHome 自己渲染） */}
          <div className="min-w-0">
            <Suspense
              fallback={
                <div className="flex items-center justify-center rounded-lg border border-line bg-card py-16 text-sm text-ink-3">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  加载中…
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </div>
        </div>
      </motion.div>
    </ProfileIntroProvider>
  );
}
