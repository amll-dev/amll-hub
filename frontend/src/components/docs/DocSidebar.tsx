import { useQuery } from '@tanstack/react-query';
import { BookOpen, Loader2 } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { api } from '@/lib/api';
import { groupDocs } from '@/lib/docs';
import { queryKeys } from '@/lib/query';
import { preloadRoute } from '@/routes';
import { cn } from '@/lib/utils';

/** 文档侧边栏 */
export function DocSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.docList({}),
    queryFn: () => api.docs.list({ pageSize: 50 }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-ink-3">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        加载目录…
      </div>
    );
  }

  const buckets = groupDocs(data?.items ?? []);

  return (
    <nav className="space-y-6">
      <NavLink
        to="/docs"
        end
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-2 text-sm font-semibold transition-colors',
            isActive ? 'text-primary' : 'text-ink-2 hover:text-primary'
          )
        }
      >
        <BookOpen className="h-4 w-4" />
        文档首页
      </NavLink>

      {buckets.map((bucket) => (
        <div key={bucket.group}>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">
            {bucket.label}
          </p>
          <ul className="space-y-1 border-l border-line">
            {bucket.items.map((item) => (
              <li key={item.slug}>
                <NavLink
                  to={`/docs/${item.slug}`}
                  onClick={onNavigate}
                  onMouseEnter={() => preloadRoute(`/docs/${item.slug}`)}
                  className={({ isActive }) =>
                    cn(
                      '-ml-px block border-l-2 py-1.5 pl-3 text-sm transition-colors',
                      isActive
                        ? 'border-primary font-medium text-primary'
                        : 'border-transparent text-ink-2 hover:border-line hover:text-primary'
                    )
                  }
                >
                  {item.title}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
