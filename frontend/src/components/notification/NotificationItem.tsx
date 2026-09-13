import { useNavigate } from 'react-router-dom';
import {
  CircleCheck,
  FilePlus2,
  Megaphone,
  MessageSquare,
  Music,
  PencilLine,
  ShieldCheck,
  TimerOff,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { Message, MessageType, ReviewResult } from '@/lib/types';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/** 类型 → 图标 */
const typeIcons: Record<MessageType, LucideIcon> = {
  system: Megaphone,
  review: ShieldCheck,
  submission: FilePlus2,
  comment: MessageSquare,
};

/** 审核结果 → 图标（type=review 时优先按结果细分，比统一的盾牌更直观） */
const reviewResultIcons: Record<ReviewResult, LucideIcon> = {
  approved: CircleCheck,
  rejected: XCircle,
  need_revision: PencilLine,
  missing_audio: Music,
  closed: TimerOff,
};

/** 取本条消息的图标：审核类按 result 细分，其余按 type */
function iconOf(message: Message): LucideIcon {
  if (message.type === 'review' && message.result) {
    return reviewResultIcons[message.result] ?? ShieldCheck;
  }
  return typeIcons[message.type] ?? Megaphone;
}

/**
 * 单条消息行。
 * 点击：乐观已读（由父组件 mutate）+ 跳转 action.path；
 * 悬停右上角出现删除按钮。
 */
export function NotificationItem({
  message,
  onRead,
  onDelete,
}: {
  message: Message;
  onRead: (m: Message) => void;
  onDelete: (m: Message) => void;
}) {
  const navigate = useNavigate();
  const Icon = iconOf(message);

  const handleClick = () => {
    onRead(message);
    if (message.action?.path) navigate(message.action.path);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      className="group relative flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-none"
    >
      <div
        className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          message.read ? 'bg-surface-2 text-ink-3' : 'bg-primary/10 text-primary'
        )}
      >
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p
            className={cn(
              'truncate text-sm',
              message.read ? 'text-ink-2' : 'font-medium text-foreground'
            )}
          >
            {message.title}
          </p>
          {/* 悬停时不再让位：删除按钮有独立槽位 */}
          <span className="shrink-0 text-[11px] text-ink-3">
            {formatRelativeTime(message.createdAt)}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink-3">
          {message.content}
        </p>
        {message.action && (
          <span className="mt-1 inline-block text-xs font-medium text-primary">
            {message.action.label} →
          </span>
        )}
      </div>

      {/* 右侧固定槽位：未读红点与删除按钮共位，悬停时红点让位（两者不再叠在一起） */}
      <div className="relative mt-0.5 h-5 w-5 shrink-0">
        {!message.read && (
          <span
            className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-primary transition-opacity group-hover:opacity-0"
            aria-label="未读"
          />
        )}
        <button
          type="button"
          aria-label="删除消息"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(message);
          }}
          className="absolute inset-0 flex items-center justify-center rounded-sm text-ink-3 opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
