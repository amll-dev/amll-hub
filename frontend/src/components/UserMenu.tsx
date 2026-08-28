import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { LayoutDashboard, LogOut, Shield, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export function UserMenu() {
  const { user, logout } = useAuth();
  // hovered: 鼠标悬停临时展开；pinned: 点击固定展开
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // hover 关闭的延迟句柄：鼠标移向菜单途中经过间隙时不闪烁
  const closeTimer = useRef<number | null>(null);

  const close = () => setPinned(false);

  const scheduleClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setHovered(false), 150);
  };
  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  useEffect(() => cancelClose, []);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPinned(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!user) return null;

  const initial = (user.displayName || user.name || '?').charAt(0).toUpperCase();

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => {
        cancelClose();
        setHovered(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        onClick={() => setPinned((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground transition-transform hover:scale-105"
        aria-label="用户菜单"
        aria-expanded={open}
      >
        {user.avatar ? (
          <img
            src={user.avatar}
            alt={user.displayName || user.name}
            className="h-9 w-9 rounded-full object-cover"
          />
        ) : (
          initial
        )}
        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-background bg-success" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute right-0 top-11 w-52 overflow-hidden rounded-md border border-line bg-card shadow-lg"
          >
            {/* 用户信息 */}
            <div className="border-b border-line px-3 py-2.5">
              <p className="truncate text-sm font-medium text-foreground">
                {user.displayName || user.name}
              </p>
              {user.email && <p className="truncate text-xs text-ink-3">{user.email}</p>}
            </div>
            {/* 菜单项 */}
            <div className="py-1">
              {/* 点击先回顶再导航：searchbar 的 layoutId morph 按页面坐标测量 */}
              <Link
                to="/profile"
                onClick={() => {
                  window.scrollTo(0, 0);
                  close();
                }}
                className="flex items-center gap-2 px-3 py-2 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-primary"
              >
                <User className="h-4 w-4" />
                个人资料
              </Link>
              <Link
                to="/creator"
                onClick={() => {
                  window.scrollTo(0, 0);
                  close();
                }}
                className="flex items-center gap-2 px-3 py-2 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-primary"
              >
                <LayoutDashboard className="h-4 w-4" />
                创作中心
              </Link>
              {user.isReviewer && (
                <Link
                  to="/review"
                  onClick={() => {
                    window.scrollTo(0, 0);
                    close();
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-primary"
                >
                  <Shield className="h-4 w-4" />
                  审核中心
                </Link>
              )}
              {user.isAdmin && (
                <Link
                  to="/admin/reviewers"
                  onClick={() => {
                    window.scrollTo(0, 0);
                    close();
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-primary"
                >
                  <ShieldCheck className="h-4 w-4" />
                  审核员管理
                </Link>
              )}
              <button
                type="button"
                onClick={() => {
                  close();
                  logout();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-primary"
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
