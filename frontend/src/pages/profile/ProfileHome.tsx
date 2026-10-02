import { CalendarRange, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { SectionCard } from '@/components/profile/SectionCard';
import { ProfileUserCard } from '@/components/profile/ProfileUserCard';
import { ContributionWall } from '@/components/profile/ContributionWall';

/** 个人中心首页 */
export function ProfileHome() {
  const { user } = useAuth();
  if (!user) return null;

  const name = user.displayName || user.name;
  const rows: { label: string; value: string }[] = [
    { label: '用户名', value: user.name },
    { label: '昵称', value: name },
    { label: '邮箱', value: user.email || '未绑定' },
    { label: '手机号', value: user.phone || '未绑定' },
  ];

  return (
    /* 入场动画由 ProfileLayout 的右侧容器统一处理，这里不再逐项 stagger */
    <div className="space-y-6">
      <ProfileUserCard user={user} />

      <SectionCard icon={<ShieldCheck />} title="账号概览">
        <dl className="divide-y divide-line">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 py-3">
              <dt className="shrink-0 text-sm text-ink-3">{row.label}</dt>
              <dd className="min-w-0 truncate text-sm font-medium text-foreground">{row.value}</dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="shrink-0 text-sm text-ink-3">身份</dt>
            <dd className="flex flex-wrap items-center justify-end gap-2">
              {user.isAdmin && <Badge>管理员</Badge>}
              {user.isReviewer && <Badge variant="warning">审核员</Badge>}
              {!user.isAdmin && !user.isReviewer && <Badge variant="secondary">普通用户</Badge>}
            </dd>
          </div>
        </dl>
      </SectionCard>

      {/* 活动绿墙：投稿歌词 / 每日推荐 / 歌词IP / 审核歌词 */}
      <SectionCard icon={<CalendarRange />} title="活动记录">
        <ContributionWall username={user.name} />
      </SectionCard>
    </div>
  );
}
