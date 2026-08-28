import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Music } from 'lucide-react';
import { api } from '@/lib/api';
import type { DailyRecommendation } from '@/lib/types';
import { RecommendCard, SkeletonCard } from '@/components/RecommendCard';
import { whileInViewProps } from '@/lib/motion';

export function TodayRecommend() {
  const [rec, setRec] = useState<DailyRecommendation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getTodayRecommendation()
      .then((data) => {
        if (!cancelled) setRec(data);
      })
      .catch(() => {
        if (!cancelled) setRec(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <motion.section {...whileInViewProps} variants={{ hidden: {}, show: {} }}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold">今日推荐</h2>
        <Link
          to="/daily"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          更多推荐 <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {loading ? (
        <SkeletonCard compact />
      ) : rec ? (
        <RecommendCard recommendation={rec} compact />
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-line bg-card px-6 py-12 text-center">
          <Music className="h-10 w-10 text-ink-3" />
          <p className="mt-3 text-sm text-ink-2">今日暂无推荐</p>
          <Link
            to="/creator"
            className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            去投稿
          </Link>
        </div>
      )}
    </motion.section>
  );
}
