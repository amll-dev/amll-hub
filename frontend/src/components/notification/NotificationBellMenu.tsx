import { useAtom } from 'jotai';
import { messagePanelVisibleAtom } from '@/atoms/message';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NotificationBell } from './NotificationBell';
import { NotificationPanel } from './NotificationPanel';

/**
 * 桌面端消息铃铛（DropdownMenu 外壳）。
 * modal={false}：同 UserMenu，防 modal 滚动锁导致页面横移；
 * 内容随 open 挂载/卸载，面板打开期间 messagePanelOpenAtom 置位。
 * 展开状态放在 atom 里：点击消息打开详情弹窗时，面板需要能被统一收起。
 */
export function NotificationBellMenu() {
  const [open, setOpen] = useAtom(messagePanelVisibleAtom);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <NotificationBell />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[120] w-[360px] p-0">
        <NotificationPanel onNavigate={() => setOpen(false)} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
