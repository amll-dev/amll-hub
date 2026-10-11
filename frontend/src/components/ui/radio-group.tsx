import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function RadioGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div role="radiogroup" className={cn('flex flex-col gap-1', className)} {...props} />;
}

/** 单选框：基于原生 input[type=radio] */
function Radio({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="radio"
      className={cn(
        'size-4 shrink-0 cursor-pointer appearance-none rounded-full border border-input bg-card transition-colors',
        'checked:border-[5px] checked:border-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export { Radio, RadioGroup };
