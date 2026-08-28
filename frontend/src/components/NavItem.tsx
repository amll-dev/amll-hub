import type { ReactNode } from 'react';

/** 侧边栏导航项 */
export function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
        active
          ? 'bg-primary-soft text-primary'
          : 'text-ink-2 hover:bg-surface-2 hover:text-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
