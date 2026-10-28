import { cn } from '@/lib/utils';
import type { SearchTab } from '@/lib/types';

const TABS: { value: SearchTab; label: string }[] = [
  { value: 'all', label: '综合' },
  { value: 'song', label: '歌曲' },
  { value: 'artist', label: '歌手' },
  { value: 'album', label: '专辑' },
  { value: 'lyric', label: '歌词' },
  { value: 'id', label: '音乐ID' },
  { value: 'author', label: '歌词作者' },
  { value: 'user', label: '用户' },
];

/** 命中数展示：超过 99 折叠成 99+，用户侧达到统计上限时补 + */
function badgeText(count: number, more: boolean): string {
  if (more) return `${count}+`;
  if (count > 99) return '99+';
  return String(count);
}

export interface SearchTabsProps {
  value: SearchTab;
  onChange: (tab: SearchTab) => void;
  /** 各 Tab 的命中数；未加载完时不显示徽章 */
  counts?: Partial<Record<SearchTab, number>>;
  /** 用户匹配数是否已达统计上限 */
  userMore?: boolean;
}

/** 搜索结果页顶部的 Tab 行（下划线激活态 + 命中数徽章） */
export function SearchTabs({ value, onChange, counts, userMore = false }: SearchTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="搜索范围"
      className="flex items-center gap-6 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((t) => {
        const active = t.value === value;
        const count = counts?.[t.value];
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn(
              'relative shrink-0 whitespace-nowrap pb-3 pt-1 text-sm font-medium transition-colors',
              active ? 'text-primary' : 'text-ink-2 hover:text-foreground'
            )}
          >
            {t.label}
            {typeof count === 'number' && (
              <span
                className={cn(
                  'ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-normal leading-none',
                  active ? 'bg-primary-tint text-primary' : 'bg-surface-2 text-ink-3'
                )}
              >
                {badgeText(count, t.value === 'user' && userMore)}
              </span>
            )}
            {active && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />
            )}
          </button>
        );
      })}
    </div>
  );
}
