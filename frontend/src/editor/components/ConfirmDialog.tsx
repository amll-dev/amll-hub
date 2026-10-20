import { useAtom } from 'jotai';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { confirmDialogAtom } from '$/states/dialogs.ts';

export function ConfirmDialog() {
  const [state, setState] = useAtom(confirmDialogAtom);
  /** 标记本次关闭是「确认」触发的，避免同时回调 `onCancel` */
  const confirmedRef = useRef(false);

  const close = () => setState((prev) => ({ ...prev, open: false }));

  const handleConfirm = () => {
    const run = state.onConfirm;
    confirmedRef.current = true;
    // 先收起对话框再执行，与原生确认框一致，避免执行期间 UI 卡在弹窗上
    close();
    // 可能是异步任务（打开文件 / 恢复历史），错误由调用方自行处理
    void run?.();
  };

  const handleCancel = () => {
    state.onCancel?.();
    close();
  };

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    if (confirmedRef.current) {
      confirmedRef.current = false;
      return;
    }
    handleCancel();
  };

  return (
    <Dialog open={state.open} onOpenChange={handleOpenChange}>
      <DialogContent className="z-[500] max-w-md" overlayClassName="z-[450]">
        <DialogHeader>
          <DialogTitle>{state.title}</DialogTitle>
          {state.description ? (
            <DialogDescription className="whitespace-pre-wrap">
              {state.description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            取消
          </Button>
          <Button onClick={handleConfirm}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
