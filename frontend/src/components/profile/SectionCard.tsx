import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

interface SectionCardProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}

/** 个人中心右侧内容区块 */
export function SectionCard({ icon, title, description, className, children }: SectionCardProps) {
  return (
    <div>
      <Card className={cn('gap-0 p-6', className)}>
        <div className="mb-5 flex items-start gap-3">
          {icon && (
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary [&_svg]:h-4 [&_svg]:w-4">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            {description && <p className="mt-1 text-sm text-ink-3">{description}</p>}
          </div>
        </div>
        {children}
      </Card>
    </div>
  );
}
