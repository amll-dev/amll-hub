import { useCallback, useMemo } from 'react';
import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { PageContainer } from '@/components/PageContainer';
import { renderMarkdown } from '@/components/submission/shared';

/** 站内路由的 md 链接（/terms、/privacy）需走客户端路由，外链与锚点交给浏览器 */
function isInternalPath(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

/**
 * 法律文档正文页（用户协议 / 隐私政策）
 *
 * 排版由 @tailwindcss/typography 的 prose 类承担，`.legal-prose`（index.css）只补
 * 主题令牌桥接与项目特有样式，作用域限定在该类内以免污染其他 dangerouslySetInnerHTML 场景。
 */
export function LegalDocument({
  title,
  subtitle,
  markdown,
}: {
  title: string;
  /** 副标题（如生效日期 / 版本号） */
  subtitle?: string;
  markdown: string;
}) {
  const navigate = useNavigate();
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);

  /** md 里的站内链接走 react-router，避免整页刷新丢失 SPA 状态 */
  const handleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      const href = (e.target as HTMLElement).closest('a')?.getAttribute('href');
      if (!href || !isInternalPath(href)) return;
      e.preventDefault();
      navigate(href); // 外层路由接管渲染并滚回顶部
    },
    [navigate]
  );

  return (
    <PageContainer width="form" className="py-10 sm:py-14">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-ink-3 transition-colors hover:text-primary"
      >
        <ChevronLeft className="h-4 w-4" />
        返回首页
      </Link>

      <header className="mt-6 border-b border-line pb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-ink-3">{subtitle}</p>}
      </header>

      <div
        className="prose legal-prose mt-8"
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </PageContainer>
  );
}
