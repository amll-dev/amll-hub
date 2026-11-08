import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import type { PluginDetailResult, PluginRatingSummary } from '@/lib/types';

const STAR_COLOR = 'text-[#f0a63a]';
const EMPTY_STAR_COLOR = 'text-ink-3/35';

/** 只读星级 */
export function RatingStars({
  score,
  size = 14,
  className,
}: {
  score: number;
  size?: number;
  className?: string;
}) {
  const filled = Math.round(score);
  return (
    <span
      className={cn('inline-flex items-center gap-0.5', className)}
      aria-label={score > 0 ? `${score.toFixed(1)} 星` : '暂无评分'}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          className={cn('shrink-0', i < filled ? cn('fill-current', STAR_COLOR) : EMPTY_STAR_COLOR)}
        />
      ))}
    </span>
  );
}

/** 卡片/列表里的评分 */
export function RatingInline({ rating }: { rating: PluginRatingSummary }) {
  if (!rating?.count) {
    return <span className="text-[11px] text-ink-3">暂无评分</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-ink-3">
      <RatingStars score={rating.score} size={11} />
      <span className="font-medium text-ink-2">{rating.score.toFixed(1)}</span>
    </span>
  );
}

/** 详情页评分面板 */
export function PluginRatingPanel({
  pluginKey,
  pluginName,
  rating,
  myScore,
}: {
  pluginKey: string;
  pluginName: string;
  rating: PluginRatingSummary;
  myScore: number;
}) {
  const { user, openLogin } = useAuth();
  const queryClient = useQueryClient();
  const [hovered, setHovered] = useState(0);

  const mutation = useMutation({
    mutationFn: (score: number) => api.pluginStore.rate(pluginKey, score),
    onSuccess: (data) => {
      queryClient.setQueryData<PluginDetailResult>(queryKeys.pluginDetail(pluginKey), (old) =>
        old ? { ...old, rating: data.rating, myScore: data.myScore } : old
      );
      queryClient.invalidateQueries({ queryKey: ['plugins', 'list'] });
      toast.success(myScore > 0 ? '评分已更新' : '感谢你的评分');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '评分失败，请稍后再试');
    },
  });

  const count = rating?.count ?? 0;
  const distribution = rating?.distribution ?? {};
  const activeScore = hovered || myScore;

  const rate = (score: number) => {
    if (!user) {
      openLogin(window.location.pathname + window.location.search);
      return;
    }
    if (mutation.isPending) return;
    mutation.mutate(score);
  };

  return (
    <section className="rounded-2xl border border-line bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">评分</h2>

      <div className="mt-4 flex items-start gap-5">
        <div className="shrink-0">
          <p className="text-4xl leading-none font-bold tracking-tight text-foreground">
            {count > 0 ? rating.score.toFixed(1) : '—'}
          </p>
          <RatingStars score={rating?.score ?? 0} className="mt-2" size={13} />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
          {[5, 4, 3, 2, 1].map((star) => {
            const total = distribution[String(star)] ?? 0;
            const percent = count > 0 ? (total / count) * 100 : 0;
            return (
              <div key={star} className="flex items-center gap-2">
                <span className="inline-flex w-7 shrink-0 items-center justify-end gap-0.5 text-[11px] text-ink-3">
                  {star}
                  <Star className="h-2.5 w-2.5 fill-current text-ink-3/60" />
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <span
                    className="block h-full rounded-full bg-[#f0a63a] transition-[width] duration-300"
                    style={{ width: `${percent}%` }}
                  />
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-3 text-[11px] text-ink-3">
        {count > 0 ? `${count} 个评分` : '还没有评分，来给出第一条评价吧'}
      </p>

      <div className="mt-4 border-t border-line pt-4">
        <p className="text-xs text-ink-2">
          {myScore > 0
            ? `你已评价 ${myScore} 星，点击可修改`
            : `你如何评价 ${pluginName}？`}
        </p>
        <div
          className="mt-2 flex items-center gap-1"
          role="radiogroup"
          aria-label="选择评分"
          onMouseLeave={() => setHovered(0)}
        >
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={myScore === star}
              aria-label={`${star} 星`}
              disabled={mutation.isPending}
              onMouseEnter={() => setHovered(star)}
              onFocus={() => setHovered(star)}
              onBlur={() => setHovered(0)}
              onClick={() => rate(star)}
              className="rounded-md p-0.5 transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed"
            >
              <Star
                className={cn(
                  'h-5 w-5 transition-colors',
                  star <= activeScore ? cn('fill-current', STAR_COLOR) : EMPTY_STAR_COLOR
                )}
              />
            </button>
          ))}
        </div>
        {!user && <p className="mt-1.5 text-[11px] text-ink-3">登录后即可评分</p>}
      </div>
    </section>
  );
}
