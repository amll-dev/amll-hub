import { useMutation } from '@tanstack/react-query';
import { PackageX, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
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

/** 发布者操作按钮 */
export function PluginManageActions({
  pluginKey,
  isOffline,
  onToggleSubmit,
  onChanged,
}: {
  pluginKey: string;
  isOffline: boolean;
  onToggleSubmit: () => void;
  onChanged: () => void;
}) {
  const unlistMutation = useMutation({
    mutationFn: () => api.pluginStore.unlistMyPlugin(pluginKey),
    onSuccess: () => {
      toast.success('插件已下架');
      onChanged();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '下架失败'),
  });

  return (
    <>
      <button
        type="button"
        onClick={onToggleSubmit}
        className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary-hover"
      >
        <Upload className="h-3.5 w-3.5" />
        更新插件
      </button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            disabled={isOffline || unlistMutation.isPending}
            className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-3"
          >
            <PackageX className="h-3.5 w-3.5" />
            下架插件
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认下架该插件？</AlertDialogTitle>
            <AlertDialogDescription>
              下架后所有已上架版本会从插件广场移除，之后仍可重新投稿新版本。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => unlistMutation.mutate()}>确认下架</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
