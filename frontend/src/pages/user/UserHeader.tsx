import { Link } from 'react-router-dom';
import { Cake, Pencil, UserRound } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';
import type { Gender, PublicUserProfile } from '@/lib/types';

const GENDER_LABEL: Record<Gender, string> = {
  male: '男',
  female: '女',
  other: '其他',
  unknown: '保密',
};

/** 主页头部：头像叠在 banner 上 + 昵称 / 用户名 / 签名 / 元信息 */
export function UserHeader({ profile }: { profile: PublicUserProfile }) {
  const initial = (profile.displayName || profile.name || '?').charAt(0).toUpperCase();

  const meta: { key: string; icon: typeof Cake; text: string }[] = [
    {
      key: 'birthday',
      icon: Cake,
      text: profile.birthday ? formatDate(profile.birthday) : '',
    },
    {
      key: 'gender',
      icon: UserRound,
      text: profile.gender === 'unknown' ? '' : GENDER_LABEL[profile.gender],
    },
  ].filter((m) => m.text !== '');

  return (
    <div className="relative">
      <div className="-mt-14 flex flex-wrap items-end justify-between gap-4 sm:-mt-16">
        <div className="flex min-w-0 items-end gap-4">
          <Avatar className="h-24 w-24 shrink-0 ring-4 ring-background sm:h-28 sm:w-28">
            {profile.avatar && <AvatarImage src={profile.avatar} alt="" />}
            <AvatarFallback className="text-3xl">{initial}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 pb-1">
            <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">
              {profile.displayName || profile.name}
            </h1>
            <p className="mt-0.5 truncate text-sm text-ink-3">@{profile.name}</p>
          </div>
        </div>

        {profile.isSelf && (
          <div className="pb-1">
            <Button asChild variant="secondary" size="sm">
              <Link to="/profile/info">
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                编辑资料
              </Link>
            </Button>
          </div>
        )}
      </div>

      {profile.bio ? (
        <p className="mt-3 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-ink-2">
          {profile.bio}
        </p>
      ) : (
        profile.isSelf && (
          <p className="mt-3 text-sm text-ink-3">
            还没有个性签名，
            <Link to="/profile/info" className="text-primary hover:underline">
              去写一句
            </Link>
          </p>
        )
      )}

      {meta.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
          {meta.map((m) => {
            const Icon = m.icon;
            return (
              <span key={m.key} className="inline-flex items-center gap-1">
                <Icon className="h-3.5 w-3.5" />
                {m.text}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
