import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAtom } from 'jotai';
import { CheckCheck, X } from 'lucide-react';
import { messagePanelOpenAtom } from '@/atoms/message';
import type { Message } from '@/lib/types';
import {
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  usePanelNotifications,
} from '@/hooks/useNotifications';
import { NotificationList } from './NotificationList';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

/**
 * 面板内容（纯内容组件，不含外壳）：桌面 DropdownMenu / 移动 Sheet 共用。
 * - 头部：标题 + 全部已读
 * - 列表：第 1 页 20 条，ScrollArea 限高
 * - 底部：查看全部消息 → /messages
 * onNavigate：点击带跳转的条目或"查看全部"时回调，外壳用于关闭自身。
 * onClose：提供时（Sheet 外壳）在头部渲染关闭按钮。
 */
export function NotificationPanel({
  onNavigate,
  onClose,
}: {
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  const { data, isPending } = usePanelNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const del = useDeleteNotification();

  // 挂载期间置位：NotificationBoot 收到 WS 推送时不弹 toast 打扰
  const [, setPanelOpen] = useAtom(messagePanelOpenAtom);
  useEffect(() => {
    setPanelOpen(true);
    return () => setPanelOpen(false);
  }, [setPanelOpen]);

  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  const handleRead = (m: Message) => {
    if (!m.read) markRead.mutate(m.id);
    if (m.action?.path) onNavigate?.();
  };

  return (
    <div className="flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <p className="text-sm font-semibold text-foreground">消息中心</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => markAll.mutate()}
            disabled={unread === 0 || markAll.isPending}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-2 transition-colors',
              'hover:bg-surface-2 hover:text-foreground',
              'disabled:pointer-events-none disabled:opacity-50'
            )}
          >
            <CheckCheck className="h-3.5 w-3.5" />
            全部已读
          </button>
          {onClose && (
            <button
              type="button"
              aria-label="关闭"
              onClick={onClose}
              className="rounded-sm p-1 text-ink-3 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* 列表 */}
      <ScrollArea className="max-h-[420px]">
        <NotificationList
          items={items}
          loading={isPending}
          onRead={handleRead}
          onDelete={(m) => del.mutate(m.id)}
        />
      </ScrollArea>

      {/* 底部：查看全部 */}
      <Link
        to="/messages"
        onClick={() => {
          onNavigate?.();
          window.scrollTo(0, 0);
        }}
        className="border-t border-line px-4 py-2.5 text-center text-xs font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-primary"
      >
        查看全部消息 →
      </Link>
    </div>
  );
}
