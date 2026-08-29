import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import type { DailyRecommendation } from '@/lib/types';
import { DailyCalendar } from '@/components/DailyCalendar';
import { RecommendCard, SkeletonCard, EmptyState } from '@/components/RecommendCard';
import { PageContainer } from '@/components/PageContainer';
import { whileInViewProps } from '@/lib/motion';

/** 格式化日期为 YYYY-MM-DD */
function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 校验是否为合法 YYYY-MM-DD 日期字符串 */
function isValidDateKey(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = new Date(s + 'T00:00:00');
  return !isNaN(t.getTime());
}

export function DailyRecommend() {
  const today = useMemo(() => new Date(), []);
  const todayKey = formatDateKey(today);
  const [searchParams] = useSearchParams();

  // 优先从 URL ?date=YYYY-MM-DD 读取，回退到今天
  const initialDate = useMemo(() => {
    const d = searchParams.get('date');
    return d && isValidDateKey(d) ? d : todayKey;
  }, [searchParams, todayKey]);

  const [selectedDate, setSelectedDate] = useState(initialDate);

  // URL ?date 变化时同步 selectedDate
  useEffect(() => {
    setSelectedDate(initialDate);
  }, [initialDate]);

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.dailyList,
    queryFn: () => api.listDailyRecommendations(),
    staleTime: 60_000,
  });
  const recommendations = useMemo(() => data ?? [], [data]);
  const errorMsg = error instanceof Error ? error.message : error ? '加载失败' : '';

  const recommendMap = useMemo(() => {
    const map = new Map<string, DailyRecommendation>();
    for (const rec of recommendations) {
      map.set(rec.date, rec);
    }
    return map;
  }, [recommendations]);

  const recommendDates = useMemo(
    () => new Set(recommendations.map((r) => r.date)),
    [recommendations]
  );

  const selectedRec = recommendMap.get(selectedDate);
  const selectedDateObj = useMemo(() => new Date(selectedDate), [selectedDate]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-ink-2 transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          返回主站
        </Link>
      </div>

      <PageContainer className="pb-16 pt-8">
        <motion.div {...whileInViewProps} className="mb-8">
          <h1 className="m-0 text-[32px] font-semibold text-foreground">每日推荐</h1>
          <p className="mt-1 text-base text-ink-2">发现每日精选音乐推荐</p>
        </motion.div>

        {errorMsg ? (
          <div className="py-20 text-center">
            <p className="text-sm text-error">{errorMsg}</p>
          </div>
        ) : (
          <div
            className="grid items-start gap-8 max-md:grid-cols-1"
            style={{ gridTemplateColumns: 'auto 1fr' }}
          >
            <motion.div {...whileInViewProps}>
              <DailyCalendar
                recommendDates={recommendDates}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
              />
            </motion.div>

            <motion.div {...whileInViewProps} className="flex w-full justify-center">
              {isPending ? (
                <SkeletonCard />
              ) : selectedRec ? (
                // key 绑定推荐 id：切换日期时重新挂载，点赞状态/计数随之刷新
                <RecommendCard key={selectedRec.id} recommendation={selectedRec} />
              ) : (
                <EmptyState date={selectedDateObj} />
              )}
            </motion.div>
          </div>
        )}
      </PageContainer>
    </motion.div>
  );
}
