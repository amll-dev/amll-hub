import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

interface CheckboxProps extends Omit<ComponentProps<'input'>, 'type' | 'checked' | 'onChange'> {
  checked?: boolean | 'indeterminate';
  onCheckedChange?: (checked: boolean) => void;
}

function Checkbox({ className, checked = false, onCheckedChange, ...props }: CheckboxProps) {
  const isChecked = checked === true || checked === 'indeterminate';
  return (
    <input
      type="checkbox"
      checked={isChecked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      className={cn(
        'size-4 shrink-0 cursor-pointer appearance-none rounded border border-input bg-card transition-colors',
        'checked:border-primary checked:bg-primary',
        'checked:bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%2016%2016%27%20fill%3D%27white%27%3E%3Cpath%20d%3D%27M13.485%201.07L6.5%208.055%202.515%204.07%201%205.585l1.515%201.515L6.5%2011.385l5.985-5.985z%27%2F%3E%3C%2Fsvg%3E")] checked:bg-center checked:bg-no-repeat',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export { Checkbox };
