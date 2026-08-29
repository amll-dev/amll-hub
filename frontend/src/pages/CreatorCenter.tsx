import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAtom } from 'jotai';
import {
  contentTabAtom,
  resetCreatorCenter,
  submitTabAtom,
  viewAtom,
  type ContentMainTab,
  type SubmitTab,
} from '@/atoms/creatorCenter';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  FileText,
  FolderOpen,
  Home,
  LayoutDashboard,
  Search,
  Upload,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { buttonTap, fadeUp, staggerContainer } from '@/lib/motion';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { useSentinel } from '@/hooks/useSentinel';
import { parseMarkupText } from '@/lib/markup';
import { useSubmissionListSync } from '@/hooks/useSubmissionListSync';
import { NavItem } from '@/components/NavItem';
import { buttonVariants } from '@/components/ui/button';
import { CardDetailSkeleton, ListSkeleton } from '@/components/ui/Skeleton';
import { LyricSubmitForm } from '@/components/creator/LyricSubmitForm';
import { DailyRecommendForm } from '@/components/creator/DailyRecommendForm';
import { SearchIpForm } from '@/components/creator/SearchIpForm';
import { SearchIpDetail } from '@/components/creator/SearchIpDetail';
import type { SubmissionListItem, SubmissionListResult } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

/** 歌词管理列表分页大小（无限滚动） */
const LIST_PAGE_SIZE = 20;

const submitTabs: { key: SubmitTab; label: string }[] = [
  { key: 'lyrics', label: '歌词投稿' },
  { key: 'daily', label: '每日推荐投稿' },
  { key: 'search-ip', label: '搜索IP显示投稿' },
];

const submitMenuOptions: { key: SubmitTab; label: string; icon: typeof FileText }[] = [
  { key: 'lyrics', label: '歌词投稿', icon: FileText },
  { key: 'daily', label: '每日推荐投稿', icon: CalendarDays },
  { key: 'search-ip', label: '搜索IP显示投稿', icon: Search },
];

// 内容管理主 tab
const contentMainTabs: { key: ContentMainTab; label: string }[] = [
  { key: 'lyrics', label: '歌词管理' },
  { key: 'daily', label: '每日推荐管理' },
  { key: 'search-ip', label: '搜索IP管理' },
];

// 歌词管理下的状态筛选
type LyricsStatusTab = 'all' | 'draft' | 'processing' | 'approved' | 'rejected';

const lyricsStatusTabs: { key: LyricsStatusTab; label: string }[] = [
  { key: 'all', label: '全部稿件' },
  { key: 'draft', label: '草稿' },
  { key: 'processing', label: '进行中' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '未通过' },
];

// 状态
const statusMeta: Record<string, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'bg-surface-2 text-ink-2' },
  pending: { label: '待审核', className: 'bg-amber-100 text-amber-700' },
  reviewing: { label: '审核中', className: 'bg-blue-100 text-blue-700' },
  need_revision: { label: '需修改', className: 'bg-orange-100 text-orange-700' },
  missing_audio: { label: '缺音频', className: 'bg-orange-100 text-orange-700' },
  approved: { label: '已通过', className: 'bg-green-100 text-green-700' },
  rejected: { label: '未通过', className: 'bg-red-100 text-red-700' },
  closed: { label: '已关闭', className: 'bg-surface-2 text-ink-3' },
};

// 语言代码
const langLabel: Record<string, string> = {
  zh: '汉语',
  en: '英语',
  ja: '日语',
  ko: '韩语',
  others: '其他',
};
function langText(code?: string): string {
  if (!code) return '—';
  return langLabel[code] ?? code;
}

/** 内容管理页面 */
function ContentManagement({ initialTab = 'lyrics' }: { initialTab?: ContentMainTab }) {
  const [mainTab, setMainTab] = useState<ContentMainTab>(initialTab);
  const [statusTab, setStatusTab] = useState<LyricsStatusTab>('all');

  return (
    <div className="rounded-lg border border-line bg-card p-6">
      <h2 className="text-xl font-bold tracking-tight text-foreground">内容管理</h2>

      {/* 主 Tab：歌词管理 / 每日推荐管理 / 搜索IP管理 */}
      <div className="mt-4 flex gap-1 border-b border-line">
        {contentMainTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setMainTab(t.key)}
            className={`relative px-4 py-2 text-sm transition-colors ${
              mainTab === t.key ? 'font-medium text-primary' : 'text-ink-2 hover:text-foreground'
            }`}
          >
            {t.label}
            {mainTab === t.key && (
              <motion.span
                layoutId="content-main-tab-indicator"
                className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
          </button>
        ))}
      </div>

      {/* 子内容 */}
      <div className="mt-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={mainTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            {mainTab === 'lyrics' ? (
              <LyricsList statusTab={statusTab} setStatusTab={setStatusTab} />
            ) : mainTab === 'daily' ? (
              <DailyRecommendList />
            ) : (
              <SearchIpList />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/** 歌词管理列表（无限滚动：每页 20 条，滚动到底自动加载下一页） */
function LyricsList({
  statusTab,
  setStatusTab,
}: {
  statusTab: LyricsStatusTab;
  setStatusTab: (t: LyricsStatusTab) => void;
}) {
  const queryClient = useQueryClient();
  const listKey = queryKeys.submissions({
    mode: 'creator',
    status: statusTab,
    limit: LIST_PAGE_SIZE,
  });

  const listQuery = useInfiniteQuery({
    queryKey: listKey,
    queryFn: ({ pageParam }) =>
      api.listSubmissions({ status: statusTab, page: pageParam, limit: LIST_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last, all) => {
      const fetched = all.reduce((n, p) => n + (p.items?.length ?? 0), 0);
      if (typeof last.total === 'number' && last.total > 0) {
        return fetched < last.total ? all.length + 1 : undefined;
      }
      return (last.items?.length ?? 0) < LIST_PAGE_SIZE ? undefined : all.length + 1;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
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

  // 订阅全局投稿状态变更：直接补丁缓存里的所有已加载页
  useSubmissionListSync((payload) => {
    const id = payload.id ?? payload.submissionId;
    if (!id || !payload.status) return;
    queryClient.setQueryData<InfiniteData<SubmissionListResult>>(listKey, (prev) =>
      prev
        ? {
            ...prev,
            pages: prev.pages.map((p) => ({
              ...p,
              items: (p.items ?? []).map((it) =>
                it.id === id
                  ? { ...it, status: payload.status as SubmissionListItem['status'] }
                  : it
              ),
            })),
          }
        : prev
    );
  });

  const openDetail = (id: number) => {
    window.open(`/creator/lyrics/detail?id=${id}`, '_blank');
  };

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-4">
      {/* 状态筛选 */}
      <motion.div variants={fadeUp} className="flex flex-wrap gap-2">
        {lyricsStatusTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setStatusTab(t.key)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              statusTab === t.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface-2 text-ink-2 hover:bg-surface-2 hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </motion.div>

      {listQuery.isPending ? (
        <ListSkeleton rows={6} />
      ) : errorMsg ? (
        <p className="py-12 text-center text-sm text-red-600">{errorMsg}</p>
      ) : items.length === 0 ? (
        <div className="py-12 text-center">
          <FolderOpen className="mx-auto h-10 w-10 text-ink-3" />
          <p className="mt-3 text-sm text-ink-3">暂无稿件</p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-ink-3">
            已加载 {items.length}
            {total > items.length ? ` / 共 ${total} 条` : ' 条'}
          </p>
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
                    onClick={() => openDetail(item.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-line bg-background px-4 py-3 text-left transition-colors hover:bg-surface-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-foreground">
                          {item.title || '未命名'}
                        </span>
                        <span className="shrink-0 text-xs text-ink-3">#{item.id}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                        <span>
                          {new Date(item.createdAt).toLocaleString('zh-CN', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <span className="text-line">|</span>
                        <Badge
                          variant="outline"
                          className={`shrink-0 border-transparent inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`}
                        >
                          {meta.label}
                        </Badge>
                        <span className="text-line">|</span>
                        <span>语言：{langText(item.language)}</span>
                      </div>
                    </div>
                  </button>
                </motion.li>
              );
            })}
          </ul>

          {/* 无限滚动：哨兵进入视口自动加载下一页，按钮兜底 */}
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
    </motion.div>
  );
}

/** 每日推荐管理列表 */
function DailyRecommendList() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.dailySubmissions,
    queryFn: () => api.listDailySubmissions(),
    staleTime: 15_000,
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const errorMsg = error instanceof Error ? error.message : error ? '加载失败' : '';
  const [detailId, setDetailId] = useState<number | null>(null);

  if (detailId !== null) {
    return <DailyRecommendDetail id={detailId} onBack={() => setDetailId(null)} />;
  }

  return (
    <>
      {isPending ? (
        <ListSkeleton rows={6} />
      ) : errorMsg ? (
        <p className="py-12 text-center text-sm text-error">{errorMsg}</p>
      ) : items.length === 0 ? (
        <div className="py-12 text-center">
          <CalendarDays className="mx-auto h-10 w-10 text-ink-3" />
          <p className="mt-3 text-sm text-ink-3">暂无每日推荐投稿</p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-ink-3">共 {total} 条</p>
          <ul className="space-y-2">
            {items.map((item) => {
              const meta = statusMeta[item.status] ?? {
                label: item.status,
                className: 'bg-surface-2 text-ink-2',
              };
              return (
                <li
                  key={item.id}
                  className="cursor-pointer rounded-md border border-line bg-background px-4 py-3 transition-colors hover:bg-surface-2"
                  onClick={() => setDetailId(item.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-xs text-ink-3">{item.date}</span>
                    <span className="truncate font-medium text-foreground">
                      {item.songName} - {item.artist}
                    </span>
                    <Badge
                      variant="outline"
                      className={`shrink-0 border-transparent inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs`}
                    >
                      {meta.label}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-ink-3">
                    提交于{' '}
                    {new Date(item.createdAt).toLocaleString('zh-CN', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

/** 每日推荐投稿详情 */
function DailyRecommendDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const {
    data: detail,
    isPending,
    error,
  } = useQuery({
    queryKey: queryKeys.dailySubmission(id),
    queryFn: () => api.getDailySubmission(id),
    staleTime: 15_000,
  });
  const errorMsg = error instanceof Error ? error.message : error ? '加载失败' : '';

  if (isPending) {
    return <CardDetailSkeleton />;
  }
  if (errorMsg || !detail) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-error">{errorMsg || '未找到该投稿'}</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-4 inline-flex h-9 items-center rounded-md border border-line bg-card px-4 text-sm text-ink-2 hover:bg-surface-2"
        >
          返回列表
        </button>
      </div>
    );
  }

  const meta = statusMeta[detail.status] ?? {
    label: detail.status,
    className: 'bg-surface-2 text-ink-2',
  };
  const coverUrl = detail.coverKey ? api.dailyCoverUrl(detail.coverKey) : '';
  const commentHtml = parseMarkupText(detail.comment || '');

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        返回列表
      </button>

      <div className="rounded-lg border border-line bg-card p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="shrink-0 rounded bg-surface-2 px-2 py-1 text-xs text-ink-2">
            {detail.date}
          </span>
          <h3 className="text-lg font-semibold text-foreground">{detail.songName}</h3>
          <Badge
            variant="outline"
            className={`shrink-0 border-transparent inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs`}
          >
            {meta.label}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-ink-2">{detail.artist}</p>
        {detail.ncmId && <p className="mt-1 text-xs text-ink-3">网易云ID：{detail.ncmId}</p>}

        {coverUrl && (
          <img
            src={coverUrl}
            alt={detail.songName}
            className="mt-4 h-40 w-40 rounded-md border border-line object-cover"
          />
        )}

        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-ink-3">推荐语：</p>
          <div
            className="rounded-md border border-line bg-background p-4 text-sm leading-relaxed text-ink-2"
            dangerouslySetInnerHTML={{ __html: commentHtml }}
          />
        </div>

        <p className="mt-4 text-xs text-ink-3">
          提交于{' '}
          {new Date(detail.createdAt).toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>
    </div>
  );
}

/** 搜索IP管理列表 */
function SearchIpList() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.searchIpSubmissions('mine'),
    queryFn: () => api.listSearchIpSubmissions(),
    staleTime: 15_000,
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const errorMsg = error instanceof Error ? error.message : error ? '加载失败' : '';
  const [detailId, setDetailId] = useState<number | null>(null);

  // 点击进入详情
  if (detailId !== null) {
    return <SearchIpDetail id={detailId} onBack={() => setDetailId(null)} />;
  }

  return (
    <>
      {isPending ? (
        <ListSkeleton rows={6} />
      ) : errorMsg ? (
        <p className="py-12 text-center text-sm text-error">{errorMsg}</p>
      ) : items.length === 0 ? (
        <div className="py-12 text-center">
          <Search className="mx-auto h-10 w-10 text-ink-3" />
          <p className="mt-3 text-sm text-ink-3">暂无搜索IP投稿</p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-ink-3">共 {total} 条</p>
          <ul className="space-y-2">
            {items.map((item) => {
              const meta = statusMeta[item.status] ?? {
                label: item.status,
                className: 'bg-surface-2 text-ink-2',
              };
              return (
                <li
                  key={item.id}
                  className="cursor-pointer rounded-md border border-line bg-background px-4 py-3 transition-colors hover:bg-surface-2"
                  onClick={() => setDetailId(item.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-foreground">
                      {item.title || '未命名'}
                    </span>
                    <Badge
                      variant="outline"
                      className={`shrink-0 border-transparent inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs`}
                    >
                      {meta.label}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-ink-3">{item.createdAt}</p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

/** 搜索IP投稿详情（见 components/creator/SearchIpDetail.tsx） */

export function CreatorCenter() {
  const { user, openLogin } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // 页面状态存全局 atoms（卸载时复位，语义同原 useState）
  const [view, setView] = useAtom(viewAtom);
  const [submitTab, setSubmitTab] = useAtom(submitTabAtom);
  const [contentTab, setContentTab] = useAtom(contentTabAtom);

  // 投稿下拉菜单 hover 开关：纯局部一次性 UI 状态，保留 useState
  const [submitMenuOpen, setSubmitMenuOpen] = useState(false);

  // 离开页面时复位
  useEffect(() => () => resetCreatorCenter(), []);

  // 支持 ?tab=lyrics|daily|search-ip 直达对应投稿表单（主页投稿按钮等外部入口用）
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'lyrics' || tab === 'daily' || tab === 'search-ip') {
      setSubmitTab(tab);
      setView('submit');
    }
  }, [searchParams, setSubmitTab, setView]);

  // 未登录拦截
  if (!user) {
    return (
      <div className="mx-auto max-w-[1200px] px-6 py-32 text-center">
        <h1 className="text-2xl font-bold tracking-tight">请先登录</h1>
        <p className="mt-3 text-ink-2">登录后可进入创作中心</p>
        <motion.button
          type="button"
          onClick={() => openLogin()}
          {...buttonTap}
          className={buttonVariants({ className: 'mt-8' })}
        >
          去登录
        </motion.button>
      </div>
    );
  }

  const initial = (user.displayName || user.name || '?').charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* 顶栏 */}
      <header className="sticky top-0 z-50 border-b border-line bg-card/80 backdrop-blur-xl">
        <div className="flex h-16 items-center justify-between px-6">
          {/* 左：logo + 标题 + 返回主站 */}
          <div className="flex items-center gap-4">
            <div className="relative flex items-center gap-4">
              <Link to="/">
                <img src="/logo.png" alt="AMLL-Hub" className="h-8 w-8 rounded-md object-contain" />
              </Link>
              <span className="text-lg font-bold tracking-tight text-foreground">
                AMLL Hub 创作中心
              </span>
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500">
                测试版
              </span>
              <span className="absolute inset-x-0 top-full mt-0.5 whitespace-nowrap text-center text-[9px] leading-none text-ink-3">
                测试版本，不代表最终品质
              </span>
            </div>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <Link
              to="/"
              className="flex items-center gap-1 text-sm text-ink-2 transition-colors hover:text-primary"
            >
              <ArrowLeft className="h-4 w-4" />
              返回主站
            </Link>
          </div>
          {/* 右：消息通知 + 头像 + 欢迎语 */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-foreground"
              aria-label="消息通知"
            >
              <Bell className="h-5 w-5" />
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />
            </button>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {user.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.displayName || user.name}
                    className="h-9 w-9 rounded-full object-cover"
                  />
                ) : (
                  initial
                )}
              </div>
              <span className="hidden text-sm text-ink-2 sm:inline">
                你好，{user.displayName || user.name}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* 主体：侧边栏 + 主内容区（底部留出固定 footer 的空间） */}
      <div className="flex w-full flex-1 gap-6 py-6 pb-[76px]">
        {/* 左侧边栏 */}
        <aside className="hidden w-56 shrink-0 pl-6 md:block">
          {/* 投稿按钮区 */}
          <div
            className="relative"
            onMouseEnter={() => setSubmitMenuOpen(true)}
            onMouseLeave={() => setSubmitMenuOpen(false)}
          >
            <button
              type="button"
              onClick={() => {
                setSubmitTab('lyrics');
                setView('submit');
              }}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              <Upload className="h-4 w-4" />
              投稿
            </button>
            <AnimatePresence>
              {submitMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.15 }}
                  className="absolute left-full top-0 z-50 ml-2 w-48 overflow-hidden rounded-md border border-line bg-card py-1 shadow-lg"
                >
                  {submitMenuOptions.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => {
                        setSubmitTab(opt.key);
                        setView('submit');
                        setSubmitMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-primary"
                    >
                      <opt.icon className="h-4 w-4" />
                      {opt.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 导航菜单 */}
          <nav className="mt-6 space-y-1">
            <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-ink-3">
              内容管理
            </p>
            <NavItem
              icon={<Home className="h-4 w-4" />}
              label="首页"
              active={view === 'home'}
              onClick={() => setView('home')}
            />
            <NavItem
              icon={<FolderOpen className="h-4 w-4" />}
              label="内容管理"
              active={view === 'content'}
              onClick={() => setView('content')}
            />
          </nav>
        </aside>

        {/* 主内容区：grid 重叠布局，新旧视图交叉淡入淡出 */}
        <main className="grid min-w-0 flex-1 pr-6">
          <AnimatePresence>
            {/* 首页占位 */}
            {view === 'home' && (
              <motion.div
                key="home"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, pointerEvents: 'none' }}
                transition={{ duration: 0.15 }}
                className="col-start-1 row-start-1 rounded-lg border border-line bg-card p-12 text-center"
              >
                <LayoutDashboard className="mx-auto h-12 w-12 text-ink-3" />
                <h2 className="mt-4 text-xl font-bold tracking-tight text-foreground">
                  创作中心首页
                </h2>
                <p className="mt-2 text-sm text-ink-3">
                  欢迎来到创作中心，这里将展示你的创作数据概览
                </p>
              </motion.div>
            )}

            {/* 内容管理 */}
            {view === 'content' && (
              <motion.div
                key="content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, pointerEvents: 'none' }}
                transition={{ duration: 0.15 }}
                className="col-start-1 row-start-1"
              >
                <ContentManagement initialTab={contentTab} />
              </motion.div>
            )}

            {/* 投稿表单 */}
            {view === 'submit' && (
              <motion.div
                key="submit"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, pointerEvents: 'none' }}
                transition={{ duration: 0.15 }}
                className="col-start-1 row-start-1 rounded-lg border border-line bg-card p-6 pb-[100px]"
              >
                {/* Tab 栏 */}
                <div className="flex border-b border-line">
                  {submitTabs.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setSubmitTab(t.key)}
                      className={`relative px-4 py-3 text-sm font-medium transition-colors ${
                        submitTab === t.key ? 'text-primary' : 'text-ink-2 hover:text-foreground'
                      }`}
                    >
                      {t.label}
                      {submitTab === t.key && (
                        <motion.span
                          layoutId="submit-tab-indicator"
                          className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary"
                          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                        />
                      )}
                    </button>
                  ))}
                </div>

                {/* Tab 内容 */}
                <div className="pt-6">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={submitTab}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.18 }}
                    >
                      {submitTab === 'lyrics' && (
                        <LyricSubmitForm
                          onSuccess={() => {
                            setContentTab('lyrics');
                            setView('content');
                          }}
                        />
                      )}
                      {submitTab === 'daily' && (
                        <DailyRecommendForm
                          onSuccess={(date) => {
                            navigate(`/daily?date=${encodeURIComponent(date)}`);
                          }}
                        />
                      )}
                      {submitTab === 'search-ip' && <SearchIpForm />}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* 底部提示：固定在屏幕底部 */}
      <footer className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-2 border-t border-line bg-card/90 py-3 backdrop-blur-xl">
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500">
          测试版
        </span>
        <span className="text-xs text-ink-3">测试版本，不代表最终品质</span>
      </footer>
    </div>
  );
}
