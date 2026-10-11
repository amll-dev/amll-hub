import type { ComponentProps, CSSProperties } from 'react';
import { cn } from '@/lib/utils';

interface SliderProps extends Omit<ComponentProps<'input'>, 'type' | 'value' | 'onChange'> {
  value: number;
  onValueChange?: (value: number) => void;
  orientation?: 'horizontal' | 'vertical';
  trackColor?: string;
}

/** 轨道粗细 */
const TRACK_THICKNESS = 6;
/** 滑块圆点直径 */
const THUMB_SIZE = 12;

function Slider({
  className,
  value,
  onValueChange,
  orientation = 'horizontal',
  trackColor,
  style,
  ...props
}: SliderProps) {
  const isVertical = orientation === 'vertical';
  const color = trackColor ?? 'var(--amll-muted)';

  const inset = THUMB_SIZE / 2;
  const trackStyle: CSSProperties = isVertical
    ? {
        top: `${inset}px`,
        bottom: `${inset}px`,
        left: '50%',
        width: `${TRACK_THICKNESS}px`,
        transform: 'translateX(-50%)',
        background: color,
      }
    : {
        left: `${inset}px`,
        right: `${inset}px`,
        top: '50%',
        height: `${TRACK_THICKNESS}px`,
        transform: 'translateY(-50%)',
        background: color,
      };

  return (
    <span
      // 轨道容器
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center',
        isVertical ? 'h-full w-4' : 'h-4 w-full',
        className
      )}
      style={style}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute rounded-full"
        style={trackStyle}
      />
      <input
        type="range"
        value={value}
        onChange={(e) => onValueChange?.(e.target.valueAsNumber)}
        className={cn(
          // input 铺满外层容器
          'absolute inset-0 size-full bg-transparent',
          isVertical && '[writing-mode:vertical-lr] [direction:rtl]',
          'cursor-pointer appearance-none accent-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
          // 滑块头
          '[&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow',
          '[&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary'
        )}
        {...props}
      />
    </span>
  );
}

export { Slider };
