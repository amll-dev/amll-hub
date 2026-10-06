import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { UserAvatar } from '@/components/submission/UserAvatar';
import { UserDisplayName } from '@/components/submission/UserDisplayName';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { SubmissionDetail } from '@/lib/types';

export interface RevisionConfirmInlineProps {
  detail: SubmissionDetail;
  isSubmitter: boolean;
  onDone: () => void;
}

export function RevisionConfirmInline({ detail, isSubmitter, onDone }: RevisionConfirmInlineProps) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [kept, setKept] = useState(false);

  const adoptMutation = useMutation({
    mutationFn: () => api.adoptRevision(detail.id),
    onSuccess: () => {
      toast.success('已采用审核员的歌词，投稿通过');
      onDone();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '操作失败'),
  });

  const rejectMutation = useMutation({
    mutationFn: () => api.rejectRevision(detail.id, reason),
    onSuccess: () => {
      toast.success('已保留你的版本，投稿转为需修改');
      setRejecting(false);
      setReason('');
      setKept(true);
      onDone();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '操作失败'),
  });

  const busy = adoptMutation.isPending || rejectMutation.isPending;
  const reviewerName = detail.revisionReviewerInfo?.displayName || detail.revisionReviewer;

  if (kept) {
    return (
      <li className="relative pl-10" style={{ marginBottom: 16 }}>
        <div className="absolute left-0 top-0 w-0.5 bg-line" style={{ bottom: -16 }} />
        <div className="absolute left-0 top-3 z-10 flex h-2.5 w-2.5 -translate-x-1/2 items-center justify-center rounded-full border-2 border-card bg-primary shadow-[0_0_0_1px_var(--amll-primary)]" />
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2">
          <span className="text-sm text-ink-2">
            你选择保留原版，投稿已转为
            <span className="mx-1 font-medium text-foreground">需修改</span>
            ——按审核员的意见调整后可重新提交。
          </span>
        </div>
      </li>
    );
  }

  return (
    <li className="relative pl-10" style={{ marginBottom: 16 }}>
      <div className="absolute left-0 top-0 w-0.5 bg-line" style={{ bottom: -16 }} />
      <div className="absolute left-0 top-3 z-10 flex h-2.5 w-2.5 -translate-x-1/2 items-center justify-center rounded-full border-2 border-card bg-primary shadow-[0_0_0_1px_var(--amll-primary)]" />

      <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <UserAvatar avatar={detail.revisionReviewerInfo?.avatar} name={reviewerName} size={16} />
          <span className="text-sm font-medium text-foreground">
            <UserDisplayName
              displayName={detail.revisionReviewerInfo?.displayName}
              username={detail.revisionReviewer ?? ''}
            />
          </span>
          <span className="text-sm text-ink-2">提交了修订版，待你确认</span>
          <span className="ml-auto shrink-0 text-xs text-ink-3">
            {formatDateTime(detail.revisionAt)}
          </span>
        </div>

        <p className="mt-1.5 text-xs text-ink-2">
          {isSubmitter
            ? '确认采用后这份歌词将直接发布；保留你的版本则需要你更新修改后的歌词。'
            : '修订版已提交，等待投稿者确认。投稿者操作后状态会自动更新。'}
        </p>

        {/* 操作区 */}
        {isSubmitter ? (
          <div className="mt-2.5">
            {rejecting ? (
              <div className="space-y-2">
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="保留原版本的原因（可选）"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => rejectMutation.mutate()} disabled={busy}>
                    {rejectMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                    确认保留我的版本
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                    取消
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => adoptMutation.mutate()}
                  disabled={busy}
                  title="确认采用后这份歌词将直接发布"
                >
                  {adoptMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  采用审核员的版本
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRejecting(true)}
                  disabled={busy}
                >
                  保留我的版本
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-2.5 text-xs text-ink-3">只有投稿者本人可以确认采用或保留自己的版本。</p>
        )}
      </div>
    </li>
  );
}
