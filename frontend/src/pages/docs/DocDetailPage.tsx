import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { groupLabel } from '@/lib/docs';
import { formatDate } from '@/lib/format';
import { renderDocsMarkdown, scrollToHash } from '@/lib/markdown';
import { queryKeys } from '@/lib/query';
import { preloadRoute } from '@/routes';
import { DocToc } from '@/components/docs/DocToc';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** 文档详情 */
export function DocDetailPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const contentRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.docDetail(slug),
    queryFn: () => api.docs.detail(slug),
    enabled: Boolean(slug),
  });

  const doc = data?.document;
  const html = useMemo(() => renderDocsMarkdown(doc?.content ?? ''), [doc?.content]);

  // 跨页带 hash 进来时，AnimatedOutlet 会先滚到顶部，这里补一次定位
  useEffect(() => {
    if (html && location.hash) scrollToHash(location.hash);
  }, [html, location.hash]);

  const { data: list } = useQuery({
    queryKey: queryKeys.docList({}),
    queryFn: () => api.docs.list({ pageSize: 50 }),
  });
  const index = list?.items.findIndex((item) => item.slug === slug) ?? -1;
  const prev = index > 0 ? list?.items[index - 1] : undefined;
  const next = index >= 0 ? list?.items[index + 1] : undefined;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (isError || !doc) {
    return (
      <EmptyState
        icon={FileText}
        title="文档不存在"
        description="可能已被删除或尚未发布"
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/docs">返回文档首页</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex gap-8">
      <article className="min-w-0 flex-1">
        <header className="mb-6 border-b border-line pb-5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{groupLabel(doc.group)}</Badge>
            {doc.status === 'draft' && <Badge variant="warning">草稿</Badge>}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{doc.title}</h1>
          <p className="mt-2 text-xs text-ink-3">
            更新于 {formatDate(doc.updatedAt)}
            {doc.updatedByInfo?.displayName || doc.updatedBy
              ? ` · ${doc.updatedByInfo?.displayName || doc.updatedBy}`
              : ''}
            {data.revisionCount > 0 ? ` · ${data.revisionCount} 个版本` : ''}
          </p>
        </header>

        <div
          ref={contentRef}
          className="prose legal-prose docs-prose"
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={(e) => {
            const anchor = (e.target as HTMLElement).closest('a');
            const href = anchor?.getAttribute('href');
            if (!href) return;
            if (href.startsWith('#')) {
              e.preventDefault();
              scrollToHash(href);
              history.replaceState(null, '', `${location.pathname}${href}`);
              return;
            }
            if (href.startsWith('/')) {
              e.preventDefault();
              navigate(href);
            }
          }}
        />

        {(prev || next) && (
          <nav className="mt-10 grid gap-3 border-t border-line pt-6 sm:grid-cols-2">
            {prev ? (
              <Link
                to={`/docs/${prev.slug}`}
                onMouseEnter={() => preloadRoute(`/docs/${prev.slug}`)}
                className="group rounded-lg border border-line px-4 py-3 transition-colors hover:border-primary/40"
              >
                <span className="flex items-center gap-1 text-xs text-ink-3">
                  <ArrowLeft className="h-3 w-3" />
                  上一篇
                </span>
                <span className="mt-1 block truncate text-sm text-ink-2 group-hover:text-primary">
                  {prev.title}
                </span>
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link
                to={`/docs/${next.slug}`}
                onMouseEnter={() => preloadRoute(`/docs/${next.slug}`)}
                className="group rounded-lg border border-line px-4 py-3 text-right transition-colors hover:border-primary/40"
              >
                <span className="flex items-center justify-end gap-1 text-xs text-ink-3">
                  下一篇
                  <ArrowRight className="h-3 w-3" />
                </span>
                <span className="mt-1 block truncate text-sm text-ink-2 group-hover:text-primary">
                  {next.title}
                </span>
              </Link>
            )}
          </nav>
        )}
      </article>

      <DocToc containerRef={contentRef} html={html} />
    </div>
  );
}
