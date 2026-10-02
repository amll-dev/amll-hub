import { useEffect, useState } from 'react';
import { Loader2, Minus, Plus, Upload } from 'lucide-react';
import { buttonTap } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const STEP = 0.05;

interface AvatarUploadDialogProps {
  open: boolean;
  /** 选中的原图，null 表示没有待上传的文件 */
  file: File | null;
  /** 压缩 / 上传中：禁用交互并把「保存」切成加载态 */
  pending?: boolean;
  onCancel: () => void;
  /** 确认：带上当前放大倍数回调，由父级压缩后上传 */
  onConfirm: (zoom: number) => void;
}

// 上传头像弹窗
export function AvatarUploadDialog({
  open,
  file,
  pending = false,
  onCancel,
  onConfirm,
}: AvatarUploadDialogProps) {
  const [zoom, setZoom] = useState(1);
  const [preview, setPreview] = useState('');

  // 每次换文件都回到 1 倍，并重建 object URL（旧的必须 revoke）
  useEffect(() => {
    setZoom(1);
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const step = (delta: number) => setZoom((z) => clamp(z + delta, MIN_ZOOM, MAX_ZOOM));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            上传头像
          </DialogTitle>
        </DialogHeader>

        <div className="flex justify-center py-2">
          <div className="relative h-44 w-44 overflow-hidden rounded-full bg-surface-2 ring-1 ring-line">
            {preview ? (
              <img
                src={preview}
                alt="头像预览"
                className="h-full w-full object-cover transition-transform duration-150"
                style={{ transform: `scale(${zoom})` }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-ink-3">
                加载中…
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="缩小"
            disabled={pending || zoom <= MIN_ZOOM}
            onClick={() => step(-STEP * 2)}
            className="shrink-0"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={STEP}
            value={zoom}
            disabled={pending}
            aria-label="缩放"
            onChange={(e) => setZoom(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-surface-2 accent-primary disabled:cursor-not-allowed"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="放大"
            disabled={pending || zoom >= MAX_ZOOM}
            onClick={() => step(STEP * 2)}
            className="shrink-0"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
            取消
          </Button>
          <Button
            type="button"
            {...buttonTap}
            disabled={pending || !file}
            onClick={() => onConfirm(zoom)}
            className={cn('min-w-20')}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {pending ? '上传中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
