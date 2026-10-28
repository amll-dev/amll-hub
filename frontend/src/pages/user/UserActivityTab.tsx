import { CalendarRange } from 'lucide-react';
import { SectionCard } from '@/components/profile/SectionCard';
import { ContributionWall } from '@/components/profile/ContributionWall';

/** 主页 Tab：贡献墙（本人含审核行为，访客只统计已通过投稿） */
export function UserActivityTab({ name, isSelf }: { name: string; isSelf: boolean }) {
  return (
    <SectionCard
      icon={<CalendarRange />}
      title="活动记录"
      description={isSelf ? '投稿与审核的每日活跃情况' : '该用户已通过投稿的每日活跃情况'}
    >
      <ContributionWall username={name} scope={isSelf ? 'me' : 'user'} />
    </SectionCard>
  );
}
