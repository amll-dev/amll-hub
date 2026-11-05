import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, Search, ScrollText } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { useAuth } from '@/hooks/useAuth';
import { motion } from 'framer-motion';
import { buttonTap, fadeUp, staggerContainer } from '@/lib/motion';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { RequestCard } from './RequestCard';
import type { LyricRequestStatus } from '@/lib/types';

const PAGE_SIZE = 12;

const statusOptions: { key: LyricRequestStatus | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待处理' },
  { key: 'completed', label: '已完成' },
];

const sortOptions = [
  { key: 'latest' as const, label: '最新' },
  { key: 'hot' as const, label: '最热' },
];

/** 歌词请愿列表：scope=all 全站 / scope=mine 我发起的 */
export function RequestList({
  scope = 'all',
  onCreate,
}: {
  scope?: 'all' | 'mine';
  onCreate?: () => void;
}) {
  const navigate = useNavigate();
  const { user, openLogin } = useAuth();
  const [status, setStatus] = useState<LyricRequestStatus | 'all'>('all');
  const [sort, setSort] = useState<'latest' | 'hot'>('latest');
  const [keyword, setKeyword] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const params = {
    status: status === 'all' ? undefined : status,
    q: q || undefined,
    page,
    pageSize: PAGE_SIZE,
  };

  const { data, isLoading, isError, error } = useQuery({
    queryKey:
      scope === 'mine'
        ? queryKeys.lyricRequestsMine(params)
        : queryKeys.lyricRequests({ ...params, sort }),
    queryFn: () =>
      scope === 'mine'
        ? api.listMyLyricRequests(params)
        : api.listLyricRequests({ ...params, sort }),
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  const goCreate = () => {
    if (!user) {
      openLogin('/creator?tab=requests');
      return;
    }
    if (onCreate) onCreate();
    else navigate('/creator?tab=requests');
  };

  const resetTo = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className={scope === 'all' ? 'space-y-5' : 'space-y-4'}
    >
      {scope === 'all' && (
        <motion.div variants={fadeUp} className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">歌词请愿</h2>
          </div>
          <motion.button
            type="button"
            onClick={goCreate}
            {...buttonTap}
            className={buttonVariants({ size: 'sm' })}
          >
            <Plus className="mr-1 h-4 w-4" />
            发起请愿
          </motion.button>
        </motion.div>
      )}

      {/* 筛选栏 */}
      <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-2">
        <Segmented
          options={statusOptions}
          value={status}
          onChange={(v) => resetTo(() => setStatus(v))}
          layoutId="request-status-pill"
        />

        {scope === 'all' && (
          <Segmented
            options={sortOptions}
            value={sort}
            onChange={(v) => resetTo(() => setSort(v))}
            layoutId="request-sort-pill"
          />
        )}

        <form
          className="relative ml-auto w-full sm:w-56"
          onSubmit={(e) => {
            e.preventDefault();
            resetTo(() => setQ(keyword.trim()));
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索歌名 / 歌手 / 专辑"
            className="h-8 pl-8 text-sm"
          />
        </form>

        {scope === 'mine' && (
          <button
            type="button"
            onClick={goCreate}
            className={buttonVariants({ size: 'sm', className: 'h-8' })}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            发起请愿
          </button>
        )}
      </motion.div>

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : isError ? (
        <EmptyState
          icon={ScrollText}
          title="请愿列表加载失败"
          description={error instanceof Error ? error.message : '请稍后重试'}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={scope === 'mine' ? '你还没有发起过请愿' : '还没有人发起请愿'}
          description={
            scope === 'mine'
              ? '找不到想听的歌的歌词？发起一条请愿吧'
              : '成为第一个发起请愿的人，让更多人一起支持'
          }
          action={
            <button type="button" onClick={goCreate} className={buttonVariants({ size: 'sm' })}>
              <Plus className="mr-1 h-4 w-4" />
              发起请愿
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <motion.div key={item.id} variants={fadeUp}>
              <RequestCard request={item} />
            </motion.div>
          ))}
        </div>
      )}

      {!isLoading && items.length > 0 && totalPages > 1 && (
        <motion.div
          variants={fadeUp}
          className="flex items-center justify-between pt-1 text-xs text-ink-3"
        >
          <span>
            共 {data?.total ?? 0} 条 · 第 {page} / {totalPages} 页
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={buttonVariants({
                variant: 'outline',
                size: 'sm',
                className: 'h-7 px-2',
              })}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className={buttonVariants({
                variant: 'outline',
                size: 'sm',
                className: 'h-7 px-2',
              })}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  layoutId,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  layoutId: string;
}) {
  return (
    <div className="flex rounded-md border border-line p-0.5">
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`relative rounded px-2.5 py-1 text-xs transition-colors ${
              active ? 'font-medium text-primary' : 'text-ink-2 hover:text-foreground'
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded bg-primary-soft"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <span className="relative">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
