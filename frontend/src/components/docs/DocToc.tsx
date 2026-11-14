import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface TocItem {
  id: string;
  text: string;
  level: number;
}

/**
 * 页内目录：从已渲染的正文里取 h2/h3（marked-gfm-heading-id 已生成锚点），
 * 用 IntersectionObserver 高亮当前阅读位置。
 */
export function DocToc({
  containerRef,
  html,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  html: string;
}) {
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState('');

  useEffect(() => {
    const root = containerRef.current;
    if (!root) {
      setItems([]);
      return;
    }
    const nodes = Array.from(root.querySelectorAll<HTMLElement>('h2, h3'));
    setItems(
      nodes
        .filter((node) => node.id)
        .map((node) => ({
          id: node.id,
          text: node.textContent?.trim() ?? '',
          level: node.tagName === 'H3' ? 3 : 2,
        }))
    );
  }, [containerRef, html]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || items.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: [0, 1] }
    );
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items, containerRef]);

  if (items.length === 0) return null;

  return (
    <nav className="hidden w-52 shrink-0 xl:block">
      <div className="sticky top-24 max-h-[calc(100dvh-8rem)] overflow-y-auto pr-2">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">本页目录</p>
        <ul className="space-y-0.5">
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById(item.id)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  setActiveId(item.id);
                  history.replaceState(null, '', `#${item.id}`);
                }}
                className={cn(
                  'block truncate border-l-2 py-1 text-xs transition-colors',
                  item.level === 3 ? 'pl-5' : 'pl-3',
                  activeId === item.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-ink-3 hover:border-line hover:text-ink-2'
                )}
                title={item.text}
              >
                {item.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
