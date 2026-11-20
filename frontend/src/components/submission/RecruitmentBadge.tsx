import { cn } from '@/lib/utils';

const sizeClass = {
  sm: 'px-2 py-0.5 text-[11px]',
  md: 'px-2.5 py-1 text-xs',
} as const;

/** 「参与审核招募」标识 */
export function RecruitmentBadge({
  size = 'sm',
  className,
}: {
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      title="这篇投稿参与了审核招募"
      className={cn(
        'inline-flex shrink-0 items-center rounded-full bg-teal-600 font-medium leading-none text-white',
        sizeClass[size],
        className
      )}
    >
      参与审核招募
    </span>
  );
}
