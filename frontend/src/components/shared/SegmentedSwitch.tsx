import { useId } from 'react';
import { motion } from 'framer-motion';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedSwitchProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** sm 用于表单内嵌，默认用于页面级切换 */
  size?: 'sm' | 'md';
  className?: string;
}

/** 带滑块动画的分段切换控件 */
export function SegmentedSwitch<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className,
}: SegmentedSwitchProps<T>) {
  const layoutId = `segmented-${useId()}`;

  return (
    <div className={`flex items-center gap-1 rounded-lg bg-surface-2 p-1 ${className ?? ''}`}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`relative rounded-md font-medium transition-colors ${
              size === 'sm' ? 'px-3 py-1 text-xs' : 'px-3 py-1.5 text-sm'
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-md bg-card shadow-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{
                  layout: { type: 'spring', stiffness: 380, damping: 30 },
                  opacity: { duration: 0.2 },
                }}
              />
            )}
            <span
              className={`relative z-10 transition-colors ${
                active ? 'text-primary' : 'text-ink-2 hover:text-foreground'
              }`}
            >
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
