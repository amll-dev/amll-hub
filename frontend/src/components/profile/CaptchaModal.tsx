import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CaptchaModalProps {
  open: boolean;
  /** 人机验证组件是否已就绪 */
  ready: boolean;
  onClose: () => void;
  /** 阿里云验证码挂载点 id，需与 useAliyunCaptcha 的 sceneId 一致 */
  sceneId: string;
}

/**
 * 人机验证弹窗。
 *
 * 关闭时用 `inert` 而不是只靠 opacity + pointer-events：后者挡不住键盘，
 * Tab 仍能聚焦到里面的关闭按钮，读屏也会因为「焦点落在 aria-hidden 区域」
 * 报错。`inert` 同时屏蔽鼠标、焦点与辅助技术，且不会卸载 iframe
 * （阿里云 SDK 需要在挂载时初始化，反复卸载会重建 iframe）。
 */
export function CaptchaModal({ open, ready, onClose, sceneId }: CaptchaModalProps) {
  return (
    <div
      className={cn(
        'fixed inset-0 z-[220] flex items-center justify-center bg-black/40 px-4 transition-opacity',
        !open && 'pointer-events-none opacity-0'
      )}
      aria-hidden={!open}
      inert={!open}
      onClick={open ? onClose : undefined}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-line bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">请完成人机验证</span>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-3 transition-colors hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-[44px]">
          {!ready && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-5 w-5 animate-spin text-ink-3" />
            </div>
          )}
          <div id={sceneId} />
        </div>
      </div>
    </div>
  );
}
