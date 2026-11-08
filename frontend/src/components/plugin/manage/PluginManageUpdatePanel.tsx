import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { PluginSubmitForm } from '@/components/plugin/PluginSubmitForm';
import type { Plugin } from '@/lib/types';

/** 更新插件面板 */
export function PluginManageUpdatePanel({
  open,
  plugin,
  onClose,
  onChanged,
}: {
  open: boolean;
  plugin: Plugin;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="plugin-submit"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="overflow-hidden"
        >
          <div className="rounded-lg border border-line bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">更新插件</h3>
              <button
                type="button"
                onClick={onClose}
                className="text-ink-3 hover:text-foreground"
                aria-label="关闭更新插件"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <PluginSubmitForm
              existingPlugin={{
                pluginKey: plugin.pluginKey,
                summary: plugin.summary,
                descriptionMd: plugin.descriptionMd,
                repoUrl: plugin.repoUrl,
                license: plugin.license,
                tags: plugin.tags,
              }}
              onSuccess={() => {
                onClose();
                onChanged();
              }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
