import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { RecruitmentPayload } from '@/lib/types';
import { RecruitmentProgress } from './RecruitmentProgressCard';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { fadeUp, staggerContainer, buttonTap } from '@/lib/motion';
import { ChevronDown, History, Plus, UsersRound } from 'lucide-react';
import { RecruitmentForm } from './RecruitmentForm';
import { conditionFields } from './types';
import { langText } from '@/components/submission/status';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { UserAvatar } from '@/components/submission/UserAvatar';

export interface RecruitmentMember {
  name: string;
  displayName: string;
  avatar?: string;
}

export function ReviewerRecruitmentPanel() {
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['reviewer-recruitment', 'dashboard'], queryFn: api.reviewerRecruitment.dashboard, refetchInterval: 30_000 });
  const records = query.data?.history ?? [];
  const members = query.data?.team ?? [];
  const create = useMutation({
    mutationFn: (payload: RecruitmentPayload) => api.reviewerRecruitment.create(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reviewer-recruitment'] });
      setCreating(false);
    },
  });

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={creating ? 'create' : 'dashboard'}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
        >
          {creating ? (
            <RecruitmentForm
              onCancel={() => setCreating(false)}
              pending={create.isPending}
              error={create.error instanceof Error ? create.error.message : undefined}
              onComplete={(draft) => {
                try {
                  create.mutate({ ...draft, id: crypto.randomUUID() });
                } catch {
                  // randomUUID 需要安全上下文，避免生成不可追溯的临时 ID。
                  window.alert('无法生成招募编号，请通过 HTTPS 或 localhost 打开本站');
                }
              }}
            />
          ) : (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="show"
              className="space-y-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <h2 className="text-xl font-bold tracking-tight text-foreground">审核招募</h2>
                <motion.div {...buttonTap}>
                  <Button disabled={query.isPending || query.isError || Boolean(query.data?.active)} onClick={() => { create.reset(); setCreating(true); }}>
                    <Plus />
                    发起招募
                  </Button>
                </motion.div>
              </div>

              {query.isPending && <p className="text-sm text-ink-3">正在加载招募信息…</p>}
              {query.error && <p role="alert" className="text-sm text-error">{query.error instanceof Error ? query.error.message : '加载招募信息失败'}</p>}
              {query.data?.active && <RecruitmentProgress data={query.data} />}

              <motion.section
                variants={fadeUp}
                className="rounded-lg border border-line bg-card p-5 sm:p-6"
                aria-labelledby="recruitment-team-title"
              >
                <h3
                  id="recruitment-team-title"
                  className="mb-5 flex items-center gap-2 text-base font-semibold text-foreground"
                >
                  <UsersRound className="h-4 w-4 text-ink-3" />
                  当前审核团队
                  <span className="text-sm font-normal tabular-nums text-ink-3">
                    {members.length}
                  </span>
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
              </motion.section>

              <motion.section
                variants={fadeUp}
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
                {records.length === 0 ? (
                  <EmptyState icon={History} title="暂无招募记录" />
                ) : (
                  <ul className="space-y-3">
                    {records.map((record) => (
                      <li key={record.id}>
                        <div className="rounded-md border border-line bg-background">
                          <button
                            type="button"
                            aria-expanded={expandedId === record.id}
                            aria-controls={`recruitment-record-${record.id}`}
                            onClick={() =>
                              setExpandedId(expandedId === record.id ? null : record.id)
                            }
                            className="flex w-full items-center gap-4 rounded-md p-4 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground">
                                {record.announcement.split('\n')[0]}
                              </p>
                              <p className="mt-1 text-xs text-ink-3">
                                {record.startsOn.slice(0, 10)} 至 {record.endedOn?.slice(0, 10) || record.endsOn?.slice(0, 10) || '达到人数目标'}
                              </p>
                            </div>
                            <ChevronDown
                              className={`h-4 w-4 shrink-0 text-ink-3 transition-transform ${expandedId === record.id ? 'rotate-180' : ''}`}
                            />
                          </button>
                          <AnimatePresence initial={false}>
                            {expandedId === record.id && (
                              <motion.div
                                id={`recruitment-record-${record.id}`}
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden"
                              >
                                <div className="space-y-5 border-t border-line p-4">
                                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-2">
                                    {record.announcement}
                                  </p>
                                  <p className="text-sm text-ink-3">完成 {record.completedCount} 人 · 参与 {record.participantCount} 人 · 招募目标 {record.targetMembers || '不限'} 人</p>
                                  <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                                    <div>
                                      <dt className="text-xs text-ink-3">投稿语言</dt>
                                      <dd className="mt-1 text-sm text-foreground">
                                        {record.languages.map(langText).join('、')}
                                      </dd>
                                    </div>
                                    {conditionFields.map(({ key, label }) => (
                                      <div key={key}>
                                        <dt className="text-xs text-ink-3">{label}</dt>
                                        <dd className="mt-1 text-sm tabular-nums text-foreground">
                                          {record.conditions[key]}
                                        </dd>
                                      </div>
                                    ))}
                                  </dl>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </motion.section>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>
    </MotionConfig>
  );
}
