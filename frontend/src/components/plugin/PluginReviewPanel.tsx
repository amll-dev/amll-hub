import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Clock, Package, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { queryKeys } from '@/lib/query';
import { formatBytes, formatDateTime } from '@/lib/format';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListPagination } from '@/components/ui/list-pagination';
import { UserAvatar } from '@/components/submission/UserAvatar';
import { UserDisplayName } from '@/components/submission/UserDisplayName';
import { PluginChannelBadge, PluginReviewBadge } from './shared';

const QUEUE_PAGE_SIZE = 50;

/** 插件审核状态筛选 */
const pluginReviewTabs = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审核' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '未通过' },
];

export function PluginReviewPanel() {
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);

  const queueQuery = useQuery({
    queryKey: queryKeys.pluginReviewQueue({ page, pageSize: QUEUE_PAGE_SIZE, q, status }),
    queryFn: () => api.pluginStore.reviewQueue({ page, pageSize: QUEUE_PAGE_SIZE, q, status }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

  const items = queueQuery.data?.items ?? [];
  const total = queueQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE));
  const errorMsg =
    queueQuery.error instanceof Error
      ? queueQuery.error.message
      : queueQuery.error
        ? '加载失败'
        : '';

  // 切换筛选或搜索词时回到第一页
  useEffect(() => {
    setPage(1);
  }, [status, q]);

  // 条目减少后当前页可能越界，自动收回
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={fadeUp} className="flex flex-wrap gap-2">
        {pluginReviewTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setStatus(t.key)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              status === t.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface-2 text-ink-2 hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </motion.div>

      <motion.div variants={fadeUp} className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-3" />
        <input
          type="text"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setQ(qInput.trim());
          }}
          placeholder="搜索插件名称或 ID"
          className="h-10 w-full rounded-md border border-input bg-surface-2 pr-4 pl-9 text-sm outline-none focus:border-primary"
        />
      </motion.div>

      <motion.div variants={fadeUp}>
        {errorMsg ? (
          <div className="rounded-md border border-line bg-surface-2 px-4 py-3 text-sm text-error">
            {errorMsg}
          </div>
        ) : queueQuery.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-md border border-line bg-card" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={Package} title="暂无插件" size="sm" />
        ) : (
          <>
            <p className="mb-2 text-xs text-ink-3">
              共 {total} 条 · 第 {page} / {totalPages} 页
            </p>
            <ul className="space-y-2">
              {items.map((item) => {
                const v = item.version;
                return (
                  <motion.li key={v.id} variants={fadeUp}>
                    <button
                      type="button"
                      onClick={() => {
                        window.open(
                          `/review/plugin?key=${encodeURIComponent(item.pluginKey)}`,
                          '_blank'
                        );
                      }}
                      className="flex w-full items-center justify-between gap-3 rounded-md border border-line bg-background px-4 py-3 text-left transition-colors hover:bg-surface-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 truncate font-medium text-foreground">
                            {item.pluginName}
                          </span>
                          <span className="shrink-0 font-mono text-xs text-ink-3">
                            v{v.version}
                          </span>
                          <PluginChannelBadge channel={v.channel} />
                          <PluginReviewBadge status={v.reviewStatus} />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                          <span>{item.pluginKey}</span>
                          <span className="text-line">|</span>
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <UserAvatar
                              avatar={v.submitterInfo?.avatar}
                              name={v.submitterInfo?.displayName || v.submittedBy}
                              size={14}
                            />
                            <span className="shrink-0">提交人</span>
                            <span className="truncate text-ink-2">
                              <UserDisplayName
                                displayName={v.submitterInfo?.displayName}
                                username={v.submittedBy}
                              />
                            </span>
                          </span>
                          <span className="text-line">|</span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDateTime(v.submittedAt)}
                          </span>
                          <span className="text-line">|</span>
                          <span>{formatBytes(v.sizeBytes)}</span>
                        </div>
                      </div>
                    </button>
                  </motion.li>
                );
              })}
            </ul>
            <ListPagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
