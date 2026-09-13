import * as SheetPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

function SheetOverlay({ className, ...props }: ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      className={cn(
        'fixed inset-0 z-[200] bg-black/50',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = 'right',
  hideClose = false,
  ...props
}: ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'right' | 'left';
  /** 隐藏内置关闭按钮（内容自带关闭入口时用，如消息面板头部） */
  hideClose?: boolean;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        className={cn(
          'fixed inset-y-0 z-[210] flex h-full w-full flex-col border-line bg-card shadow-lg outline-none',
          side === 'right' && 'right-0 border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
          side === 'left' && 'left-0 border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
          'transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-400',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          className
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm text-ink-3 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring/40">
            <X className="h-4 w-4" />
            <span className="sr-only">关闭</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col gap-1 border-b border-line px-4 py-3 text-left', className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      className={cn('text-base font-semibold text-foreground', className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description className={cn('text-sm text-ink-3', className)} {...props} />;
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
