import { Link } from 'react-router-dom';
import { ShieldCheck, UserCog } from 'lucide-react';
import type { UserProfile } from '@/lib/auth';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** 顶部用户卡片 */
export function ProfileUserCard({ user }: { user: UserProfile }) {
  const initial = (user.displayName || user.name || '?').charAt(0).toUpperCase();
  const name = user.displayName || user.name;

  return (
    <Card className="gap-0 p-6">
      <div className="flex flex-wrap items-center gap-5">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-xl font-semibold text-primary-foreground">
          {user.avatar ? (
            <img
              src={user.avatar}
              alt={name}
              decoding="async"
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            initial
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-lg font-bold text-primary">{name}</span>
            {user.isAdmin && <Badge>管理员</Badge>}
            {user.isReviewer && <Badge variant="warning">审核员</Badge>}
            {!user.isAdmin && !user.isReviewer && <Badge variant="secondary">普通用户</Badge>}
          </div>
          <p className="mt-1 truncate text-sm text-ink-3">@{user.name}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link to="/profile/info">
              <UserCog />
              修改资料
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/profile/security">
              <ShieldCheck />
              账号安全
            </Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}
