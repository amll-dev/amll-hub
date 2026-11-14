import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { DOC_GROUPS, groupDocs } from '@/lib/docs';
import { formatDate } from '@/lib/format';
import { queryKeys } from '@/lib/query';
import { preloadRoute } from '@/routes';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';

/** 文档首页 */
export function DocsHome() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.docList({}),
    queryFn: () => api.docs.list({ pageSize: 50 }),
  });

  const buckets = groupDocs(data?.items ?? []);

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">文档</h1>
        <p className="mt-2 text-sm text-ink-2">AMLL TTML 歌词库的使用、投稿、审核与格式规范。</p>
      </header>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : buckets.length === 0 ? (
        <EmptyState icon={FileText} title="还没有文档" description="稍后再来看看" />
      ) : (
        <div className="space-y-8">
          {buckets.map((bucket) => {
            const hint = DOC_GROUPS.find((g) => g.key === bucket.group)?.hint;
            return (
              <section key={bucket.group}>
                <div className="mb-3 flex items-baseline gap-2">
                  <h2 className="text-sm font-semibold text-ink-2">{bucket.label}</h2>
                  {hint && <span className="text-xs text-ink-3">{hint}</span>}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {bucket.items.map((item) => (
                    <Link
                      key={item.slug}
                      to={`/docs/${item.slug}`}
                      onMouseEnter={() => preloadRoute(`/docs/${item.slug}`)}
                      className="group rounded-lg border border-line bg-card p-4 transition-colors hover:border-primary/40 hover:bg-primary-soft/30"
                    >
                      <p className="text-sm font-medium text-foreground group-hover:text-primary">
                        {item.title}
                      </p>
                      <p className="mt-2 text-xs text-ink-3">
                        更新于 {formatDate(item.updatedAt)}
                        {item.updatedBy ? ` · ${item.updatedBy}` : ''}
                      </p>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
