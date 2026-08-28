import { useMemo } from 'react';
import { UserAvatar } from '@/components/submission/UserAvatar';
import { UserDisplayName } from '@/components/submission/UserDisplayName';
import { formatTime, renderMarkdown } from '@/components/submission/shared';
import type { SubmissionComment } from '@/lib/types';

/** 评论列表项 */
export function CommentItem({ c, isLast }: { c: SubmissionComment; isLast: boolean }) {
  const html = useMemo(() => renderMarkdown(c.content), [c.content]);

  return (
    <li className="relative pl-10" style={{ marginBottom: isLast ? 0 : 16 }}>
      {/* 时间线竖线 */}
      <div className="absolute left-0 top-0 w-0.5 bg-line" style={{ bottom: isLast ? 0 : -16 }} />
      {/* 时间线节点 */}
      <div className="absolute left-0 top-3 z-10 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-card bg-ink-3 shadow-[0_0_0_1px_var(--amll-line)]" />
      <div className="rounded-md border border-line bg-surface-2 p-3">
        <div className="mb-2 flex items-center gap-2">
          <UserAvatar
            avatar={c.author.avatar}
            name={c.author.displayName || c.author.username}
            size={32}
          />
          <div className="flex-1">
            <div className="text-sm font-semibold text-foreground">
              <UserDisplayName displayName={c.author.displayName} username={c.author.username} />
            </div>
            <div className="text-xs text-ink-3">{formatTime(c.createdAt)}</div>
          </div>
        </div>
        {/* Markdown 渲染内容 */}
        <div
          className="comment-markdown ml-10 text-sm leading-relaxed text-foreground"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </li>
  );
}
