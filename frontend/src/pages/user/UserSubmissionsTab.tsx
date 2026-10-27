import { useMemo, useState } from 'react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { useSentinel } from '@/hooks/useSentinel';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { SubmissionRow } from '@/components/submission/SubmissionRow';
import { cn } from '@/lib/utils';
import type { PublicSubmissionList, UserSubmissionSort } from '@/lib/types';

const PAGE_SIZE = 20;

/** 本人可见的状态筛选（访客固定 approved，不展示这一行） */
const STATUS_TABS: { value: string; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'approved', label: '已通过' },
  { value: 'pending', label: '待审核' },
  { value: 'reviewing', label: '审核中' },
  { value: 'revised', label: '待投稿者确认' },
  { value: 'need_revision', label: '需修改' },
  { value: 'missing_audio', label: '缺音频' },
  { value: 'rejected', label: '未通过' },
  { value: 'draft', label: '草稿' },
  { value: 'closed', label: '已关闭' },
];

const LANG_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '全部语言' },
  { value: 'zh', label: '汉语' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
  { value: 'others', label: '其他' },
];

const SORT_OPTIONS: { value: UserSubmissionSort; label: string }[] = [
  { value: 'newest', label: '最新发布' },
  { value: 'oldest', label: '最早发布' },
  { value: 'updated', label: '最近更新' },
];

/** 主页 Tab：完整投稿列表 */
export function UserSubmissionsTab({ name, isSelf }: { name: string; isSelf: boolean }) {
  const [status, setStatus] = useState('all');
  const [language, setLanguage] = useState('');
  const [sort, setSort] = useState<UserSubmissionSort>('newest');

  // 访客无论怎么点都只能看到 approved（后端也会强制覆盖）
  const effectiveStatus = isSelf ? status : 'approved';

  const listKey = queryKeys.userSubmissions(name, {
    status: effectiveStatus,
    language,
    sort,
    limit: PAGE_SIZE,
  });

  const listQuery = useInfiniteQuery({
    queryKey: listKey,
    queryFn: ({ pageParam }) =>
      api.getUserSubmissions(name, {
        status: effectiveStatus,
        language: language || undefined,
        sort,
        page: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: (last: PublicSubmissionList, all) => {
      const fetched = all.reduce((n, p) => n + (p.items?.length ?? 0), 0);
      if (typeof last.total === 'number' && last.total > 0) {
        return fetched < last.total ? all.length + 1 : undefined;
      }
      return (last.items?.length ?? 0) < PAGE_SIZE ? undefined : all.length + 1;
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const items = useMemo(
    () => listQuery.data?.pages.flatMap((p) => p.items ?? []) ?? [],
    [listQuery.data]
  );
  const total = listQuery.data?.pages[0]?.total ?? 0;
  const errorMsg =
    listQuery.error instanceof Error ? listQuery.error.message : listQuery.error ? '加载失败' : '';

  const loadMore = () => {
    if (listQuery.hasNextPage && !listQuery.isFetchingNextPage) {
      void listQuery.fetchNextPage();
    }
  };
  const sentinelRef = useSentinel(loadMore, listQuery.hasNextPage === true && !errorMsg);

  return (
    <div className="space-y-4">
      {isSelf && (
        <ChipRow options={STATUS_TABS} value={status} onChange={(v) => setStatus(v || 'all')} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ChipRow options={LANG_OPTIONS} value={language} onChange={setLanguage} size="sm" />
        <ChipRow
          options={SORT_OPTIONS}
          value={sort}
          onChange={(v) => setSort((v || 'newest') as UserSubmissionSort)}
          size="sm"
        />
      </div>

      {!isSelf && <p className="text-xs text-ink-3">仅展示已通过审核的投稿</p>}

      <div className="flex items-center justify-between text-xs text-ink-3">
        <span>共 {total} 篇</span>
      </div>

      {listQuery.isPending ? (
        <ListSkeleton rows={6} />
      ) : errorMsg ? (
        <p className="rounded-lg border border-line bg-card px-4 py-8 text-center text-sm text-error">
          {errorMsg}
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={isSelf ? '还没有投稿' : '暂无公开投稿'}
          description={
            isSelf ? '换个筛选条件试试，或去创作中心新建投稿' : '该用户还没有通过审核的投稿'
          }
        />
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((item) => (
              <SubmissionRow
                key={item.id}
                item={item}
                showStatus={isSelf}
                href={isSelf ? `/creator/lyrics/detail?id=${item.id}` : undefined}
              />
            ))}
          </ul>

          {(listQuery.hasNextPage || listQuery.isFetchingNextPage) && (
            <div ref={sentinelRef} className="pt-2 text-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={!listQuery.hasNextPage || listQuery.isFetchingNextPage}
                className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-card px-5 text-sm text-ink-2 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {listQuery.isFetchingNextPage ? '加载中…' : '加载更多'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 胶囊筛选条 */
function ChipRow({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value || '__all__'}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1 text-xs',
            value === o.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-surface-2 text-ink-2 hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
