import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowRight, ScrollText } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { staggerContainer, whileInViewProps } from '@/lib/motion';
import { RequestCard } from '@/components/petition/RequestCard';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/Skeleton';

export function PetitionList() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.lyricRequestHot(4),
    queryFn: () => api.getHotLyricRequests(4),
  });

  const items = data?.items ?? [];

  return (
    <motion.section {...whileInViewProps} variants={staggerContainer}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">歌词请愿</h2>
        </div>
        <Link to="/creator/requests" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          查看全部
          <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Link>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-card py-12 text-center">
          <ScrollText className="h-8 w-8 text-ink-3" />
          <p className="mt-3 text-sm text-ink-2">还没有人发起请愿</p>
          <p className="mt-1 text-xs text-ink-3">想听的歌缺歌词？去创作中心发起第一条请愿</p>
          <Link
            to="/creator?tab=requests"
            className={buttonVariants({ size: 'sm', className: 'mt-4' })}
          >
            发起请愿
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <RequestCard key={item.id} request={item} compact />
          ))}
        </div>
      )}
    </motion.section>
  );
}
