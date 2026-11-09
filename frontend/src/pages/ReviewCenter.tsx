import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
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
import {
  ArrowLeft,
  ChevronRight,
  FolderOpen,
  Home,
  Megaphone,
  Package,
  Search,
  Shield,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { formatDateTime } from '@/lib/format';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { useSubmissionListSync } from '@/hooks/useSubmissionListSync';
import { NavItem } from '@/components/NavItem';
import { NotificationBellResponsive } from '@/components/notification/NotificationBellResponsive';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListPagination } from '@/components/ui/list-pagination';
import { SearchIpDetail } from '@/components/creator/SearchIpDetail';
import { AnnouncementPanel } from '@/components/review/AnnouncementPanel';
import { ReviewerManagePanel } from '@/components/review/ReviewerManagePanel';
import { PluginReviewPanel } from '@/components/plugin/PluginReviewPanel';
import type { SubmissionListItem, SubmissionListResult } from '@/lib/types';
import { UserAvatar } from '@/components/submission/UserAvatar';
import { UserDisplayName } from '@/components/submission/UserDisplayName';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { langText, statusMeta } from '@/components/submission/status';
import { FirstSubmissionBadge } from '@/components/submission/FirstSubmissionBadge';
import { RevisionBadge } from '@/components/submission/RevisionBadge';

// 状态与语言的展示元数据统一在 status.ts（纯模块，不带 marked 依赖）

const reviewTabs: { key: ReviewTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审核' },
  { key: 'reviewing', label: '审核中' },
  { key: 'revised', label: '待投稿者确认' },
  { key: 'need_revision', label: '需修改' },
  { key: 'missing_audio', label: '缺音频' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '未通过' },
  { key: 'closed', label: '已关闭' },
];

/** 审核列表每页条数 */
const LIST_PAGE_SIZE = 20;

// 搜索IP投稿状态筛选选项
const searchIpTabs: { key: SearchIpTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审核' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '未通过' },
];

/** 审核中心列表（分页：每页 20 条） */
function ReviewList() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // 列表筛选状态存全局 atoms（页面卸载时统一复位）
  const [tab, setTab] = useAtom(reviewTabAtom);
  const [search, setSearch] = useAtom(reviewSearchAtom);
  const [page, setPage] = useState(1);
  const trimmedSearch = search.trim() || undefined;

  const listKey = queryKeys.submissions({
    mode: 'review',
    status: tab,
    search: trimmedSearch,
    limit: LIST_PAGE_SIZE,
    page,
  });

  const listQuery = useQuery({
    queryKey: listKey,
    queryFn: () =>
      api.listAllSubmissions({
        status: tab,
        search: trimmedSearch,
        page,
        limit: LIST_PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  const errorMsg =
    listQuery.error instanceof Error ? listQuery.error.message : listQuery.error ? '加载失败' : '';

  // 切换筛选条件或搜索词时回到第一页
  useEffect(() => {
    setPage(1);
  }, [tab, trimmedSearch]);

  // 条目减少后当前页可能越界（如末页稿件被审核掉），自动收回
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // 订阅全局投稿状态变更（审核员进入详情页标记审核中等场景）：补丁当前页
  useSubmissionListSync((payload) => {
    const id = payload.id ?? payload.submissionId;
    if (!id || !payload.status) return;
    queryClient.setQueryData<SubmissionListResult>(listKey, (prev) =>
      prev
        ? {
            ...prev,
            items: (prev.items ?? []).map((it) =>
              it.id === id
                ? {
                    ...it,
                    status: payload.status as SubmissionListItem['status'],
                    reviewer: payload.reviewer ?? it.reviewer,
                    reviewerInfo: payload.reviewerInfo ?? it.reviewerInfo,
                  }
                : it
            ),
          }
        : prev
    );
  });

  const openDetail = (id: number) => {
    navigate(`/review/detail?id=${id}`);
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
          <EmptyState icon={FolderOpen} title="暂无稿件" description="换个筛选条件试试" />
        ) : (
          <>
            <p className="mb-3 text-xs text-ink-3">
              共 {total} 条 · 第 {page} / {totalPages} 页
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
                          <span className="min-w-0 truncate font-medium text-foreground">
                            {item.title || '未命名'}
                          </span>
                          {item.isFirstSubmission && <FirstSubmissionBadge />}
                          {item.submissionType === 'revision' && <RevisionBadge />}
                          <span className="shrink-0 text-xs text-ink-3">#{item.id}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                          <span>{formatDateTime(item.createdAt)}</span>
                          <span className="text-line">|</span>
                          <Badge
                            variant="outline"
                            className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${meta.className} border-transparent`}
                          >
                            {meta.label}
                          </Badge>
                          <span className="text-line">|</span>
                          {/* 投稿人：审核时先看是谁投的 */}
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <UserAvatar
                              avatar={item.submitterInfo?.avatar}
                              name={item.submitterInfo?.displayName || item.submitter}
                              size={14}
                            />
                            <span className="shrink-0">投稿人</span>
                            <span className="truncate text-ink-2">
                              <UserDisplayName
                                displayName={item.submitterInfo?.displayName}
                                username={item.submitter}
                              />
                            </span>
                          </span>
                          {/* 审核中：显示当前占用者，避免多个审核员重复劳动 */}
                          {item.status === 'reviewing' && item.reviewer && (
                            <>
                              <span className="text-line">|</span>
                              <span className="inline-flex items-center gap-1 text-primary">
                                <UserAvatar
                                  avatar={item.reviewerInfo?.avatar}
                                  name={item.reviewerInfo?.displayName || item.reviewer}
                                  size={14}
                                />
                                <span className="shrink-0">审核人</span>
                                <UserDisplayName
                                  displayName={item.reviewerInfo?.displayName}
                                  username={item.reviewer}
                                />
                              </span>
                            </>
                          )}
                          <span className="text-line">|</span>
                          <span>语言：{langText(item.language)}</span>
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

/** 搜索IP显示投稿审核列表 */
function SearchIpReviewList() {
  // 列表筛选与选中详情存全局 atoms（页面卸载时统一复位）
  const [tab, setTab] = useAtom(searchIpTabAtom);
  const [detailId, setDetailId] = useAtom(searchIpDetailIdAtom);
  const [page, setPage] = useState(1);

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.searchIpSubmissions('all', tab, page),
    queryFn: () => api.listAllSearchIpSubmissions({ status: tab, page, limit: LIST_PAGE_SIZE }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  const errorMsg = error instanceof Error ? error.message : error ? '加载失败' : '';

  // 切换筛选条件时回到第一页
  useEffect(() => {
    setPage(1);
  }, [tab]);

  // 条目减少后当前页可能越界，自动收回
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

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
          <EmptyState icon={Search} title="暂无搜索IP投稿" description="换个筛选条件试试" />
        ) : (
          <>
            <p className="mb-3 text-xs text-ink-3">
              共 {total} 条 · 第 {page} / {totalPages} 页
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
                          <span>{formatDateTime(item.createdAt)}</span>
                          <span className="text-line">|</span>
                          <Badge
                            variant="outline"
                            className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${meta.className} border-transparent`}
                          >
                            {meta.label}
                          </Badge>
                          <span className="text-line">|</span>
                          <span>投稿人：{item.submitter}</span>
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

/** 首页卡片最多展示的待审核条数 */
const HOME_CARD_LIMIT = 5;

/** 首页卡片内的单条待审核记录 */
function HomePendingRow({
  title,
  tag,
  time,
  onOpen,
}: {
  title: string;
  tag: string;
  time: string;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-2"
      >
        <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={title}>
          {title}
        </span>
        <span className="shrink-0 font-mono text-xs text-ink-3">{tag}</span>
        <span className="shrink-0 text-xs text-ink-3">{time}</span>
      </button>
    </li>
  );
}

/** 首页单块待审核卡片 */
function HomePendingCard({
  icon: Icon,
  title,
  count,
  loading,
  error,
  onViewAll,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count: number;
  loading: boolean;
  error: string;
  onViewAll: () => void;
  children: ReactNode;
}) {
  const isEmpty = !loading && !error && count === 0;

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-card p-5">
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-base font-bold tracking-tight text-foreground">
          <Icon className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">{title}</span>
          {count > 0 && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {count}
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={onViewAll}
          className="flex shrink-0 items-center gap-0.5 text-xs text-ink-3 transition-colors hover:text-primary"
        >
          查看全部
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded-md bg-surface-2" />
            ))}
          </div>
        ) : error ? (
          <p className="py-6 text-center text-xs text-error">{error}</p>
        ) : isEmpty ? null : (
          <ul className="space-y-0.5">{children}</ul>
        )}
      </div>
    </section>
  );
}

/** 审核中心首页 */
function HomeOverview() {
  const navigate = useNavigate();
  const [, setView] = useAtom(reviewViewAtom);
  const [, setSearchIpDetailId] = useAtom(searchIpDetailIdAtom);

  const lyricsQuery = useQuery({
    queryKey: queryKeys.submissions({
      mode: 'review',
      status: 'pending',
      limit: HOME_CARD_LIMIT,
      page: 1,
    }),
    queryFn: () => api.listAllSubmissions({ status: 'pending', page: 1, limit: HOME_CARD_LIMIT }),
    staleTime: 15_000,
  });

  const searchIpQuery = useQuery({
    queryKey: queryKeys.searchIpHomePending,
    queryFn: () =>
      api.listAllSearchIpSubmissions({ status: 'pending', page: 1, limit: HOME_CARD_LIMIT }),
    staleTime: 15_000,
  });

  const pluginQuery = useQuery({
    queryKey: queryKeys.pluginReviewQueue({
      page: 1,
      pageSize: HOME_CARD_LIMIT,
      status: 'pending',
    }),
    queryFn: () =>
      api.pluginStore.reviewQueue({ page: 1, pageSize: HOME_CARD_LIMIT, status: 'pending' }),
    staleTime: 15_000,
  });

  const lyricsItems = lyricsQuery.data?.items ?? [];
  const searchIpItems = searchIpQuery.data?.items ?? [];
  const pluginItems = pluginQuery.data?.items ?? [];

  const errText = (q: { error: unknown }) =>
    q.error instanceof Error ? q.error.message : q.error ? '加载失败' : '';

  return (
    <div className="col-start-1 row-start-1 grid min-h-0 gap-4 lg:h-full lg:grid-cols-2 lg:grid-rows-2 lg:overflow-hidden">
      {/* 歌词审核 */}
      <HomePendingCard
        icon={FolderOpen}
        title="歌词审核"
        count={lyricsQuery.data?.total ?? 0}
        loading={lyricsQuery.isPending}
        error={errText(lyricsQuery)}
        onViewAll={() => setView('content')}
      >
        {lyricsItems.map((item) => (
          <HomePendingRow
            key={item.id}
            title={item.title || '未命名'}
            tag={`#${item.id}`}
            time={formatDateTime(item.createdAt)}
            onOpen={() => navigate(`/review/detail?id=${item.id}`)}
          />
        ))}
      </HomePendingCard>

      {/* IP显示投稿 */}
      <HomePendingCard
        icon={Search}
        title="IP显示投稿"
        count={searchIpQuery.data?.total ?? 0}
        loading={searchIpQuery.isPending}
        error={errText(searchIpQuery)}
        onViewAll={() => setView('search-ip')}
      >
        {searchIpItems.map((item) => (
          <HomePendingRow
            key={item.id}
            title={item.title || '未命名'}
            tag={`#${item.id}`}
            time={formatDateTime(item.createdAt)}
            onOpen={() => {
              setSearchIpDetailId(item.id);
              setView('search-ip');
            }}
          />
        ))}
      </HomePendingCard>

      {/* 插件审核 */}
      <HomePendingCard
        icon={Package}
        title="插件审核"
        count={pluginQuery.data?.total ?? 0}
        loading={pluginQuery.isPending}
        error={errText(pluginQuery)}
        onViewAll={() => setView('plugins')}
      >
        {pluginItems.map((item) => (
          <HomePendingRow
            key={item.version.id}
            title={item.pluginName}
            tag={`v${item.version.version}`}
            time={formatDateTime(item.version.submittedAt)}
            onOpen={() =>
              window.open(`/review/plugin?key=${encodeURIComponent(item.pluginKey)}`, '_blank')
            }
          />
        ))}
      </HomePendingCard>
    </div>
  );
}

/** 审核中心主页面 */
export function ReviewCenter() {
  const { user, openLogin } = useAuth();
  // 页面状态存全局 atoms（卸载时复位，语义同原 useState）
  const [viewState, setView] = useAtom(reviewViewAtom);
  const view = user && !user.isReviewer && viewState === 'home' ? 'announcement' : viewState;
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

  // 仅审核员或超级管理员可进入
  if (!user.isReviewer && !user.isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Shield className="mx-auto h-10 w-10 text-ink-3" />
          <p className="mt-3 text-sm text-ink-3">需要审核员或超级管理员权限</p>
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
    // 锁定视口高度
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* 顶栏 */}
      <header className="z-50 shrink-0 border-b border-line bg-card/80 backdrop-blur-xl">
        <div className="flex h-16 items-center justify-between px-6">
          {/* 左：logo + 标题 + 返回主站 */}
          <div className="flex items-center gap-4">
            <div className="relative flex items-center gap-4">
              <Link to="/">
                <img src="/logo.png" alt="AMLL-Hub" className="h-8 w-8 rounded-md object-contain" />
              </Link>
              <span className="text-lg font-bold tracking-tight text-foreground">
                AMLL Hub {user.isReviewer ? '审核中心' : '管理中心'}
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
            <NotificationBellResponsive />
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
      <div className="flex min-h-0 w-full flex-1 gap-6 px-6 py-6 pb-[76px]">
        {/* 左侧边栏 */}
        <aside className="hidden w-56 shrink-0 md:block">
          {/* 导航菜单 */}
          <nav className="space-y-1">
            <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-ink-3">
              {user.isReviewer ? '审核管理' : '管理'}
            </p>
            {user.isReviewer && (
              <>
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
                <NavItem
                  icon={<Package className="h-4 w-4" />}
                  label="插件审核"
                  active={view === 'plugins'}
                  onClick={() => setView('plugins')}
                />
              </>
            )}
            <NavItem
              icon={<Megaphone className="h-4 w-4" />}
              label="发布公告"
              active={view === 'announcement'}
              onClick={() => setView('announcement')}
            />
            {user.isAdmin && (
              <NavItem
                icon={<ShieldCheck className="h-4 w-4" />}
                label="审核员管理"
                active={view === 'reviewers'}
                onClick={() => setView('reviewers')}
              />
            )}
          </nav>
        </aside>

        {/* 主内容区 */}
        <main className="no-scrollbar grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-y-auto">
          <AnimatePresence>
            {/* 首页 */}
            {view === 'home' && (
              <motion.div
                key="home"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, pointerEvents: 'none' }}
                transition={{ duration: 0.15 }}
                className="col-start-1 row-start-1 min-h-0"
              >
                <HomeOverview />
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
                className="col-start-1 row-start-1 self-start rounded-lg border border-line bg-card p-6"
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
                exit={{ opacity: 0, pointerEvents: 'none' }}
                transition={{ duration: 0.15 }}
                className="col-start-1 row-start-1 self-start rounded-lg border border-line bg-card p-6"
              >
                <h2 className="mb-4 text-xl font-bold tracking-tight text-foreground">
                  IP显示投稿审核
                </h2>
                <SearchIpReviewList />
              </motion.div>
            )}

            {/* 插件审核 */}
            {view === 'plugins' && (
              <motion.div
                key="plugins"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, pointerEvents: 'none' }}
                transition={{ duration: 0.15 }}
                className="col-start-1 row-start-1 self-start rounded-lg border border-line bg-card p-6"
              >
                <h2 className="mb-4 text-xl font-bold tracking-tight text-foreground">插件审核</h2>
                <PluginReviewPanel />
              </motion.div>
            )}

            {/* 发布公告 */}
            {view === 'announcement' && (
              <motion.div
                key="announcement"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, pointerEvents: 'none' }}
                transition={{ duration: 0.15 }}
                className="col-start-1 row-start-1 self-start rounded-lg border border-line bg-card p-6"
              >
                <AnnouncementPanel />
              </motion.div>
            )}

            {/* 审核员管理 */}
            {view === 'reviewers' && (
              <motion.div
                key="reviewers"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, pointerEvents: 'none' }}
                transition={{ duration: 0.15 }}
                className="col-start-1 row-start-1 self-start rounded-lg border border-line bg-card p-6"
              >
                <ReviewerManagePanel />
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
