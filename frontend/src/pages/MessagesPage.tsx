import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsQuery,
} from '@/hooks/useNotifications';
import { PageContainer } from '@/components/PageContainer';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination';
import { NotificationList } from '@/components/notification/NotificationList';
import type { MessageType } from '@/lib/types';
import { cn } from '@/lib/utils';

const LIMIT = 20;

/** Tabs 筛选：全部 + 4 类（useState，不进 URL） */
const typeTabs: { value: MessageType | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'review', label: '审核' },
  { value: 'submission', label: '投稿' },
  { value: 'comment', label: '评论' },
  { value: 'system', label: '系统' },
];

/** 消息中心页：分页 + 类型筛选，直接读 TanStack Query（不共享面板 atom） */
export function MessagesPage() {
  const { user, openLogin } = useAuth();
  const navigate = useNavigate();
  const [type, setType] = useState<MessageType | 'all'>('all');
  const [page, setPage] = useState(1);

  const { data, isPending, isError } = useNotificationsQuery({
    page,
    limit: LIMIT,
    type,
  });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const del = useDeleteNotification();

  if (!user) {
    return (
      <PageContainer className="py-32 text-center">
        <h1 className="text-2xl font-bold tracking-tight">请先登录</h1>
        <p className="mt-2 text-sm text-ink-3">登录后查看你的消息</p>
        <button
          type="button"
          onClick={() => openLogin('/messages')}
          className="mt-6 rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          登录
        </button>
      </PageContainer>
    );
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const unread = data?.unread ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const goPage = (p: number) => {
    setPage(Math.min(Math.max(1, p), totalPages));
  };

  return (
    <PageContainer className="py-10">
      {/* 头部：标题 + 全部已读 */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">消息中心</h1>
        <button
          type="button"
          onClick={() => markAll.mutate()}
          disabled={unread === 0 || markAll.isPending}
          className={cn(
            'flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors',
            'hover:bg-surface-2 hover:text-foreground',
            'disabled:pointer-events-none disabled:opacity-50'
          )}
        >
          <CheckCheck className="h-3.5 w-3.5" />
          全部已读
        </button>
      </div>

      {/* 类型筛选 */}
      <Tabs
        value={type}
        onValueChange={(v) => {
          setType(v as MessageType | 'all');
          setPage(1);
        }}
        className="mt-5"
      >
        <TabsList>
          {typeTabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* 列表 */}
      <div className="mt-5 overflow-hidden rounded-lg border border-line bg-card">
        {isError ? (
          <p className="px-4 py-10 text-center text-sm text-ink-3">加载失败，请刷新重试</p>
        ) : (
          <NotificationList
            items={items}
            loading={isPending}
            onRead={(m) => {
              if (!m.read) markRead.mutate(m.id);
              if (m.action?.path) navigate(m.action.path);
            }}
            onDelete={(m) => del.mutate(m.id)}
          />
        )}
      </div>

      {/* 分页（照 Ranking：页码 + 上下页） */}
      {totalPages > 1 && (
        <Pagination className="mt-8">
          <PaginationContent>
            <PaginationItem>
              <PaginationLink
                href="#"
                aria-label="上一页"
                onClick={(e) => {
                  e.preventDefault();
                  goPage(page - 1);
                }}
                className={page <= 1 ? 'pointer-events-none opacity-40' : ''}
              >
                <ChevronLeft className="h-4 w-4" />
              </PaginationLink>
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink
                  href="#"
                  isActive={p === page}
                  onClick={(e) => {
                    e.preventDefault();
                    goPage(p);
                  }}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationLink
                href="#"
                aria-label="下一页"
                onClick={(e) => {
                  e.preventDefault();
                  goPage(page + 1);
                }}
                className={page >= totalPages ? 'pointer-events-none opacity-40' : ''}
              >
                <ChevronRight className="h-4 w-4" />
              </PaginationLink>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </PageContainer>
  );
}
