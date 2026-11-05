import { UserAvatar } from '@/components/submission/UserAvatar';
import type { LyricRequest } from '@/lib/types';

interface SupporterAvatarsProps {
  supporters: LyricRequest['supporters'];
  supportCount: number;
  /** 最多展示几个头像 */
  max?: number;
  size?: number;
  /** 卡片上的紧凑叠放样式 */
  overlapping?: boolean;
  className?: string;
}

/** 请愿支持者头像组 */
export function SupporterAvatars({
  supporters,
  supportCount,
  max,
  size = 20,
  overlapping = false,
  className,
}: SupporterAvatarsProps) {
  const shown = max ? supporters.slice(0, max) : supporters;
  const remaining = supportCount - shown.length;

  return (
    <div className={className ?? `flex items-center ${overlapping ? '-space-x-1.5' : 'gap-2'}`}>
      {shown.map((s) => (
        <span
          key={s.name}
          title={s.displayName || s.name}
          className={`rounded-full ${overlapping ? 'ring-2 ring-card' : 'ring-1 ring-line'}`}
        >
          <UserAvatar avatar={s.avatar} name={s.displayName || s.name} size={size} />
        </span>
      ))}
      {remaining > 0 &&
        (overlapping ? (
          <span className="flex h-5 items-center rounded-full bg-surface-2 px-1.5 text-[10px] text-ink-3 ring-2 ring-card">
            +{remaining}
          </span>
        ) : (
          <span className="text-xs text-ink-3">+{remaining}</span>
        ))}
    </div>
  );
}
