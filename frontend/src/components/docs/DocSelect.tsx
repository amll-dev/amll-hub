import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface DocSelectOption {
  value: string;
  label: string;
}

export function DocSelect({
  id,
  value,
  onValueChange,
  options,
  placeholder,
  className,
  disabled,
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: DocSelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const current = options.find((o) => o.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          id={id}
          className={cn(
            'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-sm text-foreground transition-colors',
            'hover:border-primary/40 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
        >
          <span className={cn('truncate', !current && 'text-ink-3')}>
            {current?.label ?? placeholder ?? '请选择'}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="z-[130] max-h-64 w-[var(--radix-dropdown-menu-trigger-width)] origin-[var(--radix-dropdown-menu-content-transform-origin)] overflow-y-auto duration-150 ease-out data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1"
      >
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className="cursor-pointer"
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
