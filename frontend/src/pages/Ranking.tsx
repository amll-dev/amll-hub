import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Clock, Hash, Loader2, Music, Play } from 'lucide-react';
import { useNotFoundRanking } from '@/hooks/useNotFoundRanking';
import { usePlayer } from '@/hooks/usePlayer';
import { listItem, staggerContainer, whileInViewProps } from '@/lib/motion';
import type { NotFoundRankingItem } from '@/lib/types';

const PAGE_SIZE = 20;
const FETCH_LIMIT = 50;

const DAYS_OPTIONS = [1, 3, 7] as const;

// 三态按钮基础样式
const btnBase =
  'inline-flex h-9 items-center justify-center rounded-md px-3 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const btnIdle = 'border border-input bg-card text-ink-2 hover:border-primary hover:text-primary';
const btnActive = 'bg-primary text-primary-foreground';

/** 相对时间格式化（如“3 小时前”） */
function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  return new Date(iso).toLocaleString('zh-CN');
}

export function Ranking() {
  const [days, setDays] = useState<number>(7);
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);

  const { data, loading, error, refresh } = useNotFoundRanking({
    limit: FETCH_LIMIT,
    days,
  });

  // 用 useMemo 稳定 items 引用（`?? []` 每次渲染都会新建数组，导致 pageItems 缓存失效）
  const items = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pageItems = useMemo(
    () => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [items, page]
  );

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
    <div className="mx-auto max-w-[1100px] px-6 py-12">
      <div id="ranking-anchor" className="-mt-20 pt-20" />

      {/* 标题区 */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">无歌词排行榜</h1>
        <p className="mt-2 text-sm text-ink-2">
          最近 {days} 天内未找到歌词的歌曲，按请求次数排序（每周一清空）
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
                {d} 天
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
          <button type="button" onClick={refresh} className={`${btnBase} ${btnIdle} mt-4`}>
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center text-ink-2">暂无排行榜数据</div>
      ) : (
        <>
          <motion.ol
            key={page}
            {...whileInViewProps}
            variants={staggerContainer}
            className="divide-y divide-line rounded-lg border border-line bg-card"
          >
            {pageItems.map((item, idx) => {
              const rank = (page - 1) * PAGE_SIZE + idx + 1;
              return (
                <motion.li
                  key={`${item.platform}:${item.platformId}`}
                  variants={listItem}
                  className="flex items-center gap-4 p-4 transition-colors hover:bg-surface-2"
                >
                  <span
                    className={`w-8 shrink-0 text-center text-2xl font-bold ${
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

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-1.5">
              <button
                type="button"
                onClick={() => goPage(page - 1)}
                disabled={page <= 1}
                className={`${btnBase} ${btnIdle}`}
                aria-label="上一页"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => goPage(p)}
                  className={`${btnBase} ${p === page ? btnActive : btnIdle}`}
                >
                  {p}
                </button>
              ))}
              <button
                type="button"
                onClick={() => goPage(page + 1)}
                disabled={page >= totalPages}
                className={`${btnBase} ${btnIdle}`}
                aria-label="下一页"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {total > items.length && (
            <p className="mt-4 text-center text-xs text-ink-3">
              仅显示前 {items.length} 条（共 {total.toLocaleString('zh-CN')} 条）
            </p>
          )}
        </>
      )}
    </div>
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
      onError={() => setFailed(true)}
      className="h-12 w-12 shrink-0 rounded object-cover"
    />
  );
}

/** 播放按钮：ncm 直接播放，其他平台提示不支持 */
function PlayButton({
  item,
  onUnsupported,
}: {
  item: NotFoundRankingItem;
  onUnsupported: () => void;
}) {
  const { playNcmSong, loading: playerLoading, track } = usePlayer();
  const isCurrent = item.platform === 'ncm' && track?.ncmSongId === item.platformId;

  const handleClick = () => {
    if (playerLoading) return;
    if (item.platform !== 'ncm') {
      onUnsupported();
      return;
    }
    void playNcmSong(item.platformId, {
      name: item.songName,
      artists: item.artists.join(' / '),
      cover: item.cover,
      skipTtml: true,
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={playerLoading}
      title={isCurrent ? '正在播放' : '播放'}
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
