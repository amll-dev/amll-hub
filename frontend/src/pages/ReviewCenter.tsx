import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useAtom } from 'jotai';
import {
  resetReviewCenterState,
  reviewSearchAtom,
  reviewTabAtom,
  reviewViewAtom,
  searchIpDetailIdAtom,
  searchIpTabAtom,
  type ReviewTab,
  type SearchIpTab,
} from '@/atoms/reviewCenter';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Bell, FolderOpen, Home, LayoutDashboard, Search, Shield } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { useSubmissionListSync } from '@/hooks/useSubmissionListSync';
import { useSentinel } from '@/hooks/useSentinel';
import { NavItem } from '@/components/NavItem';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { SearchIpDetail } from '@/components/creator/SearchIpDetail';
import type { SubmissionListItem, SubmissionListResult } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

// 状态 → 展示文案 + 颜色
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

// 语言代码 → 中文标签
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

const reviewTabs: { key: ReviewTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审核' },
  { key: 'reviewing', label: '审核中' },
  { key: 'need_revision', label: '需修改' },
  { key: 'missing_audio', label: '缺音频' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '未通过' },
  { key: 'closed', label: '已关闭' },
];

/** 审核列表分页大小（无限滚动） */
const LIST_PAGE_SIZE = 20;

// 搜索IP投稿状态筛选选项
const searchIpTabs: { key: SearchIpTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审核' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '未通过' },
];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 审核中心列表（无限滚动：每页 20 条，滚动到底自动加载下一页） */
function ReviewList() {
  const queryClient = useQueryClient();
  // 列表筛选状态存全局 atoms（页面卸载时统一复位）
  const [tab, setTab] = useAtom(reviewTabAtom);
  const [search, setSearch] = useAtom(reviewSearchAtom);
  const trimmedSearch = search.trim() || undefined;
  const listKey = queryKeys.submissions({
    mode: 'review',
    status: tab,
    search: trimmedSearch,
    limit: LIST_PAGE_SIZE,
  });

  const listQuery = useInfiniteQuery({
    queryKey: listKey,
    queryFn: ({ pageParam }) =>
      api.listAllSubmissions({
        status: tab,
        search: trimmedSearch,
        page: pageParam,
        limit: LIST_PAGE_SIZE,
      }),
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

  // 订阅全局投稿状态变更（审核员进入详情页标记审核中等场景）：补丁所有已加载页
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
                it.id === id ? { ...it, status: payload.status as SubmissionListItem['status'] } : it
              ),
            })),
          }
        : prev
    );
  });

  const openDetail = (id: number) => {
    window.open(`/review/detail?id=${id}`, '_blank');
  };

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-4">
      {/* 状态筛选 + 搜索 */}
      <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-2">
        {reviewTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              tab === t.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface-2 text-ink-2 hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </motion.div>

      <motion.div variants={fadeUp} className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索标题或歌手…"
          className="h-10 w-full rounded-md border border-input bg-surface-2 pl-9 pr-4 text-sm outline-none focus:border-primary"
        />
      </motion.div>

      <motion.div variants={fadeUp}>
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
                          <span>{formatTime(item.createdAt)}</span>
                          <span className="text-line">|</span>
                          <Badge variant="outline" className={`shrink-0 border-transparent inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`}>{meta.label}</Badge>
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
    </motion.div>
  );
}

/** 搜索IP显示投稿审核列表 */
function SearchIpReviewList() {
  // 列表筛选与选中详情存全局 atoms（页面卸载时统一复位）
  const [tab, setTab] = useAtom(searchIpTabAtom);
  const [detailId, setDetailId] = useAtom(searchIpDetailIdAtom);

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.searchIpSubmissions('all', tab),
    queryFn: () => api.listAllSearchIpSubmissions(tab),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const errorMsg = error instanceof Error ? error.message : error ? '加载失败' : '';

  // 点击进入详情
  if (detailId !== null) {
    return <SearchIpDetail id={detailId} onBack={() => setDetailId(null)} isReviewer />;
  }

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-4">
      {/* 状态筛选 */}
      <motion.div variants={fadeUp} className="flex flex-wrap gap-2">
        {searchIpTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              tab === t.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface-2 text-ink-2 hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </motion.div>

      <motion.div variants={fadeUp}>
        {isPending ? (
          <ListSkeleton rows={6} />
        ) : errorMsg ? (
          <p className="py-12 text-center text-sm text-red-600">{errorMsg}</p>
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
                  <motion.li key={item.id} variants={fadeUp}>
                    <button
                      type="button"
                      onClick={() => setDetailId(item.id)}
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
                          <span>{item.createdAt}</span>
                          <span className="text-line">|</span>
                          <Badge variant="outline" className={`shrink-0 border-transparent inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`}>{meta.label}</Badge>
                          <span className="text-line">|</span>
                          <span>投稿人：{item.submitter}</span>
                        </div>
                      </div>
                    </button>
                  </motion.li>
                );
              })}
            </ul>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

/** 审核中心主页面 */
export function ReviewCenter() {
  const { user, openLogin } = useAuth();
  // 页面状态存全局 atoms（卸载时复位，语义同原 useState）
  const [view, setView] = useAtom(reviewViewAtom);
  // 页面卸载时复位全部审核中心状态
  useEffect(() => () => resetReviewCenterState(), []);

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-sm text-ink-3">请先登录</p>
          <button
            type="button"
            onClick={() => openLogin('/review')}
            className="mt-4 rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            登录
          </button>
        </div>
      </div>
    );
  }

  // 非审核员不可进入
  if (!user.isReviewer) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Shield className="mx-auto h-10 w-10 text-ink-3" />
          <p className="mt-3 text-sm text-ink-3">需要审核员权限</p>
          <Link
            to="/"
            className="mt-4 inline-block text-sm text-primary transition-colors hover:underline"
          >
            返回首页
          </Link>
        </div>
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
                AMLL Hub 审核中心
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

      {/* 主体：侧边栏 + 主内容区 */}
      <div className="flex w-full flex-1 gap-6 py-6 pb-[76px]">
        {/* 左侧边栏 */}
        <aside className="hidden w-56 shrink-0 pl-6 md:block">
          {/* 导航菜单 */}
          <nav className="space-y-1">
            <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-ink-3">
              审核管理
            </p>
            <NavItem
              icon={<Home className="h-4 w-4" />}
              label="首页"
              active={view === 'home'}
              onClick={() => setView('home')}
            />
            <NavItem
              icon={<FolderOpen className="h-4 w-4" />}
              label="歌词审核"
              active={view === 'content'}
              onClick={() => setView('content')}
            />
            <NavItem
              icon={<Search className="h-4 w-4" />}
              label="IP显示投稿"
              active={view === 'search-ip'}
              onClick={() => setView('search-ip')}
            />
          </nav>
        </aside>

        {/* 主内容区 */}
        <main className="min-w-0 flex-1 pr-6">
          <AnimatePresence mode="wait">
            {/* 首页占位 */}
            {view === 'home' && (
              <motion.div
                key="home"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="rounded-lg border border-line bg-card p-12 text-center"
              >
                <LayoutDashboard className="mx-auto h-12 w-12 text-ink-3" />
                <h2 className="mt-4 text-xl font-bold tracking-tight text-foreground">
                  审核中心首页
                </h2>
                <p className="mt-2 text-sm text-ink-3">
                  欢迎来到审核中心，这里将展示待审核稿件概览
                </p>
              </motion.div>
            )}

            {/* 内容管理 */}
            {view === 'content' && (
              <motion.div
                key="content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="rounded-lg border border-line bg-card p-6"
              >
                <h2 className="mb-4 text-xl font-bold tracking-tight text-foreground">歌词审核</h2>
                <ReviewList />
              </motion.div>
            )}

            {/* IP显示投稿审核 */}
            {view === 'search-ip' && (
              <motion.div
                key="search-ip"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="rounded-lg border border-line bg-card p-6"
              >
                <h2 className="mb-4 text-xl font-bold tracking-tight text-foreground">
                  IP显示投稿审核
                </h2>
                <SearchIpReviewList />
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
