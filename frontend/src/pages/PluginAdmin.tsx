import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  Eye,
  EyeOff,
  History,
  Package,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  Download,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { formatBytes, formatCount, formatDateTime } from '@/lib/format';
import { useAuth } from '@/hooks/useAuth';
import { PageContainer } from '@/components/PageContainer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  PluginChannelBadge,
  PluginListingBadge,
  PluginReviewBadge,
  PluginStatusBadge,
} from '@/components/plugin/shared';
import type { PluginStatus } from '@/lib/types';

const PAGE_SIZE = 20;

function askReason(action: string): string | null {
  const reason = window.prompt(`请输入${action}原因（可留空）`);
  return reason === null ? null : reason;
}

export function PluginAdmin() {
  const { user, openLogin } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'plugins' | 'audit'>('plugins');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selectedID, setSelectedID] = useState<number | null>(null);

  const listQuery = useQuery({
    queryKey: queryKeys.adminPlugins({ page, pageSize: PAGE_SIZE, q }),
    queryFn: () => api.pluginStore.adminList({ page, pageSize: PAGE_SIZE, q }),
    enabled: Boolean(user?.isAdmin) && tab === 'plugins',
    staleTime: 15_000,
  });
  const detailQuery = useQuery({
    queryKey: queryKeys.adminPluginDetail(selectedID ?? 0),
    queryFn: () => api.pluginStore.adminDetail(selectedID as number),
    enabled: Boolean(user?.isAdmin) && selectedID !== null,
    staleTime: 15_000,
  });
  const auditQuery = useQuery({
    queryKey: queryKeys.adminPluginAudit({ page, pageSize: PAGE_SIZE }),
    queryFn: () => api.pluginStore.adminAudit({ page, pageSize: PAGE_SIZE }),
    enabled: Boolean(user?.isAdmin) && tab === 'audit',
    staleTime: 15_000,
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['plugins', 'admin'] });
    void queryClient.invalidateQueries({ queryKey: ['plugin', 'admin'] });
    void queryClient.invalidateQueries({ queryKey: ['plugins', 'audit'] });
    void queryClient.invalidateQueries({ queryKey: ['plugins', 'list'] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, status, reason }: { id: number; status: PluginStatus; reason: string }) =>
      api.pluginStore.adminStatus(id, status, reason),
    onSuccess: () => {
      toast.success('插件状态已更新');
      refreshAll();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '操作失败'),
  });

  const listingMutation = useMutation({
    mutationFn: ({
      id,
      action,
      reason,
    }: {
      id: number;
      action: 'list' | 'unlist' | 'yank';
      reason: string;
    }) => api.pluginStore.adminListing(id, action, reason),
    onSuccess: () => {
      toast.success('版本状态已更新');
      refreshAll();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '操作失败'),
  });

  const deleteVersionMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      api.pluginStore.adminDeleteVersion(id, reason),
    onSuccess: () => {
      toast.success('版本已删除');
      refreshAll();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '删除失败'),
  });

  const deletePluginMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      api.pluginStore.adminDeletePlugin(id, reason),
    onSuccess: () => {
      toast.success('插件已删除');
      setSelectedID(null);
      refreshAll();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '删除失败'),
  });

  if (!user) {
    return (
      <PageContainer>
        <div className="rounded-lg border border-line bg-card p-10 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-ink-3" />
          <p className="mt-3 text-sm text-ink-2">请先登录</p>
          <Button className="mt-4" onClick={() => openLogin('/plugins/admin')}>
            登录
          </Button>
        </div>
      </PageContainer>
    );
  }

  if (!user.isAdmin) {
    return (
      <PageContainer>
        <EmptyState
          icon={ShieldCheck}
          title="需要超级管理员权限"
          action={
            <Button asChild variant="outline">
              <Link to="/plugins">
                <ArrowLeft className="h-4 w-4" />
                返回插件广场
              </Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const plugins = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const auditTotal = auditQuery.data?.total ?? 0;
  const auditTotalPages = Math.max(1, Math.ceil(auditTotal / PAGE_SIZE));
  const detail = detailQuery.data;

  return (
    <PageContainer>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/plugins">
              <ArrowLeft className="h-4 w-4" />
              返回插件广场
            </Link>
          </Button>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ShieldCheck className="h-6 w-6 text-primary" />
            插件管理
          </h1>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="plugins">
            <Package className="h-4 w-4" />
            插件与版本
          </TabsTrigger>
          <TabsTrigger value="audit">
            <History className="h-4 w-4" />
            操作审计
          </TabsTrigger>
        </TabsList>

        <TabsContent value="plugins" className="mt-5">
          <div className="mb-4 flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-3" />
              <Input
                className="pl-9"
                value={qInput}
                placeholder="搜索 plugin_key / 名称 / 作者"
                onChange={(e) => setQInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setQ(qInput.trim());
                    setPage(1);
                  }
                }}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setQ(qInput.trim());
                setPage(1);
              }}
            >
              搜索
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="space-y-2">
              {plugins.length === 0 ? (
                <EmptyState icon={Package} title="没有插件" />
              ) : (
                plugins.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedID(p.id)}
                    className={`w-full rounded-lg border p-4 text-left transition-colors ${
                      selectedID === p.id
                        ? 'border-primary bg-primary-soft/40'
                        : 'border-line bg-card hover:border-primary/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold">{p.name}</span>
                      <PluginStatusBadge status={p.status} />
                    </div>
                    <p className="mt-1 truncate text-xs text-ink-3">{p.pluginKey}</p>
                    <p className="mt-1 text-xs text-ink-3">
                      {p.ownerUsername} · {formatDateTime(p.updatedAt)}
                    </p>
                  </button>
                ))
              )}
              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-ink-3">
                  共 {total} 个 · 第 {page}/{totalPages} 页
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1 || listQuery.isFetching}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages || listQuery.isFetching}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </div>

            <div>
              {!detail ? (
                <EmptyState icon={Package} title="选择一个插件查看版本" />
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg border border-line bg-card p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">{detail.plugin.name}</h2>
                      <PluginStatusBadge status={detail.plugin.status} />
                      <span className="text-xs text-ink-3">{detail.plugin.pluginKey}</span>
                    </div>
                    <p className="mt-1 text-sm text-ink-2">{detail.plugin.summary || '暂无简介'}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(['active', 'hidden', 'blocked'] as const).map((status) => (
                        <Button
                          key={status}
                          variant={detail.plugin.status === status ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => {
                            const reason = askReason(`切换为 ${status}`);
                            if (reason === null) return;
                            statusMutation.mutate({ id: detail.plugin.id, status, reason });
                          }}
                        >
                          {status === 'active' ? (
                            <Eye className="h-4 w-4" />
                          ) : status === 'hidden' ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Ban className="h-4 w-4" />
                          )}
                          {status === 'active' ? '正常' : status === 'hidden' ? '隐藏' : '封禁'}
                        </Button>
                      ))}
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          if (
                            !window.confirm(`确定硬删除插件「${detail.plugin.name}」及全部版本？`)
                          )
                            return;
                          const reason = askReason('删除');
                          if (reason === null) return;
                          deletePluginMutation.mutate({ id: detail.plugin.id, reason });
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        删除插件
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {detail.versions.map((v) => (
                      <div key={v.id} className="rounded-lg border border-line bg-card p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm">v{v.version}</span>
                            <PluginChannelBadge channel={v.channel} />
                            <PluginReviewBadge status={v.reviewStatus} />
                            <PluginListingBadge status={v.listingStatus} />
                            <span className="text-xs text-ink-3">
                              {formatBytes(v.sizeBytes)} · {formatCount(v.downloadCount)} 次下载
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button asChild variant="outline" size="sm">
                              <a href={`/api/v1/store/submissions/${v.id}/artifact`}>
                                <Download className="h-4 w-4" />
                                原包
                              </a>
                            </Button>
                            {v.reviewStatus === 'approved' && v.listingStatus !== 'listed' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const reason = askReason('上架');
                                  if (reason === null) return;
                                  listingMutation.mutate({ id: v.id, action: 'list', reason });
                                }}
                              >
                                <Upload className="h-4 w-4" />
                                上架
                              </Button>
                            )}
                            {v.listingStatus === 'listed' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const reason = askReason('下架');
                                  if (reason === null) return;
                                  listingMutation.mutate({ id: v.id, action: 'unlist', reason });
                                }}
                              >
                                <EyeOff className="h-4 w-4" />
                                下架
                              </Button>
                            )}
                            {v.listingStatus !== 'yanked' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const reason = askReason('yank');
                                  if (reason === null) return;
                                  listingMutation.mutate({ id: v.id, action: 'yank', reason });
                                }}
                              >
                                <Ban className="h-4 w-4" />
                                Yank
                              </Button>
                            )}
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                if (!window.confirm(`确定硬删除 v${v.version}？`)) return;
                                const reason = askReason('删除版本');
                                if (reason === null) return;
                                deleteVersionMutation.mutate({ id: v.id, reason });
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <p className="mt-2 break-all font-mono text-[11px] text-ink-3">
                          {v.sha256}
                        </p>
                        {v.reviewComment && (
                          <p className="mt-1 text-sm text-ink-2">审核意见：{v.reviewComment}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {detailQuery.isLoading && selectedID !== null && (
                <div className="flex items-center gap-2 text-sm text-ink-3">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  加载插件详情…
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="audit" className="mt-5">
          {auditQuery.isLoading ? (
            <div className="h-40 animate-pulse rounded-lg border border-line bg-card" />
          ) : (auditQuery.data?.items ?? []).length === 0 ? (
            <EmptyState icon={History} title="暂无操作记录" />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line bg-card">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line text-xs text-ink-3">
                  <tr>
                    <th className="px-4 py-3">时间</th>
                    <th className="px-4 py-3">操作人</th>
                    <th className="px-4 py-3">动作</th>
                    <th className="px-4 py-3">目标</th>
                    <th className="px-4 py-3">原因</th>
                  </tr>
                </thead>
                <tbody>
                  {(auditQuery.data?.items ?? []).map((item) => (
                    <tr key={item.id} className="border-b border-line last:border-0">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-3">
                        {formatDateTime(item.createdAt)}
                      </td>
                      <td className="px-4 py-3">{item.operator}</td>
                      <td className="px-4 py-3 font-mono text-xs">{item.action}</td>
                      <td className="px-4 py-3 text-xs">
                        {item.targetType}#{item.targetId}
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-3">{item.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || auditQuery.isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= auditTotalPages || auditQuery.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
