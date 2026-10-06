import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Check, ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { formatDateTime } from '@/lib/format';
import { computeRevisionDiff, type LineDiff, type RevisionDiff } from '@/lib/review/revision-diff';
import { parseTTML } from '@/lib/ttml-processor';
import type { SubmissionDetail } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { UserAvatar } from '@/components/submission/UserAvatar';
import { UserDisplayName } from '@/components/submission/UserDisplayName';

export interface RevisionConfirmCardProps {
  detail: SubmissionDetail;
  /** 是否为投稿者本人（决定能否确认采用） */
  isSubmitter: boolean;
  onDone: () => void;
}

/** 单行差异的可读展示 */
function LineDiffRow({ diff }: { diff: LineDiff }) {
  const kindMeta = {
    added: { label: '新增', cls: 'bg-green-100 text-green-700' },
    removed: { label: '删除', cls: 'bg-red-100 text-red-700' },
    modified: { label: '修改', cls: 'bg-amber-100 text-amber-700' },
    unchanged: { label: '未改', cls: 'bg-surface-2 text-ink-3' },
  }[diff.kind];

  const details: string[] = [];
  if (diff.textChanged) details.push('文本');
  if (diff.timingChanged) details.push(`时间轴 ${diff.shifts.length} 处`);
  details.push(...diff.featureChanges);

  const lineNo = diff.kind === 'removed' ? diff.originalIndex + 1 : (diff.revisedIndex ?? 0) + 1;

  return (
    <div className="flex items-start gap-2 border-b border-line/60 px-3 py-1.5 text-xs last:border-0">
      <Badge className={`shrink-0 text-[10px] ${kindMeta.cls}`}>{kindMeta.label}</Badge>
      <span className="w-12 shrink-0 text-right font-mono text-[10px] text-ink-3">{lineNo}</span>
      <span className="min-w-0 flex-1">
        {diff.kind !== 'added' && diff.textChanged && (
          <span className="mr-1 text-red-700 line-through">{diff.originalText}</span>
        )}
        {diff.kind !== 'removed' && (
          <span className={diff.textChanged ? 'mr-1 text-green-700' : ''}>{diff.revisedText}</span>
        )}
        {details.length > 0 && <span className="text-ink-3">（{details.join('、')}）</span>}
      </span>
    </div>
  );
}

// 计算原稿与修订版的行级差异
function useRevisionDiff(detail: SubmissionDetail): {
  diff: RevisionDiff | null;
  loading: boolean;
  failed: boolean;
} {
  const hasRevision = Boolean(detail.hasRevision);
  const [diff, setDiff] = useState<RevisionDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // 修订版原文
  const revisionQuery = useQuery({
    queryKey: queryKeys.revisionTtml(detail.id),
    queryFn: () => api.getRevisionTtml(detail.id),
    enabled: hasRevision,
    retry: false,
  });

  // 原稿原文
  const originalQuery = useQuery({
    queryKey: queryKeys.submissionTtml(detail.id),
    queryFn: () => api.getSubmissionTtml(detail.id),
    enabled: hasRevision,
    retry: false,
  });

  const originalTtml = originalQuery.data;
  const revisionTtml = revisionQuery.data;

  useEffect(() => {
    if (!hasRevision) {
      setDiff(null);
      return;
    }
    if (!originalTtml || !revisionTtml) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const [a, b] = await Promise.all([parseTTML(originalTtml), parseTTML(revisionTtml)]);
      if (cancelled) return;
      setLoading(false);
      if (!a.success || !b.success) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setDiff(computeRevisionDiff(a.data, b.data));
    })();
    return () => {
      cancelled = true;
    };
  }, [hasRevision, originalTtml, revisionTtml]);

  return { diff, loading, failed: failed || revisionQuery.isError };
}

// 审核员修订版确认区
export function RevisionConfirmCard({ detail, isSubmitter, onDone }: RevisionConfirmCardProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const { diff, loading, failed } = useRevisionDiff(detail);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.submission(detail.id) }),
      queryClient.invalidateQueries({ queryKey: ['submissions'] }),
    ]);

  const adoptMutation = useMutation({
    mutationFn: () => api.adoptRevision(detail.id),
    onSuccess: () => {
      toast.success('已采用审核员的歌词，投稿通过');
      void invalidate();
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
      void invalidate();
      onDone();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '操作失败'),
  });

  const changedLines = diff?.lines.filter((l) => l.kind !== 'unchanged') ?? [];
  const busy = adoptMutation.isPending || rejectMutation.isPending;
  const reviewerName = detail.revisionReviewerInfo?.displayName || detail.revisionReviewer;

  return (
    <div className="rounded-lg border border-purple-300 bg-purple-50/50 p-4">
      <div className="flex items-start gap-2">
        <ArrowRightLeft className="mt-0.5 size-5 shrink-0 text-purple-600" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-purple-900">审核员提交了修订版</h3>
            <Badge className="bg-purple-100 text-[10px] text-purple-700">待投稿者确认</Badge>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-purple-800">
            <UserAvatar
              avatar={detail.revisionReviewerInfo?.avatar}
              name={reviewerName}
              size={16}
            />
            <UserDisplayName
              displayName={detail.revisionReviewerInfo?.displayName}
              username={detail.revisionReviewer ?? ''}
            />
            <span className="text-purple-600/70">于 {formatDateTime(detail.revisionAt)} 修改</span>
          </p>
          <p className="mt-1.5 text-xs text-ink-2">
            {isSubmitter
              ? '审核员已帮你修正歌词与时间轴。确认采用后这份歌词将直接发布；保留你的版本则退回给审核员。'
              : '修订版已提交，等待投稿者确认。投稿者操作后状态会自动更新。'}
          </p>
        </div>
      </div>

      {/* 改动概览 */}
      {diff && (
        <div className="mt-3 grid grid-cols-2 gap-2 rounded border border-purple-200 bg-white/70 p-2.5 text-xs sm:grid-cols-4">
          {[
            ['改动行', diff.stats.modifiedLines],
            ['新增/删除', `${diff.stats.addedLines}/${diff.stats.removedLines}`],
            ['元数据改动', diff.metadata.length],
            ['待处理问题', diff.stats.problemLineCount],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <div className="text-ink-3">{label}</div>
              <div className="font-mono text-base text-purple-900">{value}</div>
            </div>
          ))}
        </div>
      )}

      {loading && <p className="mt-2 text-xs text-ink-3">正在解析两份歌词做对比…</p>}

      {failed && (
        <p className="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">
          修订版内容加载失败，无法展示逐行对比。审核报告仍可在下方评论区查看。
        </p>
      )}

      {/* 逐行对比 */}
      {!loading && !failed && changedLines.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-purple-800 hover:underline"
          >
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {expanded ? '收起逐行对比' : `展开逐行对比（${changedLines.length} 行改动）`}
          </button>
          {expanded && (
            <div className="mt-1.5 max-h-72 overflow-y-auto rounded border border-purple-200 bg-white">
              {changedLines.map((l, i) => (
                <LineDiffRow key={i} diff={l} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 元数据差异 */}
      {diff && diff.metadata.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-medium text-purple-900">元数据修正</div>
          <div className="space-y-0.5 rounded border border-purple-200 bg-white px-2.5 py-1.5 text-xs">
            {diff.metadata.map((m) => (
              <div key={m.field} className="flex flex-wrap items-baseline gap-1">
                <span className="text-ink-3">{m.label}：</span>
                <span className="text-red-700 line-through">{m.before}</span>
                <span className="text-ink-3">→</span>
                <span className="text-green-700">{m.after}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 操作区：只有投稿者能确认 */}
      {isSubmitter && (
        <div className="mt-4 border-t border-purple-200 pt-3">
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
                <X className="size-4" />
                保留我的版本
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
