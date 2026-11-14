import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { ChevronDown, FileText } from 'lucide-react';
import { PageContainer } from '@/components/PageContainer';
import { DocSidebar } from '@/components/docs/DocSidebar';
import { cn } from '@/lib/utils';

/** 文档区布局 */
export function DocsLayout() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <PageContainer width="lg" className="py-8">
      <div className="flex flex-col gap-6 md:flex-row md:gap-10">
        <aside className="w-full shrink-0 md:sticky md:top-20 md:max-h-[calc(100dvh-7rem)] md:w-56 md:self-start md:overflow-y-auto">
          {/* 移动端：折叠目录 */}
          <button
            type="button"
            onClick={() => setNavOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-md border border-line bg-card px-3 py-2 text-sm text-ink-2 md:hidden"
          >
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              文档目录
            </span>
            <ChevronDown className={cn('h-4 w-4 transition-transform', navOpen && 'rotate-180')} />
          </button>
          <div className={cn('mt-4 md:mt-0 md:block', navOpen ? 'block' : 'hidden')}>
            <DocSidebar onNavigate={() => setNavOpen(false)} />
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <Outlet />
          <footer className="mt-12 space-y-1 border-t border-line pt-6 text-[11px] leading-relaxed text-ink-3">
            <p>
              © 2024-2026 AMLL TTML Database Reviewers Team. Current version: All Rights Reserved.
            </p>
            <p>
              Content before commit{' '}
              <a
                href="https://github.com/amll-dev/amll-ttml-db/commit/8b56afe4f4f508b35e9142690ef758fa14e46533"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                8b56afe
              </a>{' '}
              was under CC0 1.0 in the main repository.
            </p>
            <p>
              All referenced or quoted external content belongs to their original copyright holders
              and is used for reference/educational purposes only under fair use principles. We
              claim no ownership over such materials.
            </p>
          </footer>
        </div>
      </div>
    </PageContainer>
  );
}
