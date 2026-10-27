import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Music } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { formatDateTime } from '@/lib/format';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListSkeleton, Skeleton } from '@/components/ui/Skeleton';
import { SubmissionRow } from '@/components/submission/SubmissionRow';
import { statusMeta } from '@/components/submission/status';
import { Badge } from '@/components/ui/badge';
import type { PublicSubmissionItem } from '@/lib/types';

/** 主页 Tab：精选一条 + 最近投稿 */
export function UserOverviewTab({ name, isSelf }: { name: string; isSelf: boolean }) {
  const listStatus = isSelf ? 'all' : 'approved';

  const featuredQuery = useQuery({
    queryKey: queryKeys.userSubmissions(name, { status: 'approved', limit: 1 }),
    queryFn: () => api.getUserSubmissions(name, { status: 'approved', limit: 1 }),
    staleTime: 60_000,
  });

  const recentQuery = useQuery({
    queryKey: queryKeys.userSubmissions(name, { status: listStatus, limit: 6 }),
    queryFn: () => api.getUserSubmissions(name, { status: listStatus, limit: 6 }),
    staleTime: 60_000,
  });

  const featured = featuredQuery.data?.items?.[0];
  const recent = useMemo(
    () => (recentQuery.data?.items ?? []).filter((it) => it.id !== featured?.id),
    [recentQuery.data, featured?.id]
  );

  if (recentQuery.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-lg" />
        <ListSkeleton rows={4} />
      </div>
    );
  }

  if (recentQuery.error) {
    return (
      <p className="rounded-lg border border-line bg-card px-4 py-8 text-center text-sm text-error">
        {recentQuery.error instanceof Error ? recentQuery.error.message : '加载失败'}
      </p>
    );
  }

  const isEmpty = !featured && recent.length === 0;
  if (isEmpty) {
    return (
      <EmptyState
        icon={FileText}
        title={isSelf ? '还没有投稿' : '暂无公开投稿'}
        description={
          isSelf
            ? '去创作中心提交第一篇歌词，这里就会显示你的精选作品'
            : '该用户还没有通过审核的投稿'
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      {featured && <FeaturedCard item={featured} isSelf={isSelf} />}

      {recent.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-foreground">
            {isSelf ? '最近投稿' : '最近通过'}
          </h2>
          <ul className="space-y-2">
            {recent.map((item) => (
              <SubmissionRow
                key={item.id}
                item={item}
                showStatus={isSelf}
                href={isSelf ? `/creator/lyrics/detail?id=${item.id}` : undefined}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** 精选卡：最新一篇已通过的投稿 */
function FeaturedCard({ item, isSelf }: { item: PublicSubmissionItem; isSelf: boolean }) {
  const meta = statusMeta[item.status] ?? {
    label: item.status,
    className: 'bg-surface-2 text-ink-2',
  };

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-gradient-to-br from-primary-soft via-card to-surface-2">
      <div className="flex items-start gap-4 p-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
          <Music className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-foreground">
              {item.title || '未命名'}
            </h2>
            {isSelf && (
              <Badge
                variant="outline"
                className={`inline-flex items-center rounded-full border-transparent px-2 py-0.5 text-xs font-medium ${meta.className}`}
              >
                {meta.label}
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate text-sm text-ink-2">
            {[item.artist, item.album].filter(Boolean).join(' · ') || '—'}
          </p>
          <p className="mt-2 text-xs text-ink-3">
            通过于 {formatDateTime(item.updatedAt || item.createdAt)}
          </p>
        </div>
      </div>
    </section>
  );
}
