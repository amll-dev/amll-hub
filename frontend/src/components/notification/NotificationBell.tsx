import type { ComponentProps } from 'react';
import { useAtomValue } from 'jotai';
import { Bell } from 'lucide-react';
import { hasUnreadAtom } from '@/atoms/message';
import { cn } from '@/lib/utils';

/**
 * 消息铃铛触发器（纯按钮，三处入口共用）。
 * 作为 DropdownMenuTrigger / SheetTrigger 的 asChild 子元素使用，
 * 红点遵循全站惯例（参考 UserMenu 在线小圆点）。
 */
export function NotificationBell({ className, ...props }: ComponentProps<'button'>) {
  const hasUnread = useAtomValue(hasUnreadAtom);
  return (
    <button
      type="button"
      aria-label="消息通知"
      className={cn(
        'relative flex h-9 w-9 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        className
      )}
      {...props}
    >
      <Bell className="h-5 w-5" />
      {hasUnread && (
        <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />
      )}
    </button>
  );
}
