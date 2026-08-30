import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';

/** 全站统一的空状态占位 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className = '',
  size = 'md',
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const padding = size === 'sm' ? 'py-8' : 'py-12';
  const iconSize = size === 'sm' ? 'h-8 w-8' : 'h-10 w-10';

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-card px-4 text-center ${padding} ${className}`}
    >
      <Icon className={`${iconSize} text-ink-3`} />
      <p className={`${size === 'sm' ? 'mt-2 text-sm' : 'mt-3 text-sm'} text-ink-2`}>{title}</p>
      {description && <p className="mt-1 text-xs text-ink-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
