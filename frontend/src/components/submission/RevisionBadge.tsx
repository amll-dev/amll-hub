import { cn } from '@/lib/utils';

const sizeClass = {
  sm: 'px-2 py-0.5 text-[11px]',
  md: 'px-2.5 py-1 text-xs',
} as const;

/** 「歌词修正」标识 */
export function RevisionBadge({
  size = 'sm',
  className,
}: {
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      title="这是一篇修正已有歌词的投稿"
      className={cn(
        'inline-flex shrink-0 items-center rounded-full bg-purple-100 font-medium leading-none text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
        sizeClass[size],
        className
      )}
    >
      歌词修正
    </span>
  );
}
