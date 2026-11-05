import { Link } from 'react-router-dom';
import { CheckCircle2, Heart, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '@/components/submission/UserAvatar';
import { formatCount, formatRelativeTime } from '@/lib/format';
import type { LyricRequest } from '@/lib/types';
import {
  providedPlatforms,
  requesterIdentity,
  requestDisplayStatus,
} from './shared';
import { SupporterAvatars } from './SupporterAvatars';

/** 请愿卡片 */
export function RequestCard({
  request,
  compact = false,
}: {
  request: LyricRequest;
  compact?: boolean;
}) {
  const meta = requestDisplayStatus(request);
  const provided = providedPlatforms(request);
  const { name: requesterName, avatar: requesterAvatar } = requesterIdentity(request);

  return (
    <Link
      to={`/creator/requests/${request.id}`}
      className="group block rounded-lg border border-line bg-card p-4 transition-colors hover:border-primary/40 hover:bg-surface-2/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold tracking-tight text-foreground group-hover:text-primary">
              {request.songName}
            </h3>
            <Badge variant={meta.variant}>{meta.label}</Badge>
          </div>
          <p className="mt-1 truncate text-sm text-ink-2">
            {request.artist}
            {request.album ? ` · ${request.album}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs text-ink-3">
          <span className="flex items-center gap-1">
            <Heart className={`h-3.5 w-3.5 ${request.supported ? 'text-primary' : ''}`} />
            {formatCount(request.supportCount)}
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" />
            {formatCount(request.commentCount)}
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {provided.length === 0 ? (
          <span className="text-xs text-ink-3">未填写平台 ID</span>
        ) : (
          provided.map((p) => (
            <span
              key={p.key}
              className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-3"
            >
              {p.short}
            </span>
          ))
        )}
        {request.hasAppleTtml && <span className="text-[11px] text-ink-3">· Apple Music 逐词</span>}
        {request.requestCount > 1 && (
          <span className="text-[11px] text-ink-3">· {request.requestCount} 次请愿</span>
        )}
      </div>

      {!compact && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
          <div className="flex min-w-0 items-center gap-2">
            <UserAvatar avatar={requesterAvatar} name={requesterName} size={20} />
            <span className="truncate text-xs text-ink-3">{requesterName}</span>
            <span className="text-xs text-ink-3">· {formatRelativeTime(request.createdAt)}</span>
          </div>
          {request.supporters.length > 0 && (
            <SupporterAvatars
              supporters={request.supporters}
              supportCount={request.supportCount}
              max={5}
              size={20}
              overlapping
              className="flex -space-x-1.5"
            />
          )}
        </div>
      )}

      {request.status === 'completed' && (
        <p className="mt-2 flex items-center gap-1 text-xs text-green-600">
          <CheckCircle2 className="h-3.5 w-3.5" />
          这首歌的歌词已完成
        </p>
      )}
    </Link>
  );
}
