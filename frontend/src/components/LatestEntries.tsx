import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Music } from 'lucide-react';
import { api } from '@/lib/api';
import type { LatestSongItem } from '@/lib/types';
import { staggerContainer, whileInViewProps } from '@/lib/motion';

export function LatestEntries() {
  const [items, setItems] = useState<LatestSongItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getLatestSongs()
      .then((data) => {
        if (!cancelled) setItems(data ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <motion.section {...whileInViewProps} variants={staggerContainer}>
      <h2 className="mb-4 text-xl font-bold">最新收录</h2>
      {loading ? (
        <ul className="space-y-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex animate-pulse items-center gap-3 rounded-md p-2">
              <span className="w-6" />
              <div className="h-12 w-12 shrink-0 rounded-md bg-surface-2" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/4 rounded bg-surface-2" />
                <div className="h-2 w-1/2 rounded bg-surface-2" />
              </div>
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-card py-12 text-center">
          <Music className="h-10 w-10 text-ink-3" />
          <p className="mt-3 text-sm text-ink-2">暂无数据</p>
        </div>
      ) : (
        <ul className="space-y-1">
          {items.map((e, idx) => (
            <motion.li
              key={e.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{
                duration: 0.5,
                ease: [0.2, 0.8, 0.2, 1],
                delay: Math.min(idx * 0.06, 0.4),
              }}
              className="flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-surface-2"
            >
              <span className="w-6 text-center text-sm text-ink-3">{idx + 1}</span>
              {e.coverUrl ? (
                <img
                  src={e.coverUrl}
                  alt={e.title}
                  className="h-12 w-12 shrink-0 rounded-md object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary-tint to-muted text-base font-bold text-primary">
                  {e.title.charAt(0)}
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{e.title}</div>
                <div className="truncate text-xs text-ink-2">{e.artist}</div>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
    </motion.section>
  );
}
