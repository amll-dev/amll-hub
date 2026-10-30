import { cn } from '@/lib/utils';

export interface FirstSubmissionBadgeProps {
  /** sm 用于列表行，md 用于详情页标题 */
  size?: 'sm' | 'md';
  className?: string;
}

const sizeClass = {
  sm: 'px-2 py-0.5 text-[11px]',
  md: 'px-2.5 py-1 text-xs',
} as const;

/** 首次投稿标识 */
export function FirstSubmissionBadge({ size = 'sm', className }: FirstSubmissionBadgeProps) {
  return (
    <span
      title="这是在首篇稿件通过审核之前提交的投稿"
      className={cn(
        'inline-flex shrink-0 items-center rounded-full bg-primary font-medium leading-none text-primary-foreground',
        sizeClass[size],
        className
      )}
    >
      首次投稿
    </span>
  );
}
