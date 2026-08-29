import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { buttonTap } from '@/lib/motion';
import { UserAvatar } from '@/components/submission/UserAvatar';
import { UserDisplayName } from '@/components/submission/UserDisplayName';
import { CardDetailSkeleton } from '@/components/ui/Skeleton';
import type { SearchIpSubmissionDetail } from '@/lib/types';
import { Badge } from '@/components/ui/badge';

const statusMeta: Record<string, { label: string; className: string }> = {
  pending: { label: '待审核', className: 'bg-amber-100 text-amber-700' },
  approved: { label: '已通过', className: 'bg-green-100 text-green-700' },
  rejected: { label: '未通过', className: 'bg-red-100 text-red-700' },
};

/** 搜索IP投稿详情 */
export function SearchIpDetail({
  id,
  onBack,
  isReviewer = false,
}: {
  id: number;
  onBack: () => void;
  isReviewer?: boolean;
}) {
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState<'approve' | 'reject' | null>(null);
  const [reviewMsg, setReviewMsg] = useState('');

  const {
    data: detail,
    isPending: loading,
    error,
  } = useQuery({
    queryKey: queryKeys.searchIpSubmission(id),
    queryFn: () => api.getSearchIpSubmission(id),
    staleTime: 15_000,
  });
  const errorMsg = error instanceof Error ? error.message : error ? '加载失败' : '';

  const reviewMutation = useMutation({
    mutationFn: (action: 'approve' | 'reject') => api.reviewSearchIpSubmission(id, action),
    onMutate: (action) => {
      setReviewing(action);
      setReviewMsg('');
    },
    onSuccess: (_d, action) => {
      queryClient.setQueryData<SearchIpSubmissionDetail>(
        queryKeys.searchIpSubmission(id),
        (prev) =>
          prev ? { ...prev, status: action === 'approve' ? 'approved' : 'rejected' } : prev
      );
      setReviewMsg(action === 'approve' ? '已通过，将公开展示' : '已标记为不通过');
    },
    onError: (e) => setReviewMsg(e instanceof Error ? e.message : '操作失败'),
    onSettled: () => setReviewing(null),
  });
  const doReview = (action: 'approve' | 'reject') => {
    if (!detail || reviewing) return;
    reviewMutation.mutate(action);
  };

  // 通过文件名获取图片 URL
  const imgUrl = (fileName?: string) => {
    if (!fileName || !detail) return '';
    const key = detail.imageKeys?.[fileName];
    if (!key) return '';
    return api.searchIpImageUrl(key);
  };

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-primary"
      >
        ← 返回列表
      </button>

      {loading ? (
        <CardDetailSkeleton />
      ) : errorMsg ? (
        <p className="py-12 text-center text-sm text-error">{errorMsg}</p>
      ) : detail ? (
        <div className="rounded-lg border border-line bg-card p-6">
          {/* 标题与基本信息 */}
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold tracking-tight text-foreground">
              {detail.title || '未命名'}
            </h3>
            <span className="shrink-0 text-xs text-ink-3">#{detail.id}</span>
            {(() => {
              const meta = statusMeta[detail.status] ?? {
                label: detail.status,
                className: 'bg-surface-2 text-ink-2',
              };
              return (
                <Badge
                  variant="outline"
                  className={`shrink-0 border-transparent inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs`}
                >
                  {meta.label}
                </Badge>
              );
            })()}
          </div>
          {(() => {
            const si = (detail.submitterInfo ?? {}) as {
              name?: string;
              displayName?: string;
              avatar?: string;
            };
            return (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-3">
                <UserAvatar
                  avatar={si.avatar}
                  name={si.displayName || si.name || String(detail.submitter)}
                  size={20}
                />
                <strong className="text-ink-2">
                  <UserDisplayName displayName={si.displayName} username={si.name} />
                </strong>
                <span>于 {detail.createdAt} 提交</span>
                <span>· 更新于 {detail.updatedAt}</span>
              </div>
            );
          })()}

          {/* 团队与成员 */}
          <div className="mt-6 space-y-4">
            {Object.entries(detail.data.groups ?? {}).map(([groupName, group]) => (
              <div key={groupName} className="rounded-md border border-line bg-background p-4">
                {/* 团队 */}
                <div className="flex items-center gap-3">
                  {group.pictures && (
                    <img
                      src={imgUrl(group.pictures)}
                      alt={groupName}
                      loading="lazy"
                      decoding="async"
                      className="h-12 w-auto rounded bg-surface-2 object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 shrink-0 rounded-full"
                        style={{ background: group.color || '#ccc' }}
                      />
                      <span className="truncate font-semibold text-foreground">{groupName}</span>
                    </div>
                    {group.aliases && group.aliases.length > 0 && (
                      <p className="mt-0.5 truncate text-xs text-ink-3">
                        别名：{group.aliases.join(' / ')}
                      </p>
                    )}
                  </div>
                </div>

                {/* 成员 */}
                {group.members && group.members.length > 0 && (
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                    {group.members.map((member, idx) => (
                      <div
                        key={`${member.authors[0] ?? idx}`}
                        className="flex items-center gap-2 rounded border border-line bg-surface-2 p-2"
                      >
                        {member.pictures && (
                          <img
                            src={imgUrl(member.pictures)}
                            alt={member.authors[0] ?? ''}
                            loading="lazy"
                            decoding="async"
                            className="h-10 w-10 shrink-0 rounded-full object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">
                            {member.authors[0] ?? '未命名'}
                          </p>
                          {member.authors.length > 1 && (
                            <p className="truncate text-xs text-ink-3">
                              {member.authors.slice(1).join(' / ')}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 审核操作 */}
          {isReviewer && (
            <div className="mt-6 border-t border-line pt-4">
              <div className="flex flex-wrap items-center justify-end gap-3">
                {reviewMsg && <span className="mr-auto text-xs text-ink-3">{reviewMsg}</span>}
                <motion.button
                  type="button"
                  {...buttonTap}
                  onClick={() => doReview('approve')}
                  disabled={reviewing !== null || detail.status !== 'pending'}
                  title={detail.status !== 'pending' ? '仅待审核状态可执行' : undefined}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-green-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                >
                  {reviewing === 'approve' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  通过
                </motion.button>
                <motion.button
                  type="button"
                  {...buttonTap}
                  onClick={() => doReview('reject')}
                  disabled={reviewing !== null || detail.status !== 'pending'}
                  title={detail.status !== 'pending' ? '仅待审核状态可执行' : undefined}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {reviewing === 'reject' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                  不通过
                </motion.button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
