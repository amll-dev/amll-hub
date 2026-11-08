import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { compressAvatar } from '@/lib/image';
import { AvatarUploadDialog } from '@/components/profile/AvatarUploadDialog';
import { PluginIcon } from '@/components/plugin/shared';

/** 插件图标上传面板 */
export function PluginManageIconUploader({
  open,
  pluginKey,
  pluginName,
  iconUrl,
  onClose,
  onChanged,
}: {
  open: boolean;
  pluginKey: string;
  pluginName: string;
  iconUrl?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const iconMutation = useMutation({
    mutationFn: async ({ file, zoom }: { file: File; zoom: number }) => {
      const compressed = await compressAvatar(file, zoom, { size: 512, maxSizeMB: 0.24 });
      const fd = new FormData();
      fd.append('file', compressed);
      return api.pluginStore.uploadIcon(pluginKey, fd);
    },
    onSuccess: () => {
      toast.success('图标已更新');
      setDialogOpen(false);
      setIconFile(null);
      onChanged();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '图标上传失败'),
  });

  return (
    <>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="plugin-icon"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="rounded-lg border border-line bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">上传图标</h3>
                <button
                  type="button"
                  onClick={onClose}
                  className="text-ink-3 hover:text-foreground"
                  aria-label="关闭上传图标"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <PluginIcon name={pluginName} iconUrl={iconUrl} className="h-20 w-20" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-3">
                    支持 PNG / JPEG / WebP，建议 1:1。选择后会打开确认窗口，可缩放并自动压缩。
                  </p>
                  <label className="mt-2 inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-surface-2 px-3 text-sm text-ink-2 hover:text-foreground">
                    {iconMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ImagePlus className="h-4 w-4" />
                    )}
                    选择图片
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setIconFile(file);
                          setDialogOpen(true);
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AvatarUploadDialog
        open={dialogOpen}
        file={iconFile}
        pending={iconMutation.isPending}
        title="上传图标"
        shape="square"
        onCancel={() => {
          setDialogOpen(false);
          setIconFile(null);
        }}
        onConfirm={(zoom) => {
          if (iconFile) iconMutation.mutate({ file: iconFile, zoom });
        }}
      />
    </>
  );
}
