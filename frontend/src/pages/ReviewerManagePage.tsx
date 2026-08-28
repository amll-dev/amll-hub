import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Loader2, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { api } from '@/lib/api';
import { ListSkeleton } from '@/components/ui/Skeleton';

/** 审核员管理页 */
export function ReviewerManagePage() {
  const { user, openLogin } = useAuth();
  const [items, setItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  const load = () => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .listReviewers()
      .then((res) => {
        if (!cancelled) setItems(res.items ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  };

  useEffect(() => {
    if (user?.isAdmin) return load();
    setLoading(false);
  }, [user?.isAdmin]);

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

  const doAdd = async () => {
    const name = username.trim();
    if (!name || submitting) return;
    setSubmitting(true);
    setMsg('');
    try {
      await api.addReviewer(name);
      setItems((prev) => (prev.includes(name) ? prev : [...prev, name].sort()));
      setUsername('');
      setMsg(`已添加审核员 ${name}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '添加失败');
    } finally {
      setSubmitting(false);
    }
  };

  const doRemove = async (name: string) => {
    if (removing !== null) return;
    setRemoving(name);
    setMsg('');
    try {
      await api.removeReviewer(name);
      setItems((prev) => prev.filter((n) => n !== name));
      setMsg(`已移除审核员 ${name}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '移除失败');
    } finally {
      setRemoving(null);
    }
  };

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
        ) : error ? (
          <p className="py-6 text-center text-sm text-error">{error}</p>
        ) : items.length === 0 ? (
          <div className="py-8 text-center">
            <UserRound className="mx-auto h-10 w-10 text-ink-3" />
            <p className="mt-3 text-sm text-ink-3">暂无审核员，请在上方添加</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((name) => (
              <motion.li
                key={name}
                variants={fadeUp}
                className="flex items-center justify-between gap-3 rounded-md border border-line bg-background px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate font-medium text-foreground">{name}</span>
                  {name === user.name && (
                    <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2">
                      我
                    </span>
                  )}
                </div>
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
              </motion.li>
            ))}
          </ul>
        )}
      </motion.div>
    </motion.div>
  );
}
