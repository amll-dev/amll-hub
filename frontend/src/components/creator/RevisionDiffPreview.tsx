import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatLyricTime } from '@/lib/format';
import type { LineChangeKind, LineDiff, RevisionDiffSnapshot } from '@/lib/review/revision-diff';
import { cn } from '@/lib/utils';

const KIND_META: Record<LineChangeKind, { label: string; className: string }> = {
  modified: {
    label: '修改',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  },
  added: {
    label: '新增',
    className: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  },
  removed: {
    label: '删除',
    className: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  },
  unchanged: { label: '未改动', className: 'bg-surface-2 text-ink-3' },
};

type WordPart = { text: string; kind: 'same' | 'removed' | 'added' };

const WORD_CLASS: Record<WordPart['kind'], string> = {
  same: 'bg-surface-2 text-ink-2',
  removed: 'bg-red-100 text-red-700 line-through dark:bg-red-500/15 dark:text-red-300',
  added: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded bg-background px-3 py-2">
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function shiftText(delta: number): string {
  return `${delta > 0 ? '+' : ''}${Math.round(delta)}ms`;
}

function diffWords(before: string[], after: string[]): WordPart[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length - 1;
  let endAfter = after.length - 1;
  while (endBefore >= start && endAfter >= start && before[endBefore] === after[endAfter]) {
    endBefore--;
    endAfter--;
  }

  const parts: WordPart[] = [];
  for (let i = 0; i < start; i++) parts.push({ text: before[i] ?? '', kind: 'same' });
  for (let i = start; i <= endBefore; i++) parts.push({ text: before[i] ?? '', kind: 'removed' });
  for (let i = start; i <= endAfter; i++) parts.push({ text: after[i] ?? '', kind: 'added' });
  for (let i = endBefore + 1; i < before.length; i++) {
    parts.push({ text: before[i] ?? '', kind: 'same' });
  }
  return parts;
}

/** 单行差异 */
function DiffLine({ line }: { line: LineDiff }) {
  const [open, setOpen] = useState(false);
  const kind = KIND_META[line.kind] ?? KIND_META.modified;
  const shifts = line.shifts ?? [];
  const wordShifts = shifts.filter((s) => s.kind === 'word');
  const lineShift = shifts.find((s) => s.kind === 'line');
  const featureChanges = line.featureChanges ?? [];
  const featureDetails = line.featureDetails ?? [];
  const wordParts = diffWords(line.originalWords ?? [], line.revisedWords ?? []);

  return (
    <li className="min-w-0">
      <div className="min-w-0 rounded border border-line bg-background">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-left text-xs"
        >
          <Badge
            variant="outline"
            className={cn(
              'inline-flex shrink-0 items-center rounded-full border-transparent px-2 py-0.5 text-[11px] font-medium',
              kind.className
            )}
          >
            {kind.label}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-ink-2">
            {line.revisedText || line.originalText}
          </span>
          {line.textChanged && <span className="shrink-0 text-ink-3">文本</span>}
          {lineShift && <span className="shrink-0 text-ink-3">{shiftText(lineShift.delta)}</span>}
          {!line.textChanged && wordShifts.length > 0 && (
            <span className="shrink-0 text-ink-3">{wordShifts.length} 字偏移</span>
          )}
          {featureChanges.map((f) => (
            <span key={f} className="shrink-0 text-ink-3">
              {f}
            </span>
          ))}
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform duration-200',
              open && 'rotate-180'
            )}
          />
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="min-w-0 space-y-2 border-t border-line px-3 py-2 text-xs">
                {line.textChanged && (
                  <div className="space-y-1">
                    <p className="text-ink-3 line-through whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {line.originalText || '（空）'}
                    </p>
                    <p className="text-foreground whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {line.revisedText || '（空）'}
                    </p>
                  </div>
                )}
                {line.textChanged && wordParts.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] text-ink-3">逐词对照（删除线为原词）</p>
                    <div className="flex flex-wrap items-center gap-1">
                      {wordParts.map((part, idx) => (
                        <span
                          key={`${idx}-${part.kind}`}
                          className={cn(
                            'max-w-full rounded px-1 py-0.5 text-[11px] break-all',
                            WORD_CLASS[part.kind]
                          )}
                        >
                          {part.text || '␣'}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {line.kind !== 'added' && line.kind !== 'removed' && (
                  <p className="text-ink-3">
                    时间轴：{formatLyricTime(line.originalStart)} →{' '}
                    {formatLyricTime(line.revisedStart)}
                    {line.startShift !== 0 && `（${shiftText(line.startShift)}）`}
                  </p>
                )}
                {wordShifts.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {wordShifts.map((s) => (
                      <span
                        key={`${s.index}-${s.to}`}
                        className="max-w-full rounded bg-surface-2 px-1.5 py-0.5 text-[11px] break-all text-ink-2"
                      >
                        {s.index >= 0 ? `第 ${s.index + 1} 字` : '行'}
                        {s.text ? `「${s.text}」` : ''} {shiftText(s.delta)}
                      </span>
                    ))}
                  </div>
                )}
                {featureDetails.map((f) => (
                  <p key={f.kind} className="text-ink-2 [overflow-wrap:anywhere]">
                    {f.label}：
                    <span className="text-ink-3 line-through">{f.before || '（空）'}</span>
                    <span className="mx-1 text-ink-3">→</span>
                    <span className="text-foreground">{f.after || '（空）'}</span>
                  </p>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </li>
  );
}

/** 修正投稿的差异展示 */
export function RevisionDiffPreview({
  snapshot,
  className,
  collapsible = false,
  defaultOpen = true,
}: {
  snapshot: RevisionDiffSnapshot;
  className?: string;
  collapsible?: boolean;
  /** 折叠时初始是否展开 */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const stats = snapshot?.stats;
  if (!stats) return null;

  const lines = snapshot.lines ?? [];
  const metadata = snapshot.metadata ?? [];
  const problems = stats.problems ?? [];
  const changed = stats.addedLines + stats.removedLines + stats.modifiedLines;
  const expanded = collapsible ? open : true;
  const target = snapshot.target;

  return (
    <div className={cn('min-w-0 max-w-full rounded-lg border border-line bg-card p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">歌词差异</h3>
          <p className="mt-1 text-xs text-ink-3 [overflow-wrap:anywhere]">
            {changed > 0 ? `共 ${changed} 行有变化` : '没有行级差异'}
            {target && (
              <>
                {' · 修正自 '}
                {target.title || '未知歌曲'}
                {target.artist ? ` - ${target.artist}` : ''}
              </>
            )}
          </p>
        </div>
        {collapsible && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
          >
            {open ? '收起' : '展开'}
            <ChevronDown
              className={cn('h-3 w-3 transition-transform duration-200', open && 'rotate-180')}
            />
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-2 gap-2 pt-3 sm:grid-cols-4">
              <Stat label="原稿行数" value={stats.originalLines} />
              <Stat label="新稿行数" value={stats.revisedLines} />
              <Stat label="修改行" value={stats.modifiedLines} />
              <Stat label="新增 / 删除" value={`${stats.addedLines} / ${stats.removedLines}`} />
              <Stat label="文本改动" value={stats.textChangedLines} />
              <Stat label="时间轴改动" value={stats.timingChangedLines} />
              <Stat label="逐字平均偏移" value={shiftText(stats.meanAbsWordShift)} />
              <Stat label="逐字最大偏移" value={shiftText(stats.maxAbsWordShift)} />
              <Stat
                label="明显偏移字数"
                value={`${stats.shiftedWordCount} / ${stats.totalWordCount}`}
              />
              <Stat label="问题行" value={stats.problemLineCount} />
            </div>

            {metadata.length > 0 && (
              <div className="mt-4">
                <h4 className="mb-2 text-xs font-medium text-ink-2">元数据变更</h4>
                <ul className="space-y-1.5">
                  {metadata.map((item) => (
                    <li
                      key={item.field}
                      className="rounded bg-surface-2 px-3 py-2 text-xs [overflow-wrap:anywhere]"
                    >
                      <span className="mr-1.5 font-medium text-ink-2">{item.label}</span>
                      <span className="text-ink-3 line-through">{item.before}</span>
                      <span className="mx-1.5 text-ink-3">→</span>
                      <span className="text-foreground">{item.after}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {problems.length > 0 && (
              <div className="mt-4">
                <h4 className="mb-2 text-xs font-medium text-ink-2">新稿问题</h4>
                <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-300">
                  {problems.map((p, i) => (
                    <li key={`${p.lineIndex}-${p.kind}-${i}`}>• {p.message}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4">
              <h4 className="mb-2 text-xs font-medium text-ink-2">
                逐行明细
                {lines.length > 0 && (
                  <span className="ml-1.5 font-normal text-ink-3">{lines.length} 行</span>
                )}
              </h4>
              {lines.length === 0 ? (
                <p className="rounded bg-surface-2 px-3 py-4 text-center text-xs text-ink-3">
                  本次修正没有逐行改动
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {lines.map((line, i) => (
                    <DiffLine key={`${line.originalIndex}-${line.revisedIndex}-${i}`} line={line} />
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
