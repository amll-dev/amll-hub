import { BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { statusMeta } from '@/components/submission/status';
import { cn } from '@/lib/utils';
import type { PublicUserProfile, SubmissionStatus } from '@/lib/types';

/** 展示顺序 + 配色（颜色走 token，暗色主题自动适配） */
const ORDER: { key: SubmissionStatus; bar: string }[] = [
  { key: 'approved', bar: 'bg-success' },
  { key: 'pending', bar: 'bg-warning' },
  { key: 'reviewing', bar: 'bg-info' },
  { key: 'revised', bar: 'bg-purple-500' },
  { key: 'need_revision', bar: 'bg-orange-500' },
  { key: 'missing_audio', bar: 'bg-orange-500' },
  { key: 'rejected', bar: 'bg-error' },
  { key: 'draft', bar: 'bg-ink-3/40' },
  { key: 'closed', bar: 'bg-ink-3/40' },
];

/** 右栏「投稿分布」卡：本人看完整分布，访客只看已通过数 */
export function SubmissionDistributionCard({
  profile,
  className,
}: {
  profile: PublicUserProfile;
  className?: string;
}) {
  const stats = profile.stats ?? {};
  const approved = stats.approved ?? 0;

  if (!profile.isSelf) {
    return (
      <Card className={cn('gap-0 p-5', className)}>
        <CardHeader className="px-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-ink-3" />
            投稿
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pt-3">
          <p className="text-sm text-ink-2">
            已通过 <span className="text-lg font-bold text-foreground">{approved}</span> 篇
          </p>
          {approved === 0 && <p className="mt-1 text-xs text-ink-3">该用户还没有通过审核的投稿</p>}
        </CardContent>
      </Card>
    );
  }

  const rows = ORDER.map((o) => ({
    ...o,
    count: stats[o.key] ?? 0,
    label: statusMeta[o.key]?.label ?? o.key,
  })).filter((r) => r.count > 0);
  const total = rows.reduce((n, r) => n + r.count, 0);

  return (
    <Card className={cn('gap-0 p-5', className)}>
      <CardHeader className="px-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-4 w-4 text-ink-3" />
          投稿分布
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pt-3">
        {rows.length === 0 ? (
          <p className="text-sm text-ink-3">还没有投稿</p>
        ) : (
          <div className="space-y-2.5">
            {rows.map((r) => (
              <div key={r.key}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ink-2">{r.label}</span>
                  <span className="font-medium text-foreground">{r.count}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={cn('h-full rounded-full', r.bar)}
                    style={{ width: `${total > 0 ? (r.count / total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
            <p className="pt-1 text-xs text-ink-3">共 {total} 篇</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
