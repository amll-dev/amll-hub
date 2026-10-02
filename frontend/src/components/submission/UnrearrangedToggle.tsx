import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import type { UnrearrangedMode } from '@/hooks/useUnrearrangedMode';

export interface UnrearrangedToggleProps {
  mode: UnrearrangedMode;
  /** 开关下方的说明文案 */
  description?: string;
  /** 右上角小徽章文案，如「原始文件直传」；不传则不显示 */
  badge?: string;
  /** 紧凑模式（用于弹窗/侧栏等空间较小处） */
  compact?: boolean;
}

/**「上传未重排歌词」开关及原因输入 */
export function UnrearrangedToggle({
  mode,
  description = '勾选后不做重排（元数据仍照常解析），.ttml 原样上传。',
  badge,
  compact = false,
}: UnrearrangedToggleProps) {
  const { isUnrearranged, setUnrearranged, reason, setReason, reasonMissing } = mode;

  return (
    <>
      <label
        className={`flex cursor-pointer items-start gap-3 rounded-md border transition-colors ${
          compact ? 'px-3 py-2.5' : 'px-4 py-3'
        } ${
          isUnrearranged
            ? 'border-amber-500/50 bg-amber-50 dark:bg-amber-950/25'
            : 'border-line bg-surface-2 hover:border-primary/40'
        }`}
      >
        <input
          type="checkbox"
          checked={isUnrearranged}
          onChange={(e) => setUnrearranged(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">
            上传未重排歌词
            {badge && (
              <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-normal text-amber-600 dark:text-amber-400">
                {badge}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-ink-3">{description}</span>
        </span>
      </label>

      <AnimatePresence initial={false}>
        {isUnrearranged && (
          <motion.div
            key="unrearranged-reason"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >

            <div className={`-mx-1 px-1 ${compact ? 'mb-4' : 'mt-3'}`}>
              <label
                className={`mb-1.5 block font-medium text-ink-2 ${compact ? 'text-xs' : 'text-sm'}`}
              >
                未重排原因
                <span className="ml-1 text-red-500">*</span>
                <span className="ml-1.5 text-xs font-normal text-ink-3">必填</span>
              </label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="原因"
                className={`w-full resize-none px-3 py-2 ${
                  compact ? 'bg-background' : 'bg-surface-2 px-4 py-2.5'
                }`}
              />
              <div className="mt-1 flex items-center justify-between gap-2">
                <span
                  className={`flex items-center gap-1 text-xs ${
                    reasonMissing ? 'text-red-500' : 'text-ink-3'
                  }`}
                >
                  {reasonMissing && <AlertTriangle className="h-3 w-3 shrink-0" />}
                  {reasonMissing ? '未填写原因，无法提交' : '将会显示在详情页'}
                </span>
                <span className="shrink-0 text-xs text-ink-3">{reason.length}/500</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
