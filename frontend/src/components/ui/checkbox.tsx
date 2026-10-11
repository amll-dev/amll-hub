import { type ComponentProps, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface CheckboxProps extends Omit<ComponentProps<'input'>, 'type' | 'checked' | 'onChange'> {
  checked?: boolean | 'indeterminate';
  onCheckedChange?: (checked: boolean) => void;
}

function Checkbox({ className, checked = false, onCheckedChange, ...props }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  const isIndeterminate = checked === 'indeterminate';
  const isChecked = checked === true || isIndeterminate;

  // 原生 input 的 indeterminate 只能通过 DOM 属性设置，不能由 HTML 属性表达
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = isIndeterminate;
  }, [isIndeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={isChecked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      className={cn(
        'size-4 shrink-0 cursor-pointer appearance-none rounded border border-input bg-card transition-colors',
        'checked:border-primary checked:bg-primary',
        'indeterminate:border-primary indeterminate:bg-primary',
        'checked:bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%2016%2016%27%20fill%3D%27white%27%3E%3Cpath%20d%3D%27M13.485%201.07L6.5%208.055%202.515%204.07%201%205.585l1.515%201.515L6.5%2011.385l5.985-5.985z%27%2F%3E%3C%2Fsvg%3E")] checked:bg-center checked:bg-no-repeat',
        'indeterminate:bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%2016%2016%27%20fill%3D%27white%27%3E%3Crect%20x%3D%274%27%20y%3D%277%27%20width%3D%278%27%20height%3D%272%27%20rx%3D%271%27%2F%3E%3C%2Fsvg%3E")] indeterminate:bg-center indeterminate:bg-no-repeat',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export { Checkbox };
