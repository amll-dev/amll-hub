import { Cake, CalendarDays, ShieldQuestion, UserRound } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import type { Gender, PublicUserProfile } from '@/lib/types';
import { cn } from '@/lib/utils';

const GENDER_LABEL: Record<Gender, string> = {
  male: '男',
  female: '女',
  other: '其他',
  unknown: '保密',
};

interface RowDef {
  key: string;
  icon: typeof UserRound;
  label: string;
  value: string;
  /** 空值时对本人也隐藏（用户无法自行补全的字段，如加入时间） */
  hideWhenEmpty?: boolean;
}

/** 右栏「个人资料」卡：公开字段 + 加入时间 */
export function ProfileInfoCard({
  profile,
  className,
}: {
  profile: PublicUserProfile;
  className?: string;
}) {
  const rows: RowDef[] = [
    { key: 'name', icon: UserRound, label: '用户名', value: profile.name },
    {
      key: 'birthday',
      icon: Cake,
      label: '生日',
      value: profile.birthday ? formatDate(profile.birthday) : '',
    },
    {
      key: 'gender',
      icon: ShieldQuestion,
      label: '性别',
      // 「保密」等于没填，按空值处理
      value: profile.gender === 'unknown' ? '' : GENDER_LABEL[profile.gender],
    },
    {
      key: 'joined',
      icon: CalendarDays,
      label: '加入时间',
      value: profile.createdTime ? formatDate(profile.createdTime) : '',
      hideWhenEmpty: true,
    },
  ];

  return (
    <Card className={cn('gap-0 p-5', className)}>
      <CardHeader className="px-0">
        <CardTitle className="text-base">个人资料</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pt-3">
        <dl className="divide-y divide-line">
          {rows.map((row) => {
            const empty = !row.value;
            // 访客视角省略空字段；本人视角显示「未填写」提示去补
            // （加入时间这类用户改不了的字段，本人视角也直接隐藏）
            if (empty && (!profile.isSelf || row.hideWhenEmpty)) return null;
            const Icon = row.icon;
            return (
              <div key={row.key} className="flex items-center justify-between gap-4 py-2.5">
                <dt className="flex shrink-0 items-center gap-1.5 text-sm text-ink-3">
                  <Icon className="h-3.5 w-3.5" />
                  {row.label}
                </dt>
                <dd
                  className={cn(
                    'min-w-0 truncate text-sm',
                    empty ? 'text-ink-3' : 'font-medium text-foreground'
                  )}
                >
                  {empty ? '未填写' : row.value}
                </dd>
              </div>
            );
          })}
        </dl>
      </CardContent>
    </Card>
  );
}
