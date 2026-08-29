import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex h-9 w-full items-center justify-start gap-1 border-b border-line text-sm',
        className
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap px-4 py-2 text-sm font-medium text-ink-2 transition-colors',
        'hover:text-foreground',
        'disabled:pointer-events-none disabled:opacity-50',
        // 激活态：文字 + 底部指示条（贴 list 的 border-b）
        'data-[state=active]:text-primary',
        'after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:rounded-full after:bg-primary after:content-[""]',
        'data-[state=inactive]:after:bg-transparent',
        className
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn('flex-1 outline-none data-[state=inactive]:hidden', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
