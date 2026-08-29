import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col gap-6 rounded-lg border border-line bg-card py-6', className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5 px-6', className)} {...props} />;
}

function CardTitle({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('font-semibold leading-none text-foreground', className)} {...props} />;
}

function CardDescription({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('text-sm text-ink-3', className)} {...props} />;
}

function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-6', className)} {...props} />;
}

function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-center px-6', className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
