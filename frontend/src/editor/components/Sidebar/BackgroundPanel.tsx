import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { ImageOff, ImagePlus } from 'lucide-react';
import { type FC, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  customBackgroundBlurAtom,
  customBackgroundBrightnessAtom,
  customBackgroundImageAtom,
  customBackgroundMaskAtom,
  customBackgroundOpacityAtom,
} from '$/modules/settings/states/custom-background';

const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024;

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}

const SliderRow: FC<SliderRowProps> = ({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v) => v.toFixed(2),
}) => {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        <span className="text-xs tabular-nums text-ink-3">{format(value)}</span>
      </div>
      <Slider
        id={id}
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={(next) => onChange(next)}
      />
    </div>
  );
};

/** 自定义编辑器背景：上传图片 + 四个观感参数 */
export const BackgroundPanel: FC = () => {
  const fileRef = useRef<HTMLInputElement>(null);
  // 超限提示放在窗口内部：toast 会被 DialogContent 的 z-[500] 挡住，
  // 而原生 alert 会打断模态窗口的操作流。
  const [error, setError] = useState<string | null>(null);
  const image = useAtomValue(customBackgroundImageAtom);
  const setImage = useSetAtom(customBackgroundImageAtom);
  const [opacity, setOpacity] = useAtom(customBackgroundOpacityAtom);
  const [mask, setMask] = useAtom(customBackgroundMaskAtom);
  const [blur, setBlur] = useAtom(customBackgroundBlurAtom);
  const [brightness, setBrightness] = useAtom(customBackgroundBrightnessAtom);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label className="text-xs">背景图片</Label>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (file.size > MAX_BACKGROUND_BYTES) {
                // 背景图只在本机存 IndexedDB，不做上传，超限直接拒绝
                setError(`背景图超过 ${MAX_BACKGROUND_BYTES / 1024 / 1024} MB，请压缩后再选`);
                return;
              }
              setError(null);
              void setImage(file);
            }}
          />
          <Button
            variant="secondary"
            className="h-7 px-2 text-xs"
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className="mr-1 size-4" />
            选择图片
          </Button>
          <Button
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={!image}
            onClick={() => {
              setError(null);
              void setImage(null);
            }}
          >
            <ImageOff className="mr-1 size-4" />
            清除
          </Button>
        </div>
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : (
          <p className="text-xs text-ink-3">图片只保存在本机浏览器，不会上传。</p>
        )}
      </div>

      <SliderRow
        label="不透明度"
        value={opacity}
        min={0}
        max={1}
        step={0.05}
        onChange={setOpacity}
      />
      <SliderRow label="遮罩" value={mask} min={0} max={1} step={0.05} onChange={setMask} />
      <SliderRow
        label="模糊"
        value={blur}
        min={0}
        max={24}
        step={1}
        onChange={setBlur}
        format={(v) => `${v}px`}
      />
      <SliderRow
        label="亮度"
        value={brightness}
        min={0.2}
        max={1.6}
        step={0.05}
        onChange={setBrightness}
      />
    </div>
  );
};
