import { Check, Music, Pencil, Trash2 } from 'lucide-react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  reviewReportFormatAtom,
  type ReviewReportFormat,
} from '$/modules/review/services/report-service/format-service';
import {
  createManualReviewReport,
  createReviewReport,
  normalizeReviewReport,
} from '$/modules/review/services/report-service/normalize-service';
import { captureManualReviewReportPlacements } from '$/modules/review/services/report-service/ordering-service';
import {
  getReviewReportBlockText,
  renderReviewReport,
} from '$/modules/review/services/report-service/render-service';
import type { ReviewReportBlock } from '$/modules/review/services/report-service/types';
import { ReviewTemplateSection } from '$/modules/review/services/review-template-service';
import { renderMarkdown } from '@/components/submission/shared';
import { ReportFormatEditor } from './ReportFormatEditor';
import {
  effectiveReviewReportAtom,
  reviewActionAtom,
  reviewReportDialogAtom,
  reviewUploadTtmlAtom,
} from '$/modules/review/states';

class DialogContentBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error('[ReviewReportDialog] 内容渲染失败:', error);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="p-3">
          <p className="text-sm font-bold text-error">审阅结果面板加载失败</p>
          <p className="mt-2 text-xs text-ink-3">{this.state.error.message}</p>
          <p className="mt-2 text-xs text-ink-3">
            详细堆栈见浏览器控制台。可以先关闭本窗口继续编辑，改用「编辑」 面板里的保存按钮提交。
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

function DialogFlexBody({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
}

export interface ReviewReportDialogProps {
  /** 提交：走本站的保存修订版链路 */
  onSubmit: (input: { reportMd: string; action: string; uploadTtml: boolean }) => void;
  /** 是否正在提交 */
  submitting: boolean;
}

/** 单个报告块的一行摘要 */
function blockSummary(block: ReviewReportBlock): string {
  switch (block.kind) {
    case 'manual':
      return block.content.slice(0, 40) || '（空）';
    case 'wordTextShared':
      return `「${block.oldWord}」→「${block.newWord}」`;
    case 'wordText':
      return `第 ${block.lineNumber} 行 · 「${block.oldWord}」→「${block.newWord}」`;
    case 'wordTextGroup':
      return `第 ${block.lineNumber} 行 · ${block.changes.length} 处文字改动`;
    case 'wordRoman':
      return `第 ${block.lineNumber} 行音译 · 「${block.oldRoman}」→「${block.newRoman}」`;
    case 'lineTranslation':
      return `第 ${block.lineNumber} 行翻译`;
    case 'lineRoman':
      return `第 ${block.lineNumber} 行音译`;
    case 'wordAndRoman':
      return `第 ${block.lineNumber} 行 · 原文 + 音译`;
    case 'wordAdded':
      return `第 ${block.lineNumber} 行新增「${block.word}」`;
    case 'wordRemoved':
      return `第 ${block.lineNumber} 行删除「${block.word}」`;
    case 'lineAdded':
      return `新增歌词「${block.text.slice(0, 20)}」`;
    case 'lineRemoved':
      return `删除歌词「${block.text.slice(0, 20)}」`;
    case 'timeShift':
      return `时轴平移 ${block.offsetMs > 0 ? '+' : ''}${block.offsetMs}ms（${block.targetCount}/${block.totalLineCount} 行）`;
    case 'timing':
      return `第 ${block.lineNumber} 行 · 「${block.word}」打轴调整`;
    case 'lineTiming':
      return `第 ${block.lineNumber} 行时轴调整`;
    case 'metadata':
      return `元数据（${block.label}）${block.action === 'add' ? '增加' : '删除'} ${block.items.join('、')}`;
    default:
      return '未知条目';
  }
}

function getReportBlockScopeLabel(block: ReviewReportBlock): string | null {
  if (block.kind === 'manual' || block.kind === 'metadata') return null;
  if (block.kind === 'timeShift') {
    return block.targetCount === block.totalLineCount
      ? '全部歌词行'
      : block.lineRefs
          .map((item) => `第 ${item.lineNumber} 行${item.isBG ? '（背景）' : ''}`)
          .join('、');
  }
  if (block.kind === 'wordTextShared') {
    return block.lineRefs
      .map((item) => `第 ${item.lineNumber} 行${item.isBG ? '（背景）' : ''}`)
      .join('、');
  }
  return `第 ${block.lineNumber} 行${block.isBG ? '（背景）' : ''}`;
}

function getReportBlockScopeKey(block: ReviewReportBlock): string | null {
  if (block.kind === 'manual' || block.kind === 'metadata') return null;
  if (block.kind === 'timeShift' || block.kind === 'wordTextShared') {
    return `${block.kind}:${block.id}`;
  }
  return `line:${block.lineNumber}:${block.isBG ? 'bg' : 'main'}`;
}

type ReportBlockSequenceGroup = {
  key: string;
  scopeKey: string | null;
  scopeLabel: string | null;
  blocks: ReviewReportBlock[];
};

function createReportBlockSequenceGroups(blocks: ReviewReportBlock[]): ReportBlockSequenceGroup[] {
  const groups: ReportBlockSequenceGroup[] = [];
  const groupsByScope = new Map<string, ReportBlockSequenceGroup>();
  for (const block of blocks) {
    const scopeKey = getReportBlockScopeKey(block);
    const existingGroup = scopeKey ? groupsByScope.get(scopeKey) : undefined;
    if (existingGroup) {
      existingGroup.blocks.push(block);
      continue;
    }
    const group = {
      key: block.id,
      scopeKey,
      scopeLabel: getReportBlockScopeLabel(block),
      blocks: [block],
    };
    groups.push(group);
    if (scopeKey) groupsByScope.set(scopeKey, group);
  }
  return groups;
}

/** wordTextGroup 的单条改动是否启用（块本身启用，且该条未被单独禁用） */
function isWordTextGroupChangeEnabled(
  block: Extract<ReviewReportBlock, { kind: 'wordTextGroup' }>,
  index: number
): boolean {
  return block.enabled && block.changes[index]?.enabled !== false;
}

function ManualReportBlockView({
  block,
  onChange,
  onLineBreakChange,
  onToggle,
  onDelete,
  onMove,
  canMove,
}: {
  block: Extract<ReviewReportBlock, { kind: 'manual' }>;
  onChange: (id: string, content: string) => void;
  onLineBreakChange: (id: string, lineBreakBefore: boolean) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  canMove: (id: string, direction: -1 | 1) => boolean;
}) {
  const [focused, setFocused] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div
      className={`rounded-md border border-line bg-muted p-2 ${
        block.enabled ? 'opacity-100' : 'opacity-50'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Checkbox checked={block.enabled} onCheckedChange={(v) => onToggle(block.id, v)} />
          <span className="text-sm font-medium text-foreground">手写内容</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1" title="在 Markdown 预览中另起一行">
            <Switch
              checked={block.lineBreakBefore === true}
              onCheckedChange={(v) => onLineBreakChange(block.id, v)}
              aria-label="换行"
            />
            <span className="text-xs text-ink-3">换行</span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!canMove(block.id, -1)}
            onClick={() => onMove(block.id, -1)}
            title="将手写条目上移"
          >
            上移
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!canMove(block.id, 1)}
            onClick={() => onMove(block.id, 1)}
            title="将手写条目下移"
          >
            下移
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-error hover:text-error"
            onClick={() => onDelete(block.id)}
            title="删除条目"
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      {focused ? (
        <Textarea
          ref={textAreaRef}
          value={block.content}
          onChange={(e) => onChange(block.id, e.currentTarget.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="手写报告内容"
          className="min-h-24"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setFocused(true);
            window.requestAnimationFrame(() => textAreaRef.current?.focus());
          }}
          className={`block min-h-10 w-full cursor-text rounded border border-dashed border-line bg-transparent p-2 text-left text-[13px] leading-relaxed ${
            block.content.trim() ? 'text-inherit' : 'text-muted-foreground'
          }`}
        >
          {block.content.trim() || '点击展开并编辑手写内容'}
        </button>
      )}
    </div>
  );
}

function StructuredReportBlockView({
  block,
  onToggle,
  onToggleGroupChange,
  onDelete,
  reportFormat,
}: {
  block: ReviewReportBlock;
  onToggle: (id: string, enabled: boolean) => void;
  onToggleGroupChange: (id: string, index: number, enabled: boolean) => void;
  onDelete: (id: string) => void;
  reportFormat: ReviewReportFormat;
}) {
  const title = getReviewReportBlockText(block, reportFormat);

  return (
    <div
      className={`flex min-w-0 items-center justify-between gap-1 rounded border border-line bg-muted px-1.5 py-1 ${
        block.enabled ? 'opacity-100' : 'opacity-50'
      }`}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {block.kind === 'wordTextGroup' ? (
          block.changes.map((change, index) => {
            const enabled = isWordTextGroupChangeEnabled(block, index);
            return (
              <button
                key={`${change.wordId ?? `${change.oldWord}->${change.newWord}`}`}
                type="button"
                aria-pressed={enabled}
                title={enabled ? '点击禁用该结果' : '点击启用该结果'}
                onClick={() => onToggleGroupChange(block.id, index, !enabled)}
                className={`cursor-pointer rounded-[3px] border border-line px-1.5 py-px text-xs ${
                  enabled
                    ? 'bg-primary-soft text-primary no-underline'
                    : 'bg-transparent text-muted-foreground line-through'
                }`}
              >
                {change.oldWord} → {change.newWord}
              </button>
            );
          })
        ) : (
          <button
            type="button"
            aria-pressed={block.enabled}
            title={block.enabled ? '点击禁用该结果' : '点击启用该结果'}
            onClick={() => onToggle(block.id, !block.enabled)}
            className={`max-w-full cursor-pointer overflow-hidden rounded-[3px] border border-line px-1.5 py-px text-xs text-ellipsis whitespace-nowrap ${
              block.enabled
                ? 'bg-primary-soft text-primary no-underline'
                : 'bg-transparent text-muted-foreground line-through'
            }`}
          >
            {blockSummary(block)}
          </button>
        )}
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="shrink-0 text-error hover:text-error"
        onClick={() => onDelete(block.id)}
        title="删除条目"
      >
        <Trash2 />
      </Button>
      {title ? <span className="hidden">{title}</span> : null}
    </div>
  );
}

const ACTION_BUTTONS = [
  {
    action: 'approve',
    label: '接受',
    className: 'bg-success text-white hover:bg-success/90',
    Icon: Check,
  },
  {
    action: 'revision',
    label: '需要修改',
    className: 'bg-error text-white hover:bg-error/90',
    Icon: Pencil,
  },
  {
    action: 'missing_audio',
    label: '缺少音源',
    className: 'bg-warning text-white hover:bg-warning/90',
    Icon: Music,
  },
] as const;

const BRAND_ACCENT = {
  '--accent-1': '#fff5f6',
  '--accent-2': '#feeaec',
  '--accent-3': '#fbdde0',
  '--accent-4': '#f9c8cd',
  '--accent-5': '#f6aeb6',
  '--accent-6': '#f3919d',
  '--accent-7': '#ef7484',
  '--accent-8': '#ec576b',
  '--accent-9': '#e0303f',
  '--accent-10': '#c22a38',
  '--accent-11': '#a81f2c',
  '--accent-12': '#8a1a25',
  '--accent-13': '#6b141d',
  '--accent-contrast': '#ffffff',
  '--accent-surface': '#fff5f6',
  '--accent-indicator': '#e0303f',
  '--accent-track': '#fbdde0',
} as CSSProperties;

export const ReviewReportDialog = ({ onSubmit, submitting }: ReviewReportDialogProps) => {
  const [dialog, setDialog] = useAtom(reviewReportDialogAtom);
  const autoReport = useAtomValue(effectiveReviewReportAtom);
  const reportFormat = useAtomValue(reviewReportFormatAtom);
  const setReportFormat = useSetAtom(reviewReportFormatAtom);
  const [action, setAction] = useAtom(reviewActionAtom);
  const [uploadTtml, setUploadTtml] = useAtom(reviewUploadTtmlAtom);

  const [activeTab, setActiveTab] = useState('blocks');
  const [draft, setDraft] = useState(() => createReviewReport());

  const initializedRef = useRef(false);
  useEffect(() => {
    if (!autoReport) return;
    setDraft(normalizeReviewReport(autoReport));
    if (!initializedRef.current) {
      initializedRef.current = true;
      setActiveTab('blocks');
    }
  }, [autoReport]);

  const renderedReport = useMemo(() => renderReviewReport(draft), [draft]);
  const renderedReportHtml = useMemo(() => renderMarkdown(renderedReport), [renderedReport]);
  const blocks = useMemo(() => normalizeReviewReport(draft).blocks, [draft]);
  const blockGroups = useMemo(() => createReportBlockSequenceGroups(blocks), [blocks]);
  const close = () => setDialog({ ...dialog, open: false });
  const updateReportBlocks = (updater: (prev: ReviewReportBlock[]) => ReviewReportBlock[]) => {
    setDraft(createReviewReport(captureManualReviewReportPlacements(updater(blocks))));
  };

  const patchBlock = (id: string, patch: Partial<ReviewReportBlock>) => {
    updateReportBlocks((prev) =>
      prev.map((b) => (b.id === id ? ({ ...b, ...patch } as ReviewReportBlock) : b))
    );
  };

  const toggleBlock = (id: string, enabled: boolean) => {
    updateReportBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        if (b.kind === 'wordTextGroup') {
          return {
            ...b,
            enabled,
            changes: b.changes.map((c) => ({ ...c, enabled })),
          };
        }
        return { ...b, enabled };
      })
    );
  };

  const toggleGroupChange = (id: string, index: number, enabled: boolean) => {
    updateReportBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== id || b.kind !== 'wordTextGroup') return b;
        const changes = b.changes.map((c, i) => (i === index ? { ...c, enabled } : c));
        return {
          ...b,
          enabled: changes.some((c) => c.enabled !== false),
          changes,
        };
      })
    );
  };

  const removeBlock = (id: string) => {
    updateReportBlocks((prev) => prev.filter((b) => b.id !== id));
  };

  const moveManual = (id: string, direction: -1 | 1) => {
    updateReportBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      if (prev[target]?.kind !== 'manual') return prev;
      const next = [...prev];
      const current = next[index]!;
      const moved = next[target]!;
      next[index] = moved;
      next[target] = current;
      return next;
    });
  };

  const canMove = (id: string, direction: -1 | 1) => {
    const index = blocks.findIndex((b) => b.id === id);
    const target = index + direction;
    return index >= 0 && target >= 0 && target < blocks.length && blocks[target]?.kind === 'manual';
  };

  const addManual = () => {
    const block: ReviewReportBlock = {
      id: `manual-${Date.now()}`,
      kind: 'manual',
      enabled: true,
      content: '',
      lineBreakBefore: false,
    };
    updateReportBlocks((prev) => [...prev, block]);
    setActiveTab('blocks');
  };

  const insertTemplate = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    updateReportBlocks((prev) => [...createManualReviewReport(trimmed).blocks, ...prev]);
    setActiveTab('blocks');
  };

  if (!dialog.open) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="w-[92vw] max-w-[1100px] h-[88vh] max-h-[88vh] flex flex-col overflow-hidden bg-card text-foreground border border-line p-0 gap-0"
        style={{ zIndex: 400, ...BRAND_ACCENT }}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogContentBoundary>
          <DialogFlexBody>
            <DialogTitle className="shrink-0 p-4 pb-2 font-semibold">
              对稿件【{dialog.title}】做出的审阅结果如下：
            </DialogTitle>
            <div className="shrink-0 px-4">
              <ReviewTemplateSection open={dialog.open} onInsertTemplate={insertTemplate} />
            </div>

            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="flex min-h-0 flex-1 flex-col px-4"
            >
              <TabsList className="shrink-0 px-0">
                <TabsTrigger value="blocks">条目</TabsTrigger>
                <TabsTrigger value="format">格式</TabsTrigger>
                <TabsTrigger value="text">文本</TabsTrigger>
                <TabsTrigger value="preview">预览</TabsTrigger>
              </TabsList>

              {/* 条目 */}
              <TabsContent value="blocks" className="flex min-h-0 flex-1 flex-col">
                <p className="mb-2 shrink-0 text-xs text-ink-3">
                  结构化条目按系统顺序排列；手写条目可通过上移/下移插入序列。
                </p>
                <ScrollArea className="min-h-0 flex-1 overflow-auto">
                  {blockGroups.length === 0 ? (
                    <div className="flex h-[200px] items-center justify-center">
                      <span className="text-sm text-ink-3">暂无报告条目</span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {blockGroups.map((group) => (
                        <div key={group.key} className="min-w-0">
                          {group.scopeLabel && (
                            <p className="mb-1 text-xs font-semibold text-ink-3">
                              {group.scopeLabel}
                            </p>
                          )}
                          <div className="flex min-w-0 flex-col gap-1">
                            {group.blocks.map((block) =>
                              block.kind === 'manual' ? (
                                <ManualReportBlockView
                                  key={block.id}
                                  block={block}
                                  onChange={(id, content) =>
                                    patchBlock(id, { content } as Partial<ReviewReportBlock>)
                                  }
                                  onLineBreakChange={(id, lineBreakBefore) =>
                                    patchBlock(id, {
                                      lineBreakBefore,
                                    } as Partial<ReviewReportBlock>)
                                  }
                                  onToggle={toggleBlock}
                                  onDelete={removeBlock}
                                  onMove={moveManual}
                                  canMove={canMove}
                                />
                              ) : (
                                <StructuredReportBlockView
                                  key={block.id}
                                  block={block}
                                  onToggle={toggleBlock}
                                  onToggleGroupChange={toggleGroupChange}
                                  onDelete={removeBlock}
                                  reportFormat={reportFormat}
                                />
                              )
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
                <div className="sticky bottom-0 mt-2 flex shrink-0 justify-end bg-card">
                  <Button type="button" size="sm" variant="secondary" onClick={addManual}>
                    新增手写条目
                  </Button>
                </div>
              </TabsContent>

              {/* 格式 */}
              <TabsContent value="format" className="flex min-h-0 flex-1 flex-col p-2">
                <ReportFormatEditor
                  value={reportFormat}
                  onChange={setReportFormat}
                  report={draft}
                />
              </TabsContent>

              {/* 文本 */}
              <TabsContent value="text" className="min-h-0 flex-1">
                <ScrollArea className="min-h-0 flex-1 overflow-auto">
                  <div className="p-2">
                    <Textarea
                      value={renderedReport}
                      readOnly
                      aria-label="自动生成的审阅报告文本"
                      className="min-h-[400px] font-mono"
                    />
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* 预览 */}
              <TabsContent value="preview" className="min-h-0 flex-1">
                <ScrollArea className="min-h-0 flex-1 overflow-auto">
                  <div className="p-2">
                    {renderedReport ? (
                      <div
                        className="comment-markdown"
                        dangerouslySetInnerHTML={{ __html: renderedReportHtml }}
                      />
                    ) : (
                      <span className="text-sm text-ink-3">（报告为空）</span>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>

            {/* 底部操作栏 */}
            <div className="flex shrink-0 flex-wrap items-center gap-2 p-4 pt-2">
              <Button type="button" size="sm" variant="destructive" onClick={close}>
                放弃
              </Button>
              <div className="flex-1" />
              <div className="mr-2 flex items-center gap-1">
                <Checkbox checked={uploadTtml} onCheckedChange={(v) => setUploadTtml(v)} />
                <span className="text-xs text-ink-3">上传修订版</span>
              </div>
              {ACTION_BUTTONS.map(({ action: key, label, className, Icon }) => (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  className={action === key ? className : undefined}
                  variant={action === key ? 'default' : 'secondary'}
                  disabled={submitting}
                  onClick={() => {
                    setAction(key);
                    onSubmit({
                      reportMd: renderedReport,
                      action: key,
                      uploadTtml,
                    });
                  }}
                >
                  <Icon />
                  {label}
                </Button>
              ))}
            </div>
          </DialogFlexBody>
        </DialogContentBoundary>
      </DialogContent>
    </Dialog>
  );
};

export default ReviewReportDialog;
