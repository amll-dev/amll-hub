import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Music } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { RecommendCard, SkeletonCard } from '@/components/RecommendCard';
import { whileInViewProps } from '@/lib/motion';
import { EmptyState } from '@/components/ui/EmptyState';

export function TodayRecommend() {
  const {
    data: rec,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.todayRecommendation,
    queryFn: () => api.getTodayRecommendation(),
    staleTime: 60_000,
  });

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

      {isPending ? (
        <SkeletonCard compact />
      ) : error ? (
        // 接口挂了要和「今日确实没有推荐」区分开，避免首页显示「暂无推荐」
        <EmptyState
          icon={Music}
          title="加载失败"
          description="今日推荐暂时无法加载"
          action={
            <button
              type="button"
              onClick={() => void refetch()}
              className="inline-flex h-9 items-center rounded-md border border-input bg-card px-4 text-sm text-ink-2 transition-colors hover:bg-surface-2"
            >
              重试
            </button>
          }
        />
      ) : rec ? (
        <RecommendCard recommendation={rec} compact />
      ) : (
        <EmptyState
          icon={Music}
          title="今日暂无推荐"
          description="成为今天第一个投稿的人"
          action={
            <Link
              to="/creator"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              去投稿
            </Link>
          }
        />
      )}
    </motion.section>
  );
}
