import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Music } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useNotFoundRanking } from '@/hooks/useNotFoundRanking';
import { listItem, staggerContainer, whileInViewProps } from '@/lib/motion';

const TOP_LIMIT = 5;

export function NotFoundRanking() {
  const { data, loading, error } = useNotFoundRanking({
    limit: TOP_LIMIT,
    days: 7,
  });
  const items = data?.items ?? [];

  return (
    <motion.section {...whileInViewProps} variants={staggerContainer}>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold">请求数最高的待补歌词</h2>
        <Link
          to="/ranking"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          查看完整排行 <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <ol className="divide-y divide-line rounded-lg border border-line bg-card">
        {loading ? (
          Array.from({ length: TOP_LIMIT }).map((_, i) => (
            <li key={i} className="flex items-center gap-4 p-4">
              <div className="amll-skeleton h-7 w-7 rounded" />
              <div className="amll-skeleton h-10 w-10 rounded" />
              <div className="flex-1 space-y-2">
                <div className="amll-skeleton h-4 w-1/3 rounded" />
                <div className="amll-skeleton h-3 w-1/4 rounded" />
              </div>
              <div className="amll-skeleton h-3 w-16 rounded" />
            </li>
          ))
        ) : error ? (
          <li className="p-4 text-sm text-error">{error}</li>
        ) : items.length === 0 ? (
          <li className="p-6 text-center text-sm text-ink-3">暂无数据</li>
        ) : (
          items.map((item, idx) => (
            <motion.li
              key={`${item.platform}:${item.platformId}`}
              variants={listItem}
              className="flex items-center gap-4 p-4 transition-colors hover:bg-surface-2"
            >
              <span
                className={`w-8 text-center text-2xl font-bold ${
                  idx === 0 ? 'text-primary' : 'text-ink-3'
                }`}
              >
                {idx + 1}
              </span>
              <Cover cover={item.cover} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{item.songName || '未知歌曲'}</div>
                {item.artists.length > 0 && (
                  <div className="truncate text-sm text-ink-2">{item.artists.join(' / ')}</div>
                )}
              </div>
              <span className="shrink-0 text-sm text-ink-2">
                {item.requestCount.toLocaleString('zh-CN')} 次请求
              </span>
            </motion.li>
          ))
        )}
      </ol>
    </motion.section>
  );
}

/** 封面 */
function Cover({ cover }: { cover: string }) {
  const [failed, setFailed] = useState(false);
  if (!cover || failed) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-surface-2">
        <Music className="h-4 w-4 text-ink-3" />
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
      className="h-10 w-10 shrink-0 rounded object-cover"
    />
  );
}
