import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LayoutDashboard, LogOut, Shield, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

/**
 * 用户头像下拉菜单（Radix DropdownMenu：悬停/点击展开、焦点管理、点击外部关闭）。
 * modal={false}：关闭默认的滚动锁定——modal 模式会隐藏滚动条，
 * 经典（非 overlay）滚动条消失时页面内容整体横移 ~15px。
 */
export function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(0);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // 悬停意图：指针进入触发器/菜单立即打开（并取消待执行的关闭）；
  // 离开后延迟 120ms 关闭——给"从头像移到菜单"的路径留缓冲
  const openNow = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const scheduleClose = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  if (!user) return null;

  const initial = (user.displayName || user.name || '?').charAt(0).toUpperCase();

  // 点击先回顶再导航：searchbar 的 layoutId morph 按页面坐标测量
  const nav = () => window.scrollTo(0, 0);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}
        className="relative flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label="用户菜单"
      >
        <Avatar className="h-9 w-9">
          {user.avatar && <AvatarImage src={user.avatar} alt={user.displayName || user.name} />}
          <AvatarFallback>{initial}</AvatarFallback>
        </Avatar>
        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-background bg-success" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}
        className="w-52 p-0"
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
          <DropdownMenuItem asChild>
            <Link to="/profile" onClick={nav} className="cursor-pointer">
              <User className="h-4 w-4" />
              个人资料
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/creator" onClick={nav} className="cursor-pointer">
              <LayoutDashboard className="h-4 w-4" />
              创作中心
            </Link>
          </DropdownMenuItem>
          {user.isReviewer && (
            <DropdownMenuItem asChild>
              <Link to="/review" onClick={nav} className="cursor-pointer">
                <Shield className="h-4 w-4" />
                审核中心
              </Link>
            </DropdownMenuItem>
          )}
          {user.isAdmin && (
            <DropdownMenuItem asChild>
              <Link to="/admin/reviewers" onClick={nav} className="cursor-pointer">
                <ShieldCheck className="h-4 w-4" />
                审核员管理
              </Link>
            </DropdownMenuItem>
          )}
        </div>
        <DropdownMenuSeparator className="mx-0" />
        <div className="py-1">
          <DropdownMenuItem className="cursor-pointer" onSelect={() => logout()}>
            <LogOut className="h-4 w-4" />
            退出登录
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
