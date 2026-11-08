import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Package,
  Palette,
  Pause,
  Play,
  Puzzle,
  Search,
} from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { formatCount } from '@/lib/format';
import { PageContainer } from '@/components/PageContainer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/EmptyState';
import { PluginCoverCard, PluginRowCard } from '@/components/plugin/PluginCard';
import { cn } from '@/lib/utils';
import type { PluginChannel } from '@/lib/types';
import type { LucideIcon } from 'lucide-react';

const PAGE_SIZE = 12;
const RECOMMEND_SIZE = 6;

const channelOptions: { value: PluginChannel | ''; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'trusted-js', label: '功能插件' },
  { value: 'theme', label: '主题包' },
];

const sortOptions = [
  { value: 'recent', label: '最近更新' },
  { value: 'downloads', label: '下载最多' },
  { value: 'name', label: '名称排序' },
] as const;

type SortValue = (typeof sortOptions)[number]['value'];

const heroSlides: {
  title: string;
  tagline: string;
  icon: LucideIcon;
  background: string;
}[] = [
  {
    title: '欢迎光临 AMLL TTML Tool TEST 插件广场',
    tagline: '使用适用于 AMLL TTML Tool TEST 的插件和主题让编辑器如虎添翼',
    icon: Puzzle,
    background: 'linear-gradient(120deg, #b31f2e 0%, #e0303f 46%, #f27452 100%)',
  },
  {
    title: '插件广场',
    tagline: '从简洁到华丽，为 Tool 挑一套合适的主题包。',
    icon: Palette,
    background: 'linear-gradient(120deg, #1f3b8f 0%, #3f6fd8 52%, #6fb6ee 100%)',
  },
];

// 末尾多放一张首屏副本，用于无缝循环：始终向左滑动，播完副本后瞬间归位
const heroLoopSlides = [...heroSlides, heroSlides[0]!];

export function PluginStore() {
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [channel, setChannel] = useState<PluginChannel | ''>('');
  const [sort, setSort] = useState<SortValue>('recent');
  const [page, setPage] = useState(1);
  const [heroTrackIndex, setHeroTrackIndex] = useState(0);
  const [heroJump, setHeroJump] = useState(false);
  const [heroPaused, setHeroPaused] = useState(false);
  const [heroHovered, setHeroHovered] = useState(false);
  const heroIndex = heroTrackIndex % heroSlides.length;
  // 一次切换未结束前不再接受新的手动切换，避免快速点击造成瞬移/闪烁
  const heroLockRef = useRef(false);

  useEffect(() => {
    if (heroPaused || heroHovered) return;
    const timer = setInterval(() => {
      if (heroLockRef.current) return;
      heroLockRef.current = true;
      setHeroTrackIndex((value) => (value >= heroSlides.length ? value : value + 1));
    }, 6000);
    return () => clearInterval(timer);
  }, [heroPaused, heroHovered]);

  // 归位瞬间禁用动画，归位完成后再解除切换锁
  useEffect(() => {
    if (!heroJump) {
      heroLockRef.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => setHeroJump(false));
    return () => cancelAnimationFrame(frame);
  }, [heroJump]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [qInput]);

  const listQuery = useQuery({
    queryKey: queryKeys.pluginList({ page, pageSize: PAGE_SIZE, q, channel, sort }),
    queryFn: () => api.pluginStore.list({ page, pageSize: PAGE_SIZE, q, channel, sort }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const recommendedQuery = useQuery({
    queryKey: queryKeys.pluginList({
      page: 1,
      pageSize: RECOMMEND_SIZE,
      q: '',
      channel: '',
      sort: 'downloads',
    }),
    queryFn: () => api.pluginStore.list({ page: 1, pageSize: RECOMMEND_SIZE, sort: 'downloads' }),
    staleTime: 60_000,
  });

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const recommended = recommendedQuery.data?.items ?? [];

  // 插件减少后当前页可能越界，自动收回
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // 所有切换（含上一张、圆点）都沿同一方向播放：从右往左滑
  const advanceSlide = () => {
    if (heroLockRef.current || heroTrackIndex >= heroSlides.length) return;
    heroLockRef.current = true;
    setHeroTrackIndex((value) => (value >= heroSlides.length ? value : value + 1));
  };

  return (
    <PageContainer width="md" className="py-8 sm:py-10">
      {/* Hero 轮播 */}
      <section
        className="relative overflow-hidden rounded-2xl shadow-sm"
        onMouseEnter={() => setHeroHovered(true)}
        onMouseLeave={() => setHeroHovered(false)}
        aria-roledescription="carousel"
        aria-label="插件广场介绍"
      >
        <motion.div
          className="flex"
          animate={{ x: `-${heroTrackIndex * 100}%` }}
          transition={heroJump ? { duration: 0 } : { duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
          onAnimationComplete={() => {
            if (heroTrackIndex >= heroSlides.length) {
              setHeroJump(true);
              setHeroTrackIndex(0);
              return;
            }
            if (!heroJump) {
              heroLockRef.current = false;
            }
          }}
        >
          {heroLoopSlides.map((item, index) => {
            const SlideIcon = item.icon;
            return (
              <div
                key={`${item.title}-${index}`}
                className="relative flex min-h-[250px] w-full shrink-0 flex-col items-center justify-center p-7 text-center sm:min-h-[290px] sm:p-10"
                style={{ backgroundImage: item.background }}
              >
                <div
                  className="pointer-events-none absolute inset-0 opacity-30"
                  style={{
                    backgroundImage:
                      'radial-gradient(circle at 78% 18%, rgba(255,255,255,0.55) 0%, transparent 42%), repeating-linear-gradient(45deg, rgba(255,255,255,0.14) 0px, rgba(255,255,255,0.14) 1px, transparent 1px, transparent 11px)',
                  }}
                />
                <SlideIcon
                  className="pointer-events-none absolute top-1/2 -right-8 hidden h-[230px] w-[230px] -translate-y-1/2 text-white/15 sm:block"
                  strokeWidth={1.1}
                />

                <h1 className="relative max-w-3xl text-3xl font-bold tracking-tight text-white sm:text-4xl">
                  {item.title}
                </h1>
                <p className="relative mt-3 max-w-2xl text-sm leading-6 text-white/85">
                  {item.tagline}
                </p>
              </div>
            );
          })}
        </motion.div>
      </section>

      <div className="mt-3 flex items-center justify-center gap-3 text-ink-3">
        <button
          type="button"
          aria-label={heroPaused ? '播放轮播' : '暂停轮播'}
          title={heroPaused ? '播放轮播' : '暂停轮播'}
          className="rounded-full p-1 transition-colors hover:bg-surface-2 hover:text-primary"
          onClick={() => setHeroPaused((value) => !value)}
        >
          {heroPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </button>
        <button
          type="button"
          aria-label="上一张"
          className="rounded-full p-1 transition-colors hover:bg-surface-2 hover:text-primary"
          onClick={advanceSlide}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-1.5">
          {heroSlides.map((item, index) => (
            <button
              key={item.title}
              type="button"
              aria-label={`切换到第 ${index + 1} 张`}
              aria-current={index === heroIndex}
              onClick={() => {
                if (index !== heroIndex) advanceSlide();
              }}
              className={cn(
                'h-1.5 rounded-full transition-all',
                index === heroIndex ? 'w-5 bg-ink-2' : 'w-1.5 bg-line hover:bg-ink-3'
              )}
            />
          ))}
        </div>
        <button
          type="button"
          aria-label="下一张"
          className="rounded-full p-1 transition-colors hover:bg-surface-2 hover:text-primary"
          onClick={advanceSlide}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* 为你推荐 */}
      {recommended.length > 0 && (
        <section className="mt-7 rounded-2xl border border-line bg-card p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-foreground">为你推荐</h2>
          <div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {recommended.map((item) => (
              <PluginRowCard key={item.plugin.pluginKey} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* 全部插件 */}
      <section id="all-plugins" className="mt-8 scroll-mt-24">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">全部插件</h2>
            <p className="mt-0.5 text-xs text-ink-3">共 {formatCount(total)} 个插件</p>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="relative min-w-[180px] flex-1 sm:w-56 sm:flex-none">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
              <Input
                className="h-8 rounded-full pl-8 text-xs"
                value={qInput}
                placeholder="搜索插件、主题或作者"
                aria-label="搜索插件"
                onChange={(event) => setQInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setQ(qInput.trim());
                    setPage(1);
                  }
                }}
              />
            </div>

            <div className="inline-flex rounded-full border border-line bg-card p-0.5">
              {channelOptions.map((option) => {
                const active = channel === option.value;
                return (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setChannel(option.value);
                      setPage(1);
                    }}
                    className={cn(
                      'relative rounded-full px-3 py-1 text-xs font-medium transition-colors',
                      active ? 'text-primary-foreground' : 'text-ink-2 hover:text-foreground'
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="plugin-channel-pill"
                        className="absolute inset-0 rounded-full bg-primary shadow-sm"
                        transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                      />
                    )}
                    <span className="relative z-10">{option.label}</span>
                  </button>
                );
              })}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="排序方式"
                  className="group inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-card pr-2.5 pl-3 text-xs text-ink-2 transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none data-[state=open]:border-primary/50 data-[state=open]:text-primary"
                >
                  {sortOptions.find((option) => option.value === sort)?.label}
                  <ChevronDown className="h-3.5 w-3.5 text-ink-3 transition-transform duration-200 group-data-[state=open]:rotate-180 group-data-[state=open]:text-primary" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6} className="w-36 rounded-xl">
                <DropdownMenuRadioGroup
                  value={sort}
                  onValueChange={(value) => {
                    setSort(value as SortValue);
                    setPage(1);
                  }}
                >
                  {sortOptions.map((option) => (
                    <DropdownMenuRadioItem
                      key={option.value}
                      value={option.value}
                      className="cursor-pointer rounded-lg text-xs"
                    >
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {listQuery.error instanceof Error && (
          <div className="mt-4 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
            {listQuery.error.message}
          </div>
        )}

        {listQuery.isLoading ? (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: PAGE_SIZE }).map((_, index) => (
              <div
                key={index}
                className="aspect-square animate-pulse rounded-2xl border border-line bg-card"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            className="mt-5"
            icon={Package}
            title={q || channel ? '没有匹配的插件' : '还没有插件'}
            description={
              q || channel ? '换个关键词或切换类型试试' : '暂时没有可浏览的插件，请稍后再来看看'
            }
          />
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
            {items.map((item) => (
              <PluginCoverCard key={item.plugin.pluginKey} item={item} />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={page <= 1 || listQuery.isFetching}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
              上一页
            </Button>
            <span className="text-xs text-ink-3">
              第 {page} / {totalPages} 页
            </span>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={page >= totalPages || listQuery.isFetching}
              onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            >
              下一页
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </section>
    </PageContainer>
  );
}
