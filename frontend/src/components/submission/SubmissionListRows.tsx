import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { FirstSubmissionBadge } from './FirstSubmissionBadge';
import { RevisionBadge } from './RevisionBadge';
import { UserAvatar } from './UserAvatar';
import { UserDisplayName } from './UserDisplayName';
import { langText, statusMeta } from './status';
import { fadeUp } from '@/lib/motion';
import { formatDateTime } from '@/lib/format';
import type { SubmissionListItem } from '@/lib/types';

/**
 * 投稿列表行（审核中心 / 创作中心共用）。
 *
 * 两处原本各有一份 ~120 行的列表渲染，差异只有「是否显示投稿人」和
 * 「是否显示当前审核人」，其余结构完全一致；抽出来后改样式不用改两遍。
 */
export function SubmissionListRows({
  items,
  onOpen,
  /** 审核视角：显示投稿人（先看是谁投的） */
  showSubmitter = false,
  /** 审核视角：显示「审核中」时的占用者，避免重复劳动 */
  showReviewer = false,
}: {
  items: SubmissionListItem[];
  onOpen: (id: number) => void;
  showSubmitter?: boolean;
  showReviewer?: boolean;
}) {
  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const meta = statusMeta[item.status] ?? {
          label: item.status,
          className: 'bg-surface-2 text-ink-2',
        };
        return (
          <motion.li key={item.id} variants={fadeUp}>
            <button
              type="button"
              onClick={() => onOpen(item.id)}
              className="flex w-full items-center justify-between gap-3 rounded-md border border-line bg-background px-4 py-3 text-left transition-colors hover:bg-surface-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {item.title || '未命名'}
                  </span>
                  {item.isFirstSubmission && <FirstSubmissionBadge />}
                  {item.submissionType === 'revision' && <RevisionBadge />}
                  <span className="shrink-0 text-xs text-ink-3">#{item.id}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <span>{formatDateTime(item.createdAt)}</span>
                  <span className="text-line">|</span>
                  <Badge
                    variant="outline"
                    className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${meta.className} border-transparent`}
                  >
                    {meta.label}
                  </Badge>
                  {showSubmitter && (
                    <>
                      <span className="text-line">|</span>
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <UserAvatar
                          avatar={item.submitterInfo?.avatar}
                          name={item.submitterInfo?.displayName || item.submitter}
                          size={14}
                        />
                        <span className="shrink-0">投稿人</span>
                        <span className="truncate text-ink-2">
                          <UserDisplayName
                            displayName={item.submitterInfo?.displayName}
                            username={item.submitter}
                          />
                        </span>
                      </span>
                    </>
                  )}
                  {showReviewer && item.status === 'reviewing' && item.reviewer && (
                    <>
                      <span className="text-line">|</span>
                      <span className="inline-flex items-center gap-1 text-primary">
                        <UserAvatar
                          avatar={item.reviewerInfo?.avatar}
                          name={item.reviewerInfo?.displayName || item.reviewer}
                          size={14}
                        />
                        <span className="shrink-0">审核人</span>
                        <UserDisplayName
                          displayName={item.reviewerInfo?.displayName}
                          username={item.reviewer}
                        />
                      </span>
                    </>
                  )}
                  <span className="text-line">|</span>
                  <span>语言：{langText(item.language)}</span>
                </div>
              </div>
            </button>
          </motion.li>
        );
      })}
    </ul>
  );
}
