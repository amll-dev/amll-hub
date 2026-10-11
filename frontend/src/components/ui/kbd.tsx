import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** 键位徽标：用于展示快捷键（如打轴键位速查） */
function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 select-none items-center justify-center rounded-sm border border-line bg-surface-2 px-1.5',
        'font-mono text-[11px] font-medium leading-none text-ink-2',
        className
      )}
      {...props}
    />
  );
}

export { Kbd };
