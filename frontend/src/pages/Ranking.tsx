import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Hash, Loader2, Music, Play } from 'lucide-react';
import { useNotFoundRanking } from '@/hooks/useNotFoundRanking';
import { usePlayer } from '@/hooks/usePlayer';
import { formatRelativeTime } from '@/lib/format';
import { qmCoverProxy } from '@/lib/qm';
import { listItem, staggerContainer } from '@/lib/motion';
import type { MusicPlatform, NotFoundRankingItem } from '@/lib/types';
import { ListPagination } from '@/components/ui/list-pagination';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { PageContainer } from '@/components/PageContainer';
import { EmptyState } from '@/components/ui/EmptyState';

// 服务端真分页：每页条数即请求 limit，offset 由页码推导，total 来自后端全量命中数
const PAGE_SIZE = 20;

const DAYS_OPTIONS = [1, 3, 7] as const;

// 三态按钮基础样式
const btnBase =
  'inline-flex h-9 items-center justify-center rounded-md px-3 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const btnIdle = 'border border-input bg-card text-ink-2 hover:border-primary hover:text-primary';
const btnActive = 'bg-primary text-primary-foreground';

export function Ranking() {
  const [days, setDays] = useState<number>(7);
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);

  const { data, loading, error, refresh } = useNotFoundRanking({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    days,
  });

  // 用 useMemo 稳定 items 引用；服务端已按 offset/limit 返回本页数据，无需前端切片
  const items = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 榜单每周清空或数据减少后，当前页可能越界，自动收回
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // 切换过滤条件后回到第一页
  const changeDays = (d: number) => {
    setDays(d);
    setPage(1);
  };

  const goPage = (p: number) => {
    setPage(p);
    requestAnimationFrame(() => {
      document
        .getElementById('ranking-anchor')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const showNotice = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2500);
  };

  return (
    <PageContainer width="sm">
      <div id="ranking-anchor" className="-mt-20 pt-20" />

      {/* 标题区 */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">无歌词排行榜</h1>
        <p className="mt-2 text-sm text-ink-2">
          {days === 7 ? '本周' : `最近 ${days} 天内`}
          未找到歌词的歌曲，按请求次数排序（每周一清空）
        </p>
      </div>

      {/* 过滤区 */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-3">时间</span>
          <div className="flex gap-1.5">
            {DAYS_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => changeDays(d)}
                className={`${btnBase} ${days === d ? btnActive : btnIdle}`}
              >
                {d === 7 ? '本周' : `${d} 天`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 瞬时提示 */}
      {notice && (
        <div className="mb-4 rounded-md border border-line bg-surface-2 px-4 py-2 text-sm text-ink-2">
          {notice}
        </div>
      )}

      {/* 内容区 */}
      {loading ? (
        <RankingSkeleton />
      ) : error ? (
        <div className="py-16 text-center">
          <p className="text-error">{error}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className={`${btnBase} ${btnIdle} mt-4`}
          >
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="暂无排行榜数据" description="换个时间范围试试" />
      ) : (
        <>
          {/* 用 animate 而非 whileInView：榜单是页面主体，无需等滚动进入视口；
              且 whileInView + once:true 不会把已完成的 show 变体传播给后挂载的子节点，
              切换时间范围后新出现的行会永久停在 opacity:0 */}
          <motion.ol
            key={`${days}-${page}`}
            initial="hidden"
            animate="show"
            variants={staggerContainer}
            className="divide-y divide-line rounded-lg border border-line bg-card"
          >
            {items.map((item, idx) => {
              const rank = (page - 1) * PAGE_SIZE + idx + 1;
              return (
                <motion.li
                  key={`${item.platform}:${item.platformId}`}
                  variants={listItem}
                  className="flex items-center gap-4 p-4 transition-colors hover:bg-surface-2"
                >
                  <span
                    className={`min-w-8 shrink-0 text-center text-2xl font-bold tabular-nums ${
                      rank === 1 ? 'text-primary' : 'text-ink-3'
                    }`}
                  >
                    {rank}
                  </span>

                  <Cover cover={item.cover} />

                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{item.songName || '未知歌曲'}</div>
                    {item.artists.length > 0 && (
                      <div className="truncate text-sm text-ink-2">{item.artists.join(' / ')}</div>
                    )}
                    <div className="truncate text-xs text-ink-3">
                      <Hash className="mr-1 inline h-3 w-3" />
                      {item.platform}:{item.platformId}
                    </div>
                  </div>

                  <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                    <span className="text-sm text-ink-2">
                      {item.requestCount.toLocaleString('zh-CN')} 次请求
                    </span>
                    {item.lastSeenAt && (
                      <span className="flex items-center gap-1 text-xs text-ink-3">
                        <Clock className="h-3 w-3" />
                        {formatRelativeTime(item.lastSeenAt)}
                      </span>
                    )}
                  </div>

                  <PlayButton item={item} onUnsupported={() => showNotice('暂不支持该平台播放')} />
                </motion.li>
              );
            })}
          </motion.ol>

          {/* 窄屏下的次数/时间 */}

          {/* 分页：真分页下页数可能很多，改用带页码窗口收敛的通用分页条 */}
          <ListPagination
            page={page}
            totalPages={totalPages}
            onPageChange={goPage}
            className="mt-8"
          />

          <p className="mt-4 text-center text-xs text-ink-3">
            共 {total.toLocaleString('zh-CN')} 首 · 第 {page} / {totalPages} 页
          </p>
        </>
      )}
    </PageContainer>
  );
}

/** 封面：有图显示图片，无图占位 */
function Cover({ cover }: { cover: string }) {
  const [failed, setFailed] = useState(false);
  if (!cover || failed) {
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-surface-2">
        <Music className="h-5 w-5 text-ink-3" />
      </div>
    );
  }
  return (
    <img
      src={cover}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="h-12 w-12 shrink-0 rounded object-cover"
    />
  );
}

/** 播放按钮 */
function PlayButton({
  item,
  onUnsupported,
}: {
  item: NotFoundRankingItem;
  onUnsupported: () => void;
}) {
  const { playNcmSong, loading: playerLoading, track } = usePlayer();
  const canPlay = item.platform === 'ncm' || item.platform === 'qq';
  const isCurrent =
    canPlay && track?.ncmSongId === item.platformId && (track?.platform ?? 'ncm') === item.platform;

  const handleClick = () => {
    if (playerLoading) return;
    if (!canPlay) {
      onUnsupported();
      return;
    }
    void playNcmSong(item.platformId, {
      name: item.songName,
      artists: item.artists.join(' / '),
      cover: item.cover ? qmCoverProxy(item.cover) : undefined,
      platform: item.platform as MusicPlatform,
      skipTtml: true,
    });
  };

  return (
    <SimpleTooltip label={isCurrent ? '正在播放' : '播放'}>
      <button
        type="button"
        onClick={handleClick}
        disabled={playerLoading}
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-50 ${
          isCurrent
            ? 'bg-primary-tint text-primary'
            : 'text-ink-3 hover:bg-surface-2 hover:text-primary'
        }`}
      >
        {playerLoading && isCurrent ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </button>
    </SimpleTooltip>
  );
}

/** 骨架屏 */
function RankingSkeleton() {
  return (
    <div className="divide-y divide-line rounded-lg border border-line bg-card">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4">
          <div className="amll-skeleton h-7 w-7 rounded" />
          <div className="amll-skeleton h-12 w-12 rounded" />
          <div className="flex-1 space-y-2">
            <div className="amll-skeleton h-4 w-1/3 rounded" />
            <div className="amll-skeleton h-3 w-1/4 rounded" />
          </div>
          <div className="amll-skeleton h-3 w-20 rounded" />
          <div className="amll-skeleton h-8 w-8 rounded-md" />
        </div>
      ))}
    </div>
  );
}
