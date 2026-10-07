import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, Github, Loader2, RefreshCw, Unlink, Upload } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { buttonTap } from '@/lib/motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/profile/SectionCard';
import type { GithubMigrationStatus, GithubMigrationTask } from '@/lib/types';

/** 任务状态 → 中文标签 */
const STATUS_LABEL: Record<GithubMigrationTask['status'], string> = {
  pending: '排队中',
  running: '迁移中',
  completed: '已完成',
  failed: '失败',
};

function formatTime(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('zh-CN', { hour12: false });
}

/** 迁移进度明细 */
function TaskProgress({
  task,
  startPrNumber,
}: {
  task: GithubMigrationTask;
  startPrNumber: number;
}) {
  const percent =
    task.totalPrs > 0 ? Math.min(100, Math.round((task.processedPrs / task.totalPrs) * 100)) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Badge variant={task.status === 'failed' ? 'destructive' : 'secondary'}>
            {STATUS_LABEL[task.status]}
          </Badge>
          <span className="text-xs text-ink-3">
            #{startPrNumber} 之后的投稿 · 任务 ID {task.id}
          </span>
        </div>
        <span className="text-sm tabular-nums text-ink-2">
          {task.processedPrs} / {task.totalPrs}
        </span>
      </div>

      {/* 进度条 */}
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      <dl className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-surface-2 py-3">
          <dt className="text-xs text-ink-3">迁移的投稿数</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {task.createdCount}
          </dd>
        </div>
        <div className="rounded-lg bg-surface-2 py-3">
          <dt className="text-xs text-ink-3">跳过（已迁移）</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {task.skippedCount}
          </dd>
        </div>
        <div className="rounded-lg bg-surface-2 py-3">
          <dt className="text-xs text-ink-3">失败</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {task.failedCount}
          </dd>
        </div>
      </dl>

      {task.completedAt && (
        <p className="text-xs text-ink-3">完成于 {formatTime(task.completedAt)}</p>
      )}

      {task.error && <p className="text-xs text-error">错误：{task.error}</p>}
    </div>
  );
}

/** 个人中心 → 数据迁移 */
export function ProfileMigration() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const justBound = params.get('githubBound') === '1';

  const statusQuery = useQuery({
    queryKey: queryKeys.githubMigration,
    queryFn: () => api.getMigrationStatus(),
    enabled: !!user,
    // 有进行中任务时轮询进度
    refetchInterval: (query) => (query.state.data?.hasActive ? 2000 : false),
    retry: false,
  });

  const status: GithubMigrationStatus | undefined = statusQuery.data;

  // 已迁移投稿列表（含 PR 标题）；迁移进行中时同步轮询
  const migratedQuery = useQuery({
    queryKey: queryKeys.githubMigrated,
    queryFn: () => api.getMigratedPrs(100),
    enabled: !!user && !!status?.bound,
    refetchInterval: status?.hasActive ? 5000 : false,
    retry: false,
  });
  const migratedList = migratedQuery.data;

  // 绑定回跳提示：显示一次后清掉 query 参数
  useEffect(() => {
    if (!justBound) return;
    toast.success('GitHub 绑定成功');
    navigate('/profile/migration', { replace: true });
  }, [justBound, navigate]);

  const startMutation = useMutation({
    mutationFn: () => api.startMigration(),
    onSuccess: () => {
      toast.success('迁移任务已创建');
      void statusQuery.refetch();
      void migratedQuery.refetch();
    },
    onError: (e: Error) => toast.error(e.message || '创建迁移任务失败'),
  });

  const retryMutation = useMutation({
    mutationFn: (id: number) => api.retryMigration(id),
    onSuccess: () => {
      toast.success('已重新开始迁移');
      void statusQuery.refetch();
      void migratedQuery.refetch();
    },
    onError: (e: Error) => toast.error(e.message || '重试失败'),
  });

  const unbindMutation = useMutation({
    mutationFn: () => api.unbindGithub(),
    onSuccess: () => {
      toast.success('已解绑 GitHub');
      void statusQuery.refetch();
    },
    onError: (e: Error) => toast.error(e.message || '解绑失败'),
  });

  const currentTask: GithubMigrationTask | undefined = useMemo(
    () => status?.activeTask ?? status?.latestTask,
    [status]
  );

  if (!user) return null;

  if (statusQuery.isPending) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-line bg-card py-16 text-sm text-ink-3">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载中…
      </div>
    );
  }

  if (statusQuery.isError && !status) {
    return (
      <SectionCard icon={<Github />} title="数据迁移">
        <p className="text-sm text-error">
          {statusQuery.error instanceof Error ? statusQuery.error.message : '加载失败'}
        </p>
        <Button variant="outline" className="mt-4" onClick={() => void statusQuery.refetch()}>
          重试
        </Button>
      </SectionCard>
    );
  }

  if (!status) return null;

  const busy = startMutation.isPending || retryMutation.isPending;
  const canStart = status.bound && !status.hasActive && !busy;
  const canRetry = status.bound && !status.hasActive && currentTask?.status === 'failed';

  return (
    <div className="space-y-6">
      {/* 绑定状态 */}
      <SectionCard
        icon={<Github />}
        title="GitHub 账号"
        description="迁移前需先绑定你在 amll-ttml-db 提交歌词所用的 GitHub 账号"
      >
        {status.bound ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              {status.githubAvatar ? (
                <img
                  src={status.githubAvatar}
                  alt={status.githubLogin}
                  className="h-10 w-10 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2">
                  <Github className="h-5 w-5 text-ink-2" />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{status.githubLogin}</p>
                <p className="truncate text-xs text-ink-3">
                  {status.githubEmail || '未公开邮箱'} · 绑定于 {formatTime(status.boundAt)}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={unbindMutation.isPending}
              onClick={() => unbindMutation.mutate()}
            >
              {unbindMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Unlink className="h-4 w-4" />
              )}
              解绑
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-ink-2">尚未绑定 GitHub 账号，绑定后才能开始迁移</p>
            <Button
              {...buttonTap}
              onClick={() => {
                void api
                  .githubBindStart()
                  .then((url) => {
                    window.location.href = url;
                  })
                  .catch((e: Error) => toast.error(e.message || '发起绑定失败'));
              }}
            >
              <Github className="h-4 w-4" />
              绑定 GitHub
            </Button>
          </div>
        )}
      </SectionCard>

      {/* 迁移任务 */}
      <SectionCard
        icon={<Upload />}
        title="投稿数据迁移"
        description={`将 GitHub 上 #${status.startPrNumber} 之后的投稿迁移为站点原生投稿，已迁移的会自动跳过`}
      >
        {currentTask ? (
          <div className="space-y-5">
            <TaskProgress task={currentTask} startPrNumber={status.startPrNumber} />

            <div className="flex flex-wrap gap-3">
              <Button disabled={!canStart} {...buttonTap} onClick={() => startMutation.mutate()}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {currentTask.status === 'completed' ? '重新迁移' : '开始迁移'}
              </Button>
              {canRetry && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => retryMutation.mutate(currentTask.id)}
                >
                  <RefreshCw className="h-4 w-4" />
                  重试失败任务
                </Button>
              )}
            </div>

            {status.hasActive && (
              <p className="text-xs text-ink-3">
                迁移进行中，数据量较大时请保持页面打开或稍后回来查看。
              </p>
            )}
            {currentTask.status === 'completed' && (
              <p className="text-xs text-ink-3">
                数据截止到 {formatTime(currentTask.completedAt ?? currentTask.updatedAt)}。
                如需同步此后更新的投稿，请点击「重新迁移」。
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-4">
            <p className="text-sm text-ink-2">
              {status.bound
                ? '尚未执行过迁移，点击下方按钮开始。'
                : '请先绑定 GitHub 账号后再开始迁移。'}
            </p>
            <Button disabled={!canStart} {...buttonTap} onClick={() => startMutation.mutate()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              开始迁移
            </Button>
          </div>
        )}
      </SectionCard>

      {/* 已迁移投稿（含原始 PR 标题） */}
      {status.bound && (
        <SectionCard
          icon={<FileText />}
          title="已迁移投稿"
          description="已从 GitHub 迁移到站点的投稿列表，标题为该投稿对应的 PR 标题"
        >
          {migratedQuery.isPending ? (
            <div className="flex items-center py-6 text-sm text-ink-3">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中…
            </div>
          ) : migratedList && migratedList.total > 0 ? (
            <>
              <p className="mb-3 text-sm text-ink-2">
                共{' '}
                <span className="font-semibold tabular-nums text-foreground">
                  {migratedList.total}
                </span>{' '}
                个
                {migratedList.total > migratedList.items.length && (
                  <span className="text-ink-3">（仅展示最近 {migratedList.items.length} 条）</span>
                )}
              </p>
              <ul className="divide-y divide-line">
                {migratedList.items.map((item) => (
                  <li
                    key={item.prNumber}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">
                        {item.prTitle || item.submissionTitle || `PR #${item.prNumber}`}
                      </p>
                      <p className="truncate text-xs text-ink-3">
                        PR #{item.prNumber}
                        {item.submissionTitle && item.prTitle ? ` · ${item.submissionTitle}` : ''}
                      </p>
                    </div>
                    {(item.submissionId || item.fileName) && (
                      <Link
                        to={
                          item.submissionId
                            ? `/creator/lyrics/detail?id=${item.submissionId}`
                            : `/lyric/${encodeURIComponent(item.fileName)}`
                        }
                        className="shrink-0 text-xs text-primary hover:underline"
                      >
                        查看
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-ink-3">暂无已迁移的投稿</p>
          )}
        </SectionCard>
      )}
    </div>
  );
}
