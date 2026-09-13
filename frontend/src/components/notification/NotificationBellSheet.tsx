import { useState } from 'react';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { NotificationBell } from './NotificationBell';
import { NotificationPanel } from './NotificationPanel';

/**
 * 移动端消息铃铛（右侧滑出 Sheet 外壳，<768px）。
 * 内置关闭按钮交给面板头部渲染（onClose），避免与"全部已读"重叠。
 */
export function NotificationBellSheet() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <NotificationBell />
      </SheetTrigger>
      <SheetContent side="right" aria-label="消息中心" hideClose className="w-full p-0 sm:max-w-sm">
        {/* Radix Dialog 无障碍要求：提供标题（sr-only，视觉标题在面板头部） */}
        <SheetTitle className="sr-only">消息中心</SheetTitle>
        <NotificationPanel onNavigate={() => setOpen(false)} onClose={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
