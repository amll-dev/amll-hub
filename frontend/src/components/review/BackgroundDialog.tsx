import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { BackgroundPanel } from '$/components/Sidebar/BackgroundPanel';

/**
 * 编辑器背景设置窗口。
 *
 * 原先是右侧栏的一个 tab，由 Ribbon 上的「背景」复选框开关；现在统一从
 * 顶栏「工具」菜单进入，用模态窗口承载，不再占用侧栏宽度。
 */
export function BackgroundDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>编辑器背景</DialogTitle>
          <DialogDescription>上传背景图并调整观感参数，设置只保存在本机浏览器。</DialogDescription>
        </DialogHeader>
        <BackgroundPanel />
      </DialogContent>
    </Dialog>
  );
}
