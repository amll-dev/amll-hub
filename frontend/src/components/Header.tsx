import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { SearchBar } from './SearchBar';
import { UserMenu } from './UserMenu';
import { useAuth } from '@/hooks/useAuth';
import { useSearchContext } from '@/hooks/useSearchContext';
import { buttonTap } from '@/lib/motion';

const baseNavItems = [
  { to: '/ncm', label: '音乐解析', requireLogin: true },
  { to: '/lyrics-search', label: '歌词搜索', requireLogin: false },
  { to: '/ranking', label: '排行榜', requireLogin: false },
  { to: '/daily', label: '每日推荐', requireLogin: false },
  { to: '/creator', label: '创作中心', requireLogin: true },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { scrollY } = useScroll();
  const { query, field, loading, setQuery, setField, submit, hasQuery } = useSearchContext();
  const { user, openLogin } = useAuth();
  const navItems = user?.isReviewer
    ? [...baseNavItems, { to: '/review', label: '审核中心', requireLogin: true }]
    : baseNavItems;

  useMotionValueEvent(scrollY, 'change', (latest) => {
    setScrolled(latest > 8);
  });

  // 浏览器返回/前进不经过任何 onClick：在 popstate 里同步回顶
  useEffect(() => {
    const onPop = () => window.scrollTo(0, 0);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const [headerHighZ, setHeaderHighZ] = useState(!hasQuery);
  useEffect(() => {
    if (hasQuery) {
      setHeaderHighZ(false);
      return;
    }
    const t = setTimeout(() => setHeaderHighZ(true), 500);
    return () => clearTimeout(t);
  }, [hasQuery]);

  return (
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      className={`sticky top-0 backdrop-blur-xl transition-shadow duration-300 ${
        headerHighZ ? 'z-[110]' : 'z-50'
      }`}
      style={{
        backgroundColor: scrolled ? 'rgba(251, 251, 253, 0.85)' : 'rgba(251, 251, 253, 0.7)',
        boxShadow: scrolled ? '0 1px 0 0 var(--amll-line)' : 'none',
      }}
    >
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
        <div className="flex shrink-0 items-center gap-3">
          <Link
            to="/"
            onClick={() => {
              window.scrollTo(0, 0);
              setQuery('');
            }}
            className="relative flex items-center gap-2"
          >
            <img
              src="/logo.png"
              alt="AMLLHub"
              className="h-8 w-8 shrink-0 rounded-md object-contain"
            />
            <span className="text-lg font-bold tracking-tight">AMLLHub</span>
            <span className="absolute inset-x-0 top-full mt-0.5 whitespace-nowrap text-center text-[9px] leading-none text-ink-3">
              测试版本，不代表最终品质
            </span>
          </Link>

          {/* 搜索框槽位 */}
          <AnimatePresence mode="popLayout">
            {hasQuery && (
              <motion.div
                key="searchbar"
                layoutId="searchbar"
                className="relative z-[100] min-w-0"
                style={{ width: 460, maxWidth: '100%' }}
                transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
              >
                <SearchBar
                  query={query}
                  field={field}
                  loading={loading}
                  onQueryChange={setQuery}
                  onFieldChange={setField}
                  onSubmit={submit}
                  compact
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 导航 */}
        <motion.nav
          layout={!scrolled}
          layoutDependency={hasQuery}
          transition={{ layout: { duration: 0.45, ease: [0.2, 0.8, 0.2, 1] } }}
          className="hidden items-center gap-8 md:flex"
        >
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={(e) => {
                if (item.requireLogin && !user) {
                  e.preventDefault();
                  openLogin(item.to);
                  return;
                }
                window.scrollTo(0, 0);
              }}
              className="block"
            >
              {({ isActive }) => (
                <div className="relative py-2">
                  <span
                    className={`text-sm font-medium transition-colors hover:text-primary ${
                      isActive ? 'text-primary' : 'text-ink-2'
                    }`}
                  >
                    {item.label}
                  </span>
                  {isActive && (
                    <motion.span
                      layoutId="nav-indicator"
                      className="absolute inset-x-0 -bottom-0.5 h-0.5 rounded-full bg-primary"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{
                        layout: { type: 'spring', stiffness: 380, damping: 30 },
                        opacity: { duration: 0.2 },
                      }}
                    />
                  )}
                </div>
              )}
            </NavLink>
          ))}
        </motion.nav>

        <motion.div
          layout={!scrolled}
          layoutDependency={hasQuery}
          transition={{ layout: { duration: 0.45, ease: [0.2, 0.8, 0.2, 1] } }}
          className="flex shrink-0 items-center gap-3"
        >
          {user ? (
            <UserMenu />
          ) : (
            <motion.button
              type="button"
              onClick={() => openLogin()}
              {...buttonTap}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              登录
            </motion.button>
          )}

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 md:hidden"
            aria-label="菜单"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </motion.div>
      </div>

      {menuOpen && (
        <motion.nav
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
          className="overflow-hidden border-t border-line md:hidden"
        >
          <div className="flex flex-col gap-1 px-6 py-3">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={(e) => {
                  setMenuOpen(false);
                  if (item.requireLogin && !user) {
                    e.preventDefault();
                    openLogin(item.to);
                    return;
                  }
                  window.scrollTo(0, 0);
                }}
                className="rounded-md px-3 py-2 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-primary"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </motion.nav>
      )}
    </motion.header>
  );
}
