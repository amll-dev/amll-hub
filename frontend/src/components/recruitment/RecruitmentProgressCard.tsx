import { Link } from 'react-router-dom';
import { UsersRound } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { useRecruitmentDashboard } from '@/hooks/useRecruitment';
import type { RecruitmentDashboard } from '@/lib/types';
import { langText, statusMeta } from '@/components/submission/status';
import { conditionFields } from './types';

export function RecruitmentProgress({
  data,
  participantView = false,
}: {
  data: Pick<RecruitmentDashboard, 'active' | 'members'> &
    Partial<Pick<RecruitmentDashboard, 'submissions'>>;
  participantView?: boolean;
}) {
  const submissions = data.submissions ?? [];
  const plan = data.active;
  if (!plan) return null;
  return (
    <section
      className="col-span-full space-y-5 rounded-lg border border-line bg-card p-5 sm:p-6"
      aria-label="审核招募进度"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <UsersRound className="h-4 w-4" />
          审核招募进度
        </h3>
        <span
          className={`rounded-full px-3 py-1 text-xs ${plan.status === 'ending' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}
        >
          {plan.status === 'ending' ? '快结束' : '进行中'}
        </span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm text-ink-2">{plan.announcement}</p>
      <div className={`grid grid-cols-2 gap-4 ${participantView ? '' : 'sm:grid-cols-4'}`}>
        <div>
          <p className="text-xs text-ink-3">参与人数</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{plan.participantCount}</p>
        </div>
        {!participantView && (
          <div>
            <p className="text-xs text-ink-3">完成人数 / 招募目标</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {plan.completedCount} / {plan.targetMembers || '不限'}
            </p>
          </div>
        )}
        {!participantView && (
          <div>
            <p className="text-xs text-ink-3">投稿 / 系统通过</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {submissions.length} /{' '}
              {submissions.filter((item) => item.status === 'approved').length}
            </p>
          </div>
        )}
        <div>
          <p className="text-xs text-ink-3">截止日期零时（北京时间）</p>
          <p className="mt-1 text-sm font-semibold">
            {plan.endsOn ? formatDate(plan.endsOn) : '达到人数目标时'}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-4 rounded-md bg-background p-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-ink-3">投稿语言</dt>
          <dd className="mt-1 text-sm">{plan.languages.map(langText).join('、')}</dd>
        </div>
        {conditionFields.map(({ key, label }) => (
          <div key={key}>
            <dt className="text-xs text-ink-3">{label}</dt>
            <dd className="mt-1 text-sm tabular-nums">{plan.conditions[key]}</dd>
          </div>
        ))}
      </dl>
      {data.members.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">{participantView ? '我的参与进度' : '参与者进度'}</h4>
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.members.map((member) => (
              <li
                key={member.username}
                className="flex flex-wrap justify-between gap-2 rounded border border-line p-3 text-sm"
              >
                <span>{member.userInfo.displayName || member.username}</span>
                <span className="text-ink-3">
                  有效投稿 {member.validSubmissions} / {member.requiredSubmissions} · 迭代{' '}
                  {member.attempts}
                  {member.status === 'completed' ? ' · 已完成' : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!participantView && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">参与招募的投稿</h4>
          {submissions.length === 0 ? (
            <p className="text-sm text-ink-3">暂无参与招募的投稿</p>
          ) : (
            <ul className="divide-y divide-line">
              {submissions.map((item) => (
                <li key={item.id}>
                  <Link
                    to={`/review/detail?id=${item.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded px-2 py-3 text-sm transition-colors hover:bg-surface-2"
                  >
                    <span className="min-w-0 break-words">
                      {item.title || `投稿 #${item.id}`}{' '}
                      <span className="text-ink-3">@{item.submitter}</span>
                    </span>
                    <span className="text-ink-3">
                      {statusMeta[item.status]?.label || item.status} · 接受 {item.approvals} /{' '}
                      {item.requiredApprovals} · 修改意见 {item.revisions}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** 审核管理首页使用，与招募仪表板共享请求及展示。 */
export function RecruitmentProgressCard() {
  const query = useRecruitmentDashboard();
  if (!query.data?.active) return null;
  return <RecruitmentProgress data={query.data} />;
}
