import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SubmissionStatus } from '@/lib/types';
import { langListText, statusMeta } from './status';

/** 列表行只需要这几个字段，够 SubmissionListItem / PublicSubmissionItem 共用 */
export interface SubmissionRowItem {
  id: number;
  title: string;
  language?: string;
  languages?: string[];
  status: SubmissionStatus | string;
  createdAt: string;
}

export interface SubmissionRowProps {
  item: SubmissionRowItem;
  /** 传了才可点；公开主页的访客视角没有公开详情页，不要传 */
  href?: string;
  /** 是否显示状态徽章（访客视角全是 approved，可以关掉） */
  showStatus?: boolean;
  className?: string;
}

const rowClass =
  'flex w-full items-center justify-between gap-3 rounded-md border border-line bg-background px-4 py-3 text-left transition-colors';
const interactiveClass = 'hover:bg-surface-2';

/** 投稿列表行 */
export function SubmissionRow({ item, href, showStatus = true, className }: SubmissionRowProps) {
  const meta = statusMeta[item.status] ?? {
    label: item.status,
    className: 'bg-surface-2 text-ink-2',
  };

  const content = (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="truncate font-medium text-foreground">{item.title || '未命名'}</span>
        <span className="shrink-0 text-xs text-ink-3">#{item.id}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <span>{formatDateTime(item.createdAt)}</span>
        {showStatus && (
          <>
            <span className="text-line">|</span>
            <Badge
              variant="outline"
              className={cn(
                'inline-flex shrink-0 items-center rounded-full border-transparent px-2 py-0.5 text-xs font-medium',
                meta.className
              )}
            >
              {meta.label}
            </Badge>
          </>
        )}
        <span className="text-line">|</span>
        <span>语言：{langListText(item.languages, item.language)}</span>
      </div>
    </div>
  );

  return (
    <li className={className}>
      {href ? (
        <Link to={href} target="_blank" rel="noreferrer" className={cn(rowClass, interactiveClass)}>
          {content}
        </Link>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </li>
  );
}
