import { Inbox } from 'lucide-react';
import type { Message } from '@/lib/types';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { NotificationItem } from './NotificationItem';

/** 单条骨架行 */
function ItemSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

/**
 * 消息列表（面板与 /messages 页共用，纯列表：滚动/分页由调用方处理）。
 */
export function NotificationList({
  items,
  loading,
  onRead,
  onDelete,
}: {
  items: Message[];
  loading?: boolean;
  onRead: (m: Message) => void;
  onDelete: (m: Message) => void;
}) {
  if (loading) {
    return (
      <div className="divide-y divide-line/60">
        <ItemSkeleton />
        <ItemSkeleton />
        <ItemSkeleton />
      </div>
    );
  }
  if (items.length === 0) {
    return <EmptyState icon={Inbox} title="暂无消息" size="sm" />;
  }
  return (
    <div className="divide-y divide-line/60">
      {items.map((m) => (
        <NotificationItem key={m.id} message={m} onRead={onRead} onDelete={onDelete} />
      ))}
    </div>
  );
}
