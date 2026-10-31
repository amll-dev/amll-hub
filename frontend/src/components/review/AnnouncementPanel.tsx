import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { CheckCircle2, Eye, Info, Loader2, Mail, Megaphone, Send, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ListSkeleton } from '@/components/ui/Skeleton';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Announcement } from '@/lib/types';

const TITLE_MAX = 200;
const CONTENT_MAX = 2000;

marked.setOptions({ breaks: true, gfm: true });

/** Markdown 转换 安全 HTML */
function renderAnnouncementPreview(md: string): string {
  if (!md.trim()) return '';
  try {
    return DOMPurify.sanitize(marked.parse(md) as string, {
      USE_PROFILES: { html: true },
    });
  } catch {
    return '';
  }
}

/** 公告邮件结果 */
function MailResultBadge({ item }: { item: Announcement }) {
  if (!item.mailEnabled) {
    return <span className="text-xs text-ink-3">未发送</span>;
  }
  if (item.mailStatus === 'sending') {
    return (
      <Badge variant="warning" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        发送中
      </Badge>
    );
  }
  if (item.mailFailed > 0) {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        {item.mailSent} 成功 / {item.mailFailed} 失败
      </Badge>
    );
  }
  return (
    <Badge variant="success" className="gap-1">
      <CheckCircle2 className="h-3 w-3" />
      {item.mailSent} 成功
      {item.mailSkipped > 0 && ` / ${item.mailSkipped} 跳过`}
    </Badge>
  );
}

/** 发布公告面板 */
export function AnnouncementPanel() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [actionPath, setActionPath] = useState('');
  const [actionLabel, setActionLabel] = useState('');
  const [sendMail, setSendMail] = useState(false);
  const [msg, setMsg] = useState('');
  // 刚发布的公告 id
  const [activeId, setActiveId] = useState<number | null>(null);

  const audienceQuery = useQuery({
    queryKey: queryKeys.announcementAudience,
    queryFn: () => api.getAnnouncementAudience(),
    staleTime: 60_000,
  });
  const audience = audienceQuery.data;
  const mailAvailable = audience?.mailAvailable ?? false;

  const listQuery = useQuery({
    queryKey: queryKeys.announcements(1),
    queryFn: () => api.listAnnouncements(1, 20),
  });
  const items = listQuery.data?.items ?? [];

  // 发布后轮询单条公告
  const detailQuery = useQuery({
    queryKey: queryKeys.announcement(activeId ?? 0),
    queryFn: () => api.getAnnouncement(activeId as number),
    enabled: !!activeId,
    refetchInterval: (query) => (query.state.data?.mailStatus === 'sending' ? 2000 : false),
  });
  const active = detailQuery.data;

  // 邮件发完后刷新一次历史列表
  useEffect(() => {
    if (active?.mailStatus === 'done') {
      void queryClient.invalidateQueries({ queryKey: ['announcements', 'list'] });
    }
  }, [active?.mailStatus, queryClient]);

  const publishMutation = useMutation({
    mutationFn: () =>
      api.publishAnnouncement({
        title: title.trim(),
        content: content.trim(),
        actionPath: actionPath.trim() || undefined,
        actionLabel: actionPath.trim() ? actionLabel.trim() || undefined : undefined,
        sendMail: sendMail && mailAvailable,
      }),
    onSuccess: (a) => {
      setTitle('');
      setContent('');
      setActionPath('');
      setActionLabel('');
      setSendMail(false);
      setMsg('公告已发布');
      setActiveId(a.id);
      void queryClient.invalidateQueries({ queryKey: ['announcements', 'list'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.announcementAudience });
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : '发布失败'),
  });

  const canSubmit = title.trim().length > 0 && content.trim().length > 0;
  const doPublish = () => {
    if (!canSubmit || publishMutation.isPending) return;
    setMsg('');
    publishMutation.mutate();
  };

  const processed = active ? active.mailSent + active.mailFailed + active.mailSkipped : 0;
  const total = active?.audienceCount ?? 0;
  const percent =
    active?.mailStatus === 'done'
      ? 100
      : total > 0
        ? Math.min(100, Math.round((processed / total) * 100))
        : 0;

  // 邮件正文预览
  const previewHtml = useMemo(() => renderAnnouncementPreview(content), [content]);
  const previewTime = formatDateTime(new Date());

  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
          <Megaphone className="h-5 w-5 text-primary" />
          发布公告
        </h2>
        <p className="mt-1 text-sm text-ink-3">
          向全体已知用户（有投稿记录或审核员身份）发送 system 类型站内消息
          {typeof audience?.count === 'number' && `，当前预计 ${audience.count} 人`}
        </p>
      </div>

      {/* 表单 */}
      <div className="rounded-lg border border-line bg-surface-2 p-4">
        <div className="space-y-2">
          <input
            type="text"
            value={title}
            maxLength={TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="公告标题"
            className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus:border-primary"
          />
          <div>
            <textarea
              value={content}
              maxLength={CONTENT_MAX}
              onChange={(e) => setContent(e.target.value)}
              placeholder="公告内容"
              rows={5}
              className="w-full resize-none rounded-md border border-input bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary"
            />
            <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-ink-3">
              <span>支持 Markdown</span>
              <span className="shrink-0">
                {content.length} / {CONTENT_MAX}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={actionPath}
              onChange={(e) => setActionPath(e.target.value)}
              placeholder="跳转路径"
              className="h-10 flex-1 rounded-md border border-input bg-card px-3 text-sm outline-none focus:border-primary"
            />
            <input
              type="text"
              value={actionLabel}
              onChange={(e) => setActionLabel(e.target.value)}
              disabled={!actionPath.trim()}
              placeholder="按钮文案"
              className="h-10 w-56 rounded-md border border-input bg-card px-3 text-sm outline-none focus:border-primary disabled:opacity-50"
            />
          </div>

          {/* 邮件开关 */}
          <div className="flex items-center justify-between gap-4 rounded-md border border-line bg-card px-3 py-2.5">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm text-foreground">
                <Mail className="h-4 w-4 text-ink-2" />
                同时发送邮件
              </p>
              {!mailAvailable && (
                <p className="mt-0.5 text-xs text-ink-3">
                  服务端未启用邮件（EMAIL_ENABLED 未开启或 SMTP 未配置），当前不可用
                </p>
              )}
            </div>
            <Switch
              checked={sendMail && mailAvailable}
              onCheckedChange={setSendMail}
              disabled={!mailAvailable}
              aria-label="同时发送邮件"
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="min-w-0 truncate text-xs text-ink-3">{msg}</p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  disabled={!canSubmit || publishMutation.isPending}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
                >
                  {publishMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  发布公告
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认发布这条公告？</AlertDialogTitle>
                  <AlertDialogDescription>
                    将立即向 {audience?.count ?? 0} 位已知用户发送站内消息
                    {sendMail && mailAvailable ? '，并同时发送邮件' : ''}。发布后无法撤回。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={doPublish}>确认发布</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      {/* 邮件预览 */}
      {sendMail && mailAvailable && (
        <div className="rounded-lg border border-line bg-surface-2 p-4">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-ink-2">
            <Eye className="h-3.5 w-3.5" />
            邮件预览
          </p>
          {/* 固定浅色：模拟真实邮件本体，与后端 announcement.html 视觉一致 */}
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <div className="p-5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <img
                    src="/logo.png"
                    alt="AMLL Hub"
                    className="h-6 w-6 rounded-md object-contain"
                  />
                  <span className="text-sm font-bold text-neutral-900">AMLL Hub</span>
                </span>
                <span className="text-[10px] tracking-[1px] text-neutral-400">系统公告</span>
              </div>
              <div className="mt-4">
                <span className="inline-block rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-600">
                  系统公告
                </span>
                <h3 className="mt-3 text-lg font-semibold text-neutral-900">
                  {title.trim() || '公告标题'}
                </h3>
                <p className="mt-1 text-[11px] text-neutral-400">
                  {user?.displayName || user?.name || '管理员'} · {previewTime}
                </p>
              </div>
              {previewHtml ? (
                <div
                  className="prose prose-sm mt-4 max-w-none text-neutral-600 prose-headings:text-neutral-900 prose-strong:text-neutral-900 prose-a:text-primary"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              ) : (
                <p className="mt-4 text-sm text-neutral-400">当前正文为空</p>
              )}
              {actionPath.trim() && (
                <span className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white">
                  {actionLabel.trim() || '查看详情'}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 最近一次发布的结果 */}
      {active && (
        <div className="rounded-lg border border-line bg-surface-2 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
              <Info className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">《{active.title}》发送结果</span>
            </p>
            <div className="shrink-0">
              <MailResultBadge item={active} />
            </div>
          </div>

          <div className="mt-3 space-y-2 text-xs text-ink-2">
            <p>
              站内信：已发送给 {active.audienceCount} 人{active.mailEnabled && '　·　邮件：'}
              {active.mailEnabled && (
                <span>
                  成功 {active.mailSent} / 失败 {active.mailFailed} / 跳过 {active.mailSkipped}
                </span>
              )}
            </p>
            {active.mailEnabled && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-card">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>
            )}
            {active.mailEnabled && active.mailStatus === 'sending' && (
              <p className="text-ink-3">邮件发送中，进度每 2 秒刷新一次，可切换到其他页签</p>
            )}
          </div>
        </div>
      )}

      {/* 公告历史 */}
      <div>
        <p className="mb-2 text-sm font-medium text-foreground">
          公告历史
          {!listQuery.isPending && items.length > 0 && `（最近 ${items.length} 条）`}
        </p>
        {listQuery.isPending ? (
          <ListSkeleton rows={4} />
        ) : listQuery.error ? (
          <p className="py-6 text-center text-sm text-error">
            {listQuery.error instanceof Error ? listQuery.error.message : '加载失败'}
          </p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="还没有发布过公告"
            description="在上方填写内容后发布"
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>标题</TableHead>
                  <TableHead className="w-36">发布时间</TableHead>
                  <TableHead className="w-24">发布人</TableHead>
                  <TableHead className="w-20 text-right">收件人</TableHead>
                  <TableHead className="w-44 text-right">邮件</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-0">
                      <span className="block truncate font-medium text-foreground">
                        {item.title}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-ink-3">
                      {formatDateTime(item.createdAt)}
                    </TableCell>
                    <TableCell className="truncate text-xs text-ink-2">{item.sender}</TableCell>
                    <TableCell className="text-right text-xs text-ink-2">
                      {item.audienceCount}
                    </TableCell>
                    <TableCell className="text-right">
                      <MailResultBadge item={item} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
