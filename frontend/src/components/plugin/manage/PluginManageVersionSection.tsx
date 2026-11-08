import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { FileArchive, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatBytes, formatCount, formatDateTime } from '@/lib/format';
import { fadeUp } from '@/lib/motion';
import { Button } from '@/components/ui/button';
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
import { PluginChannelBadge, PluginReviewBadge } from '@/components/plugin/shared';
import type { PluginManagementVersion } from '@/lib/types';

/** 插件版本记录 */
export function PluginManageVersionSection({
  pluginKey,
  versions,
  latestVersionId,
  isOwner,
  onChanged,
}: {
  pluginKey: string;
  versions: PluginManagementVersion[];
  latestVersionId?: number;
  isOwner: boolean;
  onChanged: () => void;
}) {
  const downloadMutation = useMutation({
    mutationFn: ({ id, version }: { id: number; version: string }) =>
      api.pluginStore.downloadSubmissionArtifact(id, `${pluginKey}-v${version}.zip`),
    onError: (err) => toast.error(err instanceof Error ? err.message : '下载失败'),
  });

  const rollbackMutation = useMutation({
    mutationFn: (versionID: number) =>
      api.pluginStore.rollbackMyPluginVersion(pluginKey, versionID),
    onSuccess: () => {
      toast.success('已回滚到所选版本');
      onChanged();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '回滚失败'),
  });

  return (
    <motion.section variants={fadeUp} className="rounded-lg border border-line bg-card p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground">版本记录</h3>
      </div>

      {versions.length === 0 ? (
        <EmptyState icon={FileArchive} title="还没有版本" size="sm" />
      ) : (
        <div className="space-y-3">
          {versions.map((v) => {
            const isLatest = v.id === latestVersionId;
            const canSwitch =
              isOwner && v.reviewStatus === 'approved' && v.listingStatus !== 'listed';
            const switchLabel = isLatest ? '升级到最新版本' : '回滚到此版本';
            return (
              <div key={v.id} className="rounded-md border border-line bg-surface-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">v{v.version}</span>
                      <PluginChannelBadge channel={v.channel} />
                      <PluginReviewBadge status={v.reviewStatus} />
                    </div>
                    <p className="mt-1 text-xs text-ink-3">
                      提交于 {formatDateTime(v.submittedAt)} · {formatBytes(v.sizeBytes)}
                      {v.downloadCount > 0 ? ` · ${formatCount(v.downloadCount)} 次下载` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canSwitch && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" disabled={rollbackMutation.isPending}>
                            <RotateCcw className="h-4 w-4" />
                            {switchLabel}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>确认{switchLabel}？</AlertDialogTitle>
                            <AlertDialogDescription>
                              切换后 v{v.version} 成为当前上架版本。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction onClick={() => rollbackMutation.mutate(v.id)}>
                              确认
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={downloadMutation.isPending}
                      onClick={() => downloadMutation.mutate({ id: v.id, version: v.version })}
                    >
                      {downloadMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FileArchive className="h-4 w-4" />
                      )}
                      下载原包
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </motion.section>
  );
}
