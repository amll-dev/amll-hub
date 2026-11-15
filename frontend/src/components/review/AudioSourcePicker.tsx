import { Music } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Radio, RadioGroup } from '@/components/ui/radio-group';

export interface AudioSourceOption {
  key: string;
  src: string;
  label: string;
}

interface AudioSourcePickerProps {
  /** 可选音频源 */
  sources: AudioSourceOption[];
  /** 当前选中的索引 */
  value: number;
  /** 用户确认选择后回调 */
  onConfirm: (index: number) => void;
}

/** 音频源选择弹窗。*/
export function AudioSourcePicker({ sources, value, onConfirm }: AudioSourcePickerProps) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(value);
  // 每个**投稿**只自动弹一次：标记绑在音源集合的指纹上，而不是一个 boolean。
  // 审核员一晚上过 30 份投稿，共用同一个编辑器实例；用 boolean 的话只有第一份
  // 会被提示，后面 29 份即使有第二个音源也不会弹，可能一直用错的那一个打轴。
  const promptedKeyRef = useRef('');

  useEffect(() => {
    if (sources.length <= 1) return;
    const key = sources.map((source) => source.key).join('|');
    if (promptedKeyRef.current === key) return;
    promptedKeyRef.current = key;
    setPicked(value);
    setOpen(true);
  }, [sources, value]);

  if (sources.length <= 1) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>选择参考音频</DialogTitle>
          <DialogDescription>
            {sources.length > 1
              ? `该投稿包含 ${sources.length} 个音频来源，请选择用于打轴与频谱的参考音频。`
              : '请确认用于打轴与频谱的参考音频。'}
          </DialogDescription>
        </DialogHeader>

        <RadioGroup className="min-w-0 gap-2">
          {sources.map((source, index) => (
            <label
              key={source.key}
              className="flex min-w-0 cursor-pointer items-center gap-3 rounded-md border border-line px-3 py-2 text-sm hover:bg-muted"
            >
              <Radio
                name="audio-source"
                checked={picked === index}
                onChange={() => setPicked(index)}
              />
              <Music className="size-4 shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1 truncate" title={source.label}>
                {source.label}
              </span>
            </label>
          ))}
        </RadioGroup>

        <DialogFooter>
          <Button
            type="button"
            onClick={() => {
              onConfirm(picked);
              setOpen(false);
            }}
          >
            使用此音频
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
