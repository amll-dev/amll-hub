import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { UserX, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { cn } from '@/lib/utils';
import { UserAvatar } from '@/components/submission/UserAvatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/Skeleton';
import type { UserSearchItem } from '@/lib/types';

// 用户搜索一次返回条数
const USER_PAGE_SIZE = 20;
const RELATED_LIMIT = 4;

/** 单个用户结果 */
function UserResultCard({ item, compact = false }: { item: UserSearchItem; compact?: boolean }) {
  return (
    <Link
      to={`/user/${encodeURIComponent(item.name)}`}
      className={cn(
        'flex items-start gap-3 rounded-lg border border-line bg-card transition-colors hover:border-primary/40 hover:bg-surface-2',
        compact ? 'p-3' : 'p-4'
      )}
    >
      <UserAvatar
        avatar={item.avatar}
        name={item.displayName || item.name}
        size={compact ? 36 : 44}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate font-semibold text-foreground">
            {item.displayName || item.name}
          </span>
          <span className="truncate text-xs text-ink-3">@{item.name}</span>
        </div>
        {item.bio && (
          <p className={cn('mt-1 text-sm text-ink-2', compact ? 'line-clamp-1' : 'line-clamp-2')}>
            {item.bio}
          </p>
        )}
        <p className="mt-1 text-xs text-ink-3">
          已通过 <span className="font-medium text-ink-2">{item.approvedCount}</span> 篇歌词投稿
        </p>
      </div>
    </Link>
  );
}

/** 「用户」Tab 的结果列表 */
export function UserSearchList({ q }: { q: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.searchUsers(q, USER_PAGE_SIZE),
    queryFn: () => api.searchUsers(q, { limit: USER_PAGE_SIZE }),
    enabled: q !== '',
    staleTime: 60_000,
  });

  if (isPending) return <ListSkeleton rows={5} />;

  if (error) {
    return (
      <p className="py-12 text-center text-sm text-error">
        {error instanceof Error ? error.message : '搜索用户失败'}
      </p>
    );
  }

  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        icon={UserX}
        title="未找到匹配的用户"
        description="换个用户名或昵称的片段再试试"
      />
    );
  }

  return (
    <div className="space-y-3">
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.name}>
            <UserResultCard item={item} />
          </li>
        ))}
      </ul>
      {data?.hasMore && (
        <p className="text-center text-xs text-ink-3">
          仅显示前 {USER_PAGE_SIZE} 位匹配用户，输入更精确的关键词可以缩小范围
        </p>
      )}
    </div>
  );
}

/** 「综合」Tab 底部的相关用户精选 */
export function RelatedUsers({ q }: { q: string }) {
  const { data } = useQuery({
    queryKey: queryKeys.searchUsers(q, RELATED_LIMIT),
    queryFn: () => api.searchUsers(q, { limit: RELATED_LIMIT }),
    enabled: q !== '',
    staleTime: 60_000,
  });

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section className="mt-10">
      <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-foreground">
        <Users className="h-4 w-4 text-ink-3" />
        相关用户
      </h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.name}>
            <UserResultCard item={item} compact />
          </li>
        ))}
      </ul>
    </section>
  );
}
