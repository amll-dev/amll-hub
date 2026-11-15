import { useNavigate } from 'react-router-dom';
import {
  CircleCheck,
  FileCheck,
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
  // revised：审核员已改好，等投稿者确认 → 用 FileCheck（待采纳的文件）
  // ⚠️ 以前没这个键，会退化成通用的 ShieldCheck，看不出是哪种结果。
  revised: FileCheck,
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
    // 行主体与删除按钮是同级按钮，避免交互元素嵌套（role="button" 里再嵌 button）
    <div className="group relative">
      <button
        type="button"
        onClick={handleClick}
        className="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
      >
        {/* button 内只能用 phrasing content，容器统一用 span + display 类 */}
        <span
          className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            message.read ? 'bg-surface-2 text-ink-3' : 'bg-primary/10 text-primary'
          )}
        >
          <Icon className="h-4 w-4" />
        </span>

        <span className="block min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={cn(
                'block truncate text-sm',
                message.read ? 'text-ink-2' : 'font-medium text-foreground'
              )}
            >
              {message.title}
            </span>
            {/* 悬停时不再让位：删除按钮有独立槽位 */}
            <span className="shrink-0 text-[11px] text-ink-3">
              {formatRelativeTime(message.createdAt)}
            </span>
          </span>
          {/* whitespace-pre-line：公告正文允许换行，单行消息不受影响 */}
          <span className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs leading-relaxed text-ink-3">
            {message.content}
          </span>
          {message.action && (
            <span className="mt-1 inline-block text-xs font-medium text-primary">
              {message.action.label} →
            </span>
          )}
        </span>

        {/* 右侧固定槽位：未读红点（悬停时让位给删除按钮） */}
        <span className="relative mt-0.5 block h-5 w-5 shrink-0">
          {!message.read && (
            <span
              className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-primary transition-opacity group-hover:opacity-0"
              aria-label="未读"
            />
          )}
        </span>
      </button>

      <button
        type="button"
        aria-label={`删除消息：${message.title}`}
        onClick={() => onDelete(message)}
        className="absolute right-4 top-3.5 flex h-5 w-5 items-center justify-center rounded-sm text-ink-3 opacity-0 transition-opacity hover:text-destructive focus:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
