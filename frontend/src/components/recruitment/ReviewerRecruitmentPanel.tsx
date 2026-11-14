import { useState } from 'react';
import { ArrowLeft, History, Plus, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { UserAvatar } from '@/components/submission/UserAvatar';

export interface RecruitmentMember {
  name: string;
  displayName: string;
  avatar?: string;
}

export function ReviewerRecruitmentPanel({ members = [] }: { members?: RecruitmentMember[] }) {
  const [creating, setCreating] = useState(false);

  if (creating) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
          <ArrowLeft />
          返回
        </Button>
        <h2 className="text-xl font-bold tracking-tight text-foreground">发布招募</h2>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-bold tracking-tight text-foreground">审核招募</h2>
        <Button onClick={() => setCreating(true)}>
          <Plus />
          发起招募
        </Button>
      </div>

      <section
        className="rounded-lg border border-line bg-card p-5 sm:p-6"
        aria-labelledby="recruitment-team-title"
      >
        <h3
          id="recruitment-team-title"
          className="mb-5 flex items-center gap-2 text-base font-semibold text-foreground"
        >
          <UsersRound className="h-4 w-4 text-ink-3" />
          当前审核团队
          <span className="text-sm font-normal tabular-nums text-ink-3">{members.length}</span>
        </h3>
        {members.length === 0 ? (
          <EmptyState icon={UsersRound} title="暂无审核团队数据" />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {members.map((member) => (
              <li
                key={member.name}
                className="flex items-center gap-3 rounded-md border border-line bg-background p-4"
              >
                <UserAvatar
                  name={member.displayName || member.name}
                  avatar={member.avatar}
                  size={40}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {member.displayName || member.name}
                  </p>
                  <p className="mt-1 truncate text-xs text-ink-3">@{member.name}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="rounded-lg border border-line bg-card p-5 sm:p-6"
        aria-labelledby="recruitment-history-title"
      >
        <h3
          id="recruitment-history-title"
          className="mb-5 flex items-center gap-2 text-base font-semibold text-foreground"
        >
          <History className="h-4 w-4 text-ink-3" />
          历史招募记录
        </h3>
        <EmptyState icon={History} title="暂无招募记录" />
      </section>
    </div>
  );
}
