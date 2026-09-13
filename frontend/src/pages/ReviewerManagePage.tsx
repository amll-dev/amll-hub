import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, Loader2, Megaphone, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { fadeUp, staggerContainer } from '@/lib/motion';
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

type ReviewerList = { items: string[]; total: number };

/** 审核员管理页 */
export function ReviewerManagePage() {
  const { user, openLogin } = useAuth();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [msg, setMsg] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  // 公告广播表单
  const [bcTitle, setBcTitle] = useState('');
  const [bcContent, setBcContent] = useState('');
  const [bcPath, setBcPath] = useState('');
  const [bcLabel, setBcLabel] = useState('');
  const [bcMsg, setBcMsg] = useState('');

  const reviewersQuery = useQuery({
    queryKey: queryKeys.reviewers,
    queryFn: () => api.listReviewers(),
    enabled: !!user?.isAdmin,
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
      queryClient.setQueryData<ReviewerList>(queryKeys.reviewers, (prev) =>
        prev
          ? {
              items: prev.items.includes(name) ? prev.items : [...prev.items, name].sort(),
              total: prev.total,
            }
          : prev
      );
      setUsername('');
      setMsg(`已添加审核员 ${name}`);
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : '添加失败'),
  });

  const removeMutation = useMutation({
    mutationFn: (name: string) => api.removeReviewer(name),
    onMutate: (name) => setRemoving(name),
    onSuccess: (_d, name) => {
      queryClient.setQueryData<ReviewerList>(queryKeys.reviewers, (prev) =>
        prev ? { items: prev.items.filter((n) => n !== name), total: prev.total - 1 } : prev
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

  // 系统公告广播（T5）：发全体已知用户，成功后清空表单
  const broadcastMutation = useMutation({
    mutationFn: () =>
      api.broadcastNotification({
        title: bcTitle.trim(),
        content: bcContent.trim(),
        actionPath: bcPath.trim() || undefined,
        actionLabel: bcPath.trim() ? bcLabel.trim() || '查看详情' : undefined,
      }),
    onSuccess: () => {
      setBcTitle('');
      setBcContent('');
      setBcPath('');
      setBcLabel('');
      setBcMsg('公告已发送');
    },
    onError: (e) => setBcMsg(e instanceof Error ? e.message : '发送失败'),
  });

  const doBroadcast = () => {
    if (!bcTitle.trim() || !bcContent.trim() || broadcastMutation.isPending) return;
    setBcMsg('');
    broadcastMutation.mutate();
  };

  const doRemove = (name: string) => {
    if (removing !== null) return;
    removeMutation.mutate(name);
  };

  const loading = !!user?.isAdmin && reviewersQuery.isPending;
  const submitting = addMutation.isPending;

  // 非超管不可见
  if (!user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-ink-3">请先登录</p>
          <button
            type="button"
            onClick={() => openLogin('/admin/reviewers')}
            className="mt-4 rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            登录
          </button>
        </div>
      </div>
    );
  }
  if (!user.isAdmin) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-ink-3" />
          <p className="mt-3 text-sm text-ink-3">需要超级管理员权限</p>
          <Link to="/" className="mt-4 inline-block text-sm text-primary hover:underline">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="mx-auto w-full max-w-3xl space-y-5 px-6 py-10"
    >
      <motion.div variants={fadeUp} className="flex items-center gap-3">
        <Link
          to="/"
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-primary"
          aria-label="返回首页"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">审核员管理</h1>
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500">
          测试版
        </span>
      </motion.div>

      {/* 系统公告广播 */}
      <motion.div variants={fadeUp} className="rounded-lg border border-line bg-card p-5">
        <p className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
          <Megaphone className="h-4 w-4 text-primary" />
          发布系统公告
        </p>
        <p className="mb-3 text-xs text-ink-3">
          向全体已知用户（有投稿记录或审核员身份）发送 system 类型站内消息
        </p>
        <div className="space-y-2">
          <input
            type="text"
            value={bcTitle}
            onChange={(e) => setBcTitle(e.target.value)}
            placeholder="公告标题（必填）"
            className="h-10 w-full rounded-md border border-input bg-surface-2 px-3 text-sm outline-none focus:border-primary"
          />
          <textarea
            value={bcContent}
            onChange={(e) => setBcContent(e.target.value)}
            placeholder="公告内容（必填）"
            rows={3}
            className="w-full resize-none rounded-md border border-input bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={bcPath}
              onChange={(e) => setBcPath(e.target.value)}
              placeholder="跳转路径（可选，如 /ranking）"
              className="h-10 flex-1 rounded-md border border-input bg-surface-2 px-3 text-sm outline-none focus:border-primary"
            />
            <input
              type="text"
              value={bcLabel}
              onChange={(e) => setBcLabel(e.target.value)}
              placeholder="按钮文案（默认：查看详情）"
              className="h-10 w-56 rounded-md border border-input bg-surface-2 px-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-ink-3">{bcMsg}</p>
            <button
              type="button"
              onClick={doBroadcast}
              disabled={broadcastMutation.isPending || !bcTitle.trim() || !bcContent.trim()}
              className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {broadcastMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Megaphone className="h-4 w-4" />
              )}
              发送公告
            </button>
          </div>
        </div>
      </motion.div>

      {/* 添加审核员 */}
      <motion.div variants={fadeUp} className="rounded-lg border border-line bg-card p-5">
        <p className="mb-3 text-sm font-medium text-foreground">添加审核员</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doAdd()}
            placeholder="输入用户名（登录名）"
            className="h-10 flex-1 rounded-md border border-input bg-surface-2 px-3 text-sm outline-none focus:border-primary"
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
      </motion.div>

      {/* 名单列表 */}
      <motion.div variants={fadeUp} className="rounded-lg border border-line bg-card p-5">
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
              {items.map((name) => (
                <TableRow key={name}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2">
                      <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate font-medium text-foreground">{name}</span>
                      {name === user.name && (
                        <Badge variant="secondary" className="shrink-0">
                          我
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <button
                      type="button"
                      onClick={() => doRemove(name)}
                      disabled={removing !== null}
                      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-line px-2.5 text-xs text-ink-2 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                    >
                      {removing === name ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      移除
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </motion.div>
    </motion.div>
  );
}
