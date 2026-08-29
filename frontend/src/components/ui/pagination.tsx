import type { ComponentProps, ReactNode } from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonVariants, type Button } from '@/components/ui/button';

function Pagination({ className, ...props }: ComponentProps<'nav'>) {
  return (
    <nav
      role="navigation"
      aria-label="分页"
      className={cn('mx-auto flex w-full items-center justify-center gap-1.5', className)}
      {...props}
    />
  );
}

function PaginationContent({ className, ...props }: ComponentProps<'ul'>) {
  return <ul className={cn('flex flex-row items-center gap-1.5', className)} {...props} />;
}

function PaginationItem({ className, ...props }: ComponentProps<'li'>) {
  return <li className={cn('', className)} {...props} />;
}

type PaginationLinkProps = {
  isActive?: boolean;
  size?: ComponentProps<typeof Button>['size'];
  label?: ReactNode;
} & ComponentProps<'a'>;

function PaginationLink({ className, isActive, size = 'icon', ...props }: PaginationLinkProps) {
  return (
    <a
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        buttonVariants({
          variant: isActive ? 'default' : 'outline',
          size,
          className: 'h-9 min-w-9 px-3 text-sm font-normal',
        }),
        isActive ? 'pointer-events-none' : 'hover:border-primary hover:text-primary',
        className
      )}
      {...props}
    />
  );
}

function PaginationPrevious({
  className,
  label = '上一页',
  ...props
}: ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink
      aria-label={typeof label === 'string' ? label : undefined}
      size="default"
      className={cn('gap-1 px-2.5 sm:pl-2.5', className)}
      {...props}
    >
      <ChevronLeft className="h-4 w-4" />
      <span>{label}</span>
    </PaginationLink>
  );
}

function PaginationNext({
  className,
  label = '下一页',
  ...props
}: ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink
      aria-label={typeof label === 'string' ? label : undefined}
      size="default"
      className={cn('gap-1 px-2.5 sm:pr-2.5', className)}
      {...props}
    >
      <span>{label}</span>
      <ChevronRight className="h-4 w-4" />
    </PaginationLink>
  );
}

function PaginationEllipsis({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      aria-hidden
      className={cn('flex size-9 items-center justify-center text-ink-3', className)}
      {...props}
    >
      <MoreHorizontal className="h-4 w-4" />
    </span>
  );
}

export {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
};
