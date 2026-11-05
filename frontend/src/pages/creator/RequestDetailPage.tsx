import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Heart,
  Loader2,
  MessageSquare,
  PencilLine,
  ScrollText,
  Send,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { useAuth } from '@/hooks/useAuth';
import { buttonTap, fadeUp, staggerContainer } from '@/lib/motion';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { EmptyState } from '@/components/ui/EmptyState';
import { LyricDetailSkeleton } from '@/components/ui/Skeleton';
import { PageContainer } from '@/components/PageContainer';
import { UserAvatar } from '@/components/submission/UserAvatar';
import { DetailTopBar } from '@/components/detail/DetailTopBar';
import { useViewers } from '@/hooks/useViewers';
import {
  isRequestOwner,
  platforms,
  providedPlatforms,
  requestDisplayStatus,
  requesterIdentity,
} from '@/components/petition/shared';
import { SupporterAvatars } from '@/components/petition/SupporterAvatars';
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
import type { LyricRequestComment } from '@/lib/types';

/** 歌词请愿详情页 */
export function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const requestId = Number(id);
  const navigate = useNavigate();
  const { user, openLogin } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  // 在线观看者
  const { count: viewerCount, viewers, showModal, setShowModal } = useViewers(requestId, 'request');

  const detailQuery = useQuery({
    queryKey: queryKeys.lyricRequest(requestId),
    queryFn: () => api.getLyricRequest(requestId),
    enabled: Number.isFinite(requestId) && requestId > 0,
  });

  const commentsQuery = useQuery({
    queryKey: queryKeys.lyricRequestComments(requestId),
    queryFn: () => api.listLyricRequestComments(requestId),
    enabled: Number.isFinite(requestId) && requestId > 0,
  });

  const supportMutation = useMutation({
    mutationFn: () => api.toggleLyricRequestSupport(requestId),
    onSuccess: (res) => {
      qc.setQueryData(queryKeys.lyricRequest(requestId), (old) =>
        old ? { ...old, supported: res.supported, supportCount: res.supportCount } : old
      );
      qc.invalidateQueries({ queryKey: ['lyric-requests'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '操作失败'),
  });

  const commentMutation = useMutation({
    mutationFn: (content: string) => api.createLyricRequestComment(requestId, content),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: queryKeys.lyricRequestComments(requestId) });
      qc.invalidateQueries({ queryKey: queryKeys.lyricRequest(requestId) });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '评论失败'),
  });

  const withdrawMutation = useMutation({
    mutationFn: () => api.withdrawLyricRequest(requestId),
    onSuccess: () => {
      toast.success('请愿已撤回');
      qc.invalidateQueries({ queryKey: ['lyric-requests'] });
      navigate('/creator/requests');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '撤回失败'),
  });

  const statusMutation = useMutation({
    mutationFn: (status: 'pending' | 'completed') => api.setLyricRequestStatus(requestId, status),
    onSuccess: () => {
      toast.success('状态已更新');
      qc.invalidateQueries({ queryKey: queryKeys.lyricRequest(requestId) });
      qc.invalidateQueries({ queryKey: ['lyric-requests'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '操作失败'),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <DetailTopBar
          pageTitle="创作中心"
          backPath="/creator/requests"
          backLabel="返回请愿"
          count={viewerCount}
          viewers={viewers}
          showModal={showModal}
          setShowModal={setShowModal}
        />
        <PageContainer width="lg" className="py-6">
          <LyricDetailSkeleton />
        </PageContainer>
      </div>
    );
  }

  const req = detailQuery.data;
  if (detailQuery.isError || !req) {
    return (
      <div className="min-h-screen bg-background">
        <DetailTopBar
          pageTitle="创作中心"
          backPath="/creator/requests"
          backLabel="返回请愿"
          count={viewerCount}
          viewers={viewers}
          showModal={showModal}
          setShowModal={setShowModal}
        />
        <PageContainer width="lg" className="py-20 text-center">
          <EmptyState
            icon={ScrollText}
            title="请愿不存在或已被撤回"
            description={detailQuery.error instanceof Error ? detailQuery.error.message : undefined}
            action={
              <Link to="/creator/requests" className={buttonVariants({ size: 'sm' })}>
                返回请愿列表
              </Link>
            }
          />
        </PageContainer>
      </div>
    );
  }

  const meta = requestDisplayStatus(req);
  const isOwner = isRequestOwner(req, user?.name);
  const { name: requesterName, avatar: requesterAvatar } = requesterIdentity(req);
  const providedKeys = new Set(providedPlatforms(req).map((p) => p.key));
  const comments = commentsQuery.data ?? [];

  const handleSupport = () => {
    if (!user) {
      openLogin(`/creator/requests/${requestId}`);
      return;
    }
    supportMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-background">
      <DetailTopBar
        pageTitle="创作中心"
        backPath="/creator/requests"
        backLabel="返回请愿"
        count={viewerCount}
        viewers={viewers}
        showModal={showModal}
        setShowModal={setShowModal}
      />

      <PageContainer width="lg" className="py-6">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="space-y-4 pb-24"
        >
          {/* 标题区卡片 */}
          <motion.div variants={fadeUp} className="rounded-lg border border-line bg-card p-4">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold text-foreground">
              <span className="min-w-0">{req.songName}</span>
              <Badge
                variant={meta.variant}
                className="rounded-full border-transparent px-3 py-1 text-xs font-medium"
              >
                {meta.label}
              </Badge>
              <span className="text-base font-normal text-ink-3">#{req.id}</span>
            </h1>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-3">
              <UserAvatar avatar={requesterAvatar} name={requesterName} size={20} />
              <strong className="text-ink-2">{requesterName}</strong>
              <span>于 {formatDateTime(req.createdAt)} 发起</span>
              {req.requestCount > 1 && <span>· 被请愿 {req.requestCount} 次</span>}
            </div>
          </motion.div>

          {/* 操作条 */}
          <motion.div
            variants={fadeUp}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <motion.button
              type="button"
              onClick={handleSupport}
              disabled={supportMutation.isPending}
              {...buttonTap}
              className={
                req.supported
                  ? 'inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10'
                  : 'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover'
              }
            >
              {supportMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Heart className={`h-3.5 w-3.5 ${req.supported ? 'fill-primary' : ''}`} />
              )}
              {req.supported ? '已支持' : '支持请愿'}
              <span className="opacity-80">{req.supportCount}</span>
            </motion.button>

            <div className="flex flex-wrap gap-2">
              {isOwner && req.status === 'pending' && (
                <>
                  <Link
                    to={`/creator/requests/${req.id}/edit`}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary-hover"
                  >
                    <PencilLine className="h-3.5 w-3.5" />
                    编辑
                  </Link>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md border border-error/40 px-3 py-1.5 text-xs text-error hover:bg-error/5"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        撤回
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>撤回这条请愿？</AlertDialogTitle>
                        <AlertDialogDescription>
                          撤回后请愿记录、支持与评论都会被删除，且无法恢复。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => withdrawMutation.mutate()}
                          className="bg-error text-white hover:bg-error/90"
                        >
                          确认撤回
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}

              {user?.isAdmin && (
                <button
                  type="button"
                  disabled={statusMutation.isPending}
                  onClick={() =>
                    statusMutation.mutate(req.status === 'pending' ? 'completed' : 'pending')
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-line bg-card px-3 py-1.5 text-xs text-ink-2 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {statusMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  {req.status === 'pending' ? '标记为已完成' : '恢复为待处理'}
                </button>
              )}
            </div>
          </motion.div>

          {/* 歌曲信息 */}
          <motion.div variants={fadeUp} className="rounded-lg border border-line bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">歌曲信息</h2>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
                <span className="shrink-0 text-sm text-ink-2">歌曲名称</span>
                <span className="truncate text-sm text-foreground" title={req.songName}>
                  {req.songName}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
                <span className="shrink-0 text-sm text-ink-2">歌手</span>
                <span className="truncate text-sm text-foreground" title={req.artist}>
                  {req.artist}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
                <span className="shrink-0 text-sm text-ink-2">专辑</span>
                <span className="truncate text-sm text-foreground" title={req.album}>
                  {req.album || '—'}
                </span>
              </div>
              {platforms.map((p) => {
                const value = req[p.key];
                const provided = providedKeys.has(p.key);
                return (
                  <div
                    key={p.key}
                    className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
                  >
                    <span className="text-sm text-ink-2">{p.label}</span>
                    {provided ? (
                      <a
                        href={p.url(value)}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate font-mono text-xs text-primary hover:underline"
                        title={value}
                      >
                        {value}
                      </a>
                    ) : (
                      <span className="text-xs text-ink-3">未提供</span>
                    )}
                  </div>
                );
              })}
              <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
                <span className="text-sm text-ink-2">Apple Music 逐词歌词</span>
                <span className={`text-xs ${req.hasAppleTtml ? 'text-green-600' : 'text-ink-3'}`}>
                  {req.hasAppleTtml ? '有' : '无'}
                </span>
              </div>
            </div>

            {req.note && (
              <>
                <Separator className="my-4" />
                <h2 className="text-sm font-semibold text-foreground">其他备注</h2>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-ink-2">
                  {req.note}
                </p>
              </>
            )}

            {req.status === 'completed' && req.completedAt && (
              <>
                <Separator className="my-4" />
                <p className="flex items-center gap-1.5 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  这首歌的歌词已于 {formatDateTime(req.completedAt)} 完成
                </p>
              </>
            )}
          </motion.div>

          {/* 支持者 */}
          {req.supporters.length > 0 && (
            <motion.div variants={fadeUp} className="rounded-lg border border-line bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">
                支持者 <span className="font-normal text-ink-3">({req.supportCount})</span>
              </h2>
              <SupporterAvatars
                supporters={req.supporters}
                supportCount={req.supportCount}
                size={26}
                className="mt-3 flex flex-wrap items-center gap-2"
              />
            </motion.div>
          )}

          {/* 评论 */}
          <motion.div variants={fadeUp} className="rounded-lg border border-line bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <MessageSquare className="h-4 w-4" />
              评论 {req.commentCount > 0 ? `(${req.commentCount})` : ''}
            </h2>

            <div className="mt-4 space-y-4">
              {commentsQuery.isLoading ? (
                <p className="text-sm text-ink-3">加载评论中…</p>
              ) : comments.length === 0 ? (
                <p className="text-sm text-ink-3">还没有评论，来说点什么吧</p>
              ) : (
                comments.map((c) => <CommentItem key={c.id} comment={c} />)
              )}
            </div>

            <Separator className="my-4" />

            {user ? (
              <div className="space-y-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="来说点什么把"
                  rows={3}
                  maxLength={500}
                  className="bg-background px-4 py-3"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-3">{draft.length} / 500</span>
                  <button
                    type="button"
                    disabled={commentMutation.isPending || !draft.trim()}
                    onClick={() => commentMutation.mutate(draft)}
                    className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {commentMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    发表评论
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => openLogin(`/creator/requests/${requestId}`)}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                登录后参与评论
              </button>
            )}
          </motion.div>
        </motion.div>
      </PageContainer>
    </div>
  );
}

function CommentItem({ comment }: { comment: LyricRequestComment }) {
  return (
    <div className="flex gap-2.5">
      <UserAvatar
        avatar={comment.avatar}
        name={comment.displayName || comment.userName}
        size={28}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
          <span className="font-medium text-foreground">
            {comment.displayName || comment.userName}
          </span>
          <span>{formatRelativeTime(comment.createdAt)}</span>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-2">{comment.content}</p>
      </div>
    </div>
  );
}
