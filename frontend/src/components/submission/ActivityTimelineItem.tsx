import { UserAvatar } from '@/components/submission/UserAvatar';
import type { ActivityEntry } from '@/components/submission/shared';
import { formatDateTime } from '@/lib/format';

/** 活动时间线项 */
export function ActivityTimelineItem({ entry, isLast }: { entry: ActivityEntry; isLast: boolean }) {
  const Icon = entry.icon;
  return (
    <li className="relative pl-10" style={{ marginBottom: isLast ? 0 : 16 }}>
      <div className="absolute left-0 top-0 w-0.5 bg-line" style={{ bottom: isLast ? 0 : -16 }} />
      <div className="absolute left-0 top-3 z-10 flex h-2.5 w-2.5 -translate-x-1/2 items-center justify-center rounded-full border-2 border-card bg-primary shadow-[0_0_0_1px_var(--amll-primary)]" />
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
        {entry.actor && (
          <UserAvatar avatar={entry.actor.avatar} name={entry.actor.displayName} size={16} />
        )}
        {entry.actor && (
          <span className="text-sm font-medium text-foreground">
            {entry.actor.displayName}
            {entry.actor.displayName !== entry.actor.username ? `@${entry.actor.username}` : ''}
          </span>
        )}
        <span className="text-sm text-ink-2">{entry.label}</span>
        <span className="ml-auto shrink-0 text-xs text-ink-3">
          {formatDateTime(entry.timestamp)}
        </span>
      </div>
    </li>
  );
}
