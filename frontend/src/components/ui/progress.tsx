import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * 进度条。扩展 indicatorClassName 用于自定义填充色
 * （如上传进度成功态用 bg-success、失败态用 bg-error）。
 */
const progressIndicatorVariants = cva('h-full w-full flex-1 bg-primary transition-all', {
  variants: {
    indicatorColor: {
      primary: 'bg-primary',
      success: 'bg-success',
      error: 'bg-error',
    },
  },
  defaultVariants: {
    indicatorColor: 'primary',
  },
});

function Progress({
  className,
  value,
  indicatorColor,
  ...props
}: ComponentProps<'div'> &
  VariantProps<typeof progressIndicatorVariants> & {
    /** 0-100；undefined 显示不定进度（可加 animate-pulse） */
    value?: number;
  }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-surface-2', className)}
      {...props}
    >
      <div
        className={cn(progressIndicatorVariants({ indicatorColor }))}
        style={{
          transform: `translateX(-${100 - (value ?? 0)}%)`,
        }}
      />
    </div>
  );
}

export { Progress };
