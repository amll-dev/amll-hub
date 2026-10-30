import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { UserAvatar } from '@/components/submission/UserAvatar';
import type { ReviewerListResult } from '@/lib/types';

/** 审核员管理面板 */
export function ReviewerManagePanel() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [msg, setMsg] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  const isAdmin = !!user?.isAdmin;

  const reviewersQuery = useQuery({
    queryKey: queryKeys.reviewers,
    queryFn: () => api.listReviewers(),
    enabled: isAdmin,
    staleTime: 30_000,
  });
  const items = reviewersQuery.data?.items ?? [];
  const errorMsg =
    reviewersQuery.error instanceof Error
      ? reviewersQuery.error.message
      : reviewersQuery.error
        ? '加载失败'
        : '';

  const addMutation = useMutation({
    mutationFn: (name: string) => api.addReviewer(name),
    onSuccess: (_d, name) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reviewers });
      setUsername('');
      setMsg(`已添加审核员 ${name}`);
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : '添加失败'),
  });

  const removeMutation = useMutation({
    mutationFn: (name: string) => api.removeReviewer(name),
    onMutate: (name) => setRemoving(name),
    onSuccess: (_d, name) => {
      queryClient.setQueryData<ReviewerListResult>(queryKeys.reviewers, (prev) =>
        prev ? { items: prev.items.filter((n) => n.name !== name), total: prev.total - 1 } : prev
      );
      setMsg(`已移除审核员 ${name}`);
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : '移除失败'),
    onSettled: () => setRemoving(null),
  });

  const doAdd = () => {
    const name = username.trim();
    if (!name || addMutation.isPending) return;
    addMutation.mutate(name);
  };

  const doRemove = (name: string) => {
    if (removing !== null) return;
    removeMutation.mutate(name);
  };

  // 名单接口本身是 RequireAdmin，这里只做界面兜底
  if (!isAdmin || !user) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
        <ShieldCheck className="h-10 w-10 text-ink-3" />
        <p className="mt-3 text-sm text-ink-3">需要超级管理员权限</p>
        <Link to="/" className="mt-4 text-sm text-primary hover:underline">
          返回首页
        </Link>
      </div>
    );
  }

  const loading = reviewersQuery.isPending;
  const submitting = addMutation.isPending;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
          <ShieldCheck className="h-5 w-5 text-primary" />
          审核员管理
        </h2>
      </div>

      {/* 添加审核员 */}
      <div className="rounded-lg border border-line bg-surface-2 p-4">
        <p className="mb-3 text-sm font-medium text-foreground">添加审核员</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doAdd()}
            placeholder="输入用户名"
            className="h-10 flex-1 rounded-md border border-input bg-card px-3 text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={doAdd}
            disabled={submitting || !username.trim()}
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            添加
          </button>
        </div>
        {msg && <p className="mt-2 text-xs text-ink-3">{msg}</p>}
      </div>

      {/* 名单列表 */}
      <div className="rounded-lg border border-line bg-surface-2 p-4">
        <p className="mb-3 text-sm font-medium text-foreground">
          审核员名单{!loading && items.length > 0 && `（${items.length} 人）`}
        </p>
        {loading ? (
          <ListSkeleton rows={4} />
        ) : errorMsg ? (
          <p className="py-6 text-center text-sm text-error">{errorMsg}</p>
        ) : items.length === 0 ? (
          <EmptyState icon={UserRound} title="暂无审核员" description="请在上方添加" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>审核员</TableHead>
                <TableHead className="w-24 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.name}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <UserAvatar
                        avatar={item.avatar}
                        name={item.displayName || item.name}
                        size={32}
                      />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">
                          {item.displayName || item.name}
                        </p>
                        {item.displayName && (
                          <p className="truncate text-xs text-ink-3">@{item.name}</p>
                        )}
                      </div>
                      {item.name === user.name && (
                        <Badge variant="secondary" className="shrink-0">
                          我
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          type="button"
                          disabled={removing !== null}
                          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-line px-2.5 text-xs text-ink-2 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                        >
                          {removing === item.name ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          移除
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>确认移除该审核员？</AlertDialogTitle>
                          <AlertDialogDescription>
                            移除后 {item.displayName || item.name} 将失去审核与发布公告权限，
                            需要时可以重新添加。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction onClick={() => doRemove(item.name)}>
                            确认移除
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
