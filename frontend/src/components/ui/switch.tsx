import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

interface SwitchProps extends Omit<ComponentProps<'input'>, 'type' | 'onChange' | 'checked'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

function Switch({ className, checked = false, onCheckedChange, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        'relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        // 关闭态用更明显的中性灰，避免与 bg-muted 容器同色导致轨道看不见
        checked ? 'bg-primary' : 'bg-ink-3/35',
        className
      )}
      {...(props as ComponentProps<'button'>)}
    >
      <span
        className={cn(
          'pointer-events-none block size-[14px] rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[16px]' : 'translate-x-[2px]'
        )}
      />
    </button>
  );
}

export { Switch };
