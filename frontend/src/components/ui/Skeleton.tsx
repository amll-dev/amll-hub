import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** 骨架屏基础块（shadcn Skeleton）：animate-pulse 灰块，尺寸由 className 控制 */
function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('animate-pulse rounded-md bg-surface-2', className)} {...props} />;
}

/** 投稿列表骨架屏 */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="加载中" className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-md border border-line bg-background px-4 py-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-10" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-4 w-12 rounded-full" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 卡片式详情骨架屏 */
export function CardDetailSkeleton() {
  return (
    <div role="status" aria-label="加载中">
      {/* 返回按钮占位 */}
      <Skeleton className="mb-4 h-4 w-16" />
      <div className="rounded-lg border border-line bg-card p-6">
        {/* 标题 + 状态 */}
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-5 w-14" />
        </div>
        {/* 投稿人 + 时间 */}
        <div className="mt-3 flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded-full" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
        {/* 内容区 */}
        <div className="mt-6 space-y-3">
          <Skeleton className="h-40 w-full rounded-md" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-5/6" />
          <Skeleton className="h-3.5 w-3/4" />
        </div>
      </div>
    </div>
  );
}

/** 歌词投稿详情骨架屏 */
export function LyricDetailSkeleton() {
  return (
    <div role="status" aria-label="加载中" className="space-y-4 pb-24">
      {/* 标题卡片 */}
      <div className="rounded-lg border border-line bg-card p-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 flex-1 max-w-2/5" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded-full" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-36" />
        </div>
      </div>
      {/* 主体 + 侧边栏 */}
      <div className="flex gap-5">
        <div className="min-w-0 flex-1 space-y-5">
          {/* tab 栏 */}
          <div className="flex gap-2">
            <Skeleton className="h-8 w-14 rounded-md" />
            <Skeleton className="h-8 w-14 rounded-md" />
            <Skeleton className="h-8 w-14 rounded-md" />
          </div>
          {/* 内容卡片 */}
          <div className="space-y-3 rounded-lg border border-line bg-card p-4">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        </div>
        {/* 侧边栏 */}
        <div className="hidden w-72 shrink-0 space-y-4 lg:block">
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
