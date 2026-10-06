import {
  Box,
  Button,
  Checkbox,
  Dialog,
  Flex,
  ScrollArea,
  Switch,
  Tabs,
  Text,
  TextArea,
} from '@radix-ui/themes';
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
import {
  Delete16Regular,
  Checkmark16Regular,
  Edit16Regular,
  MusicNote216Regular,
} from '@fluentui/react-icons';
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
        <Box style={{ padding: 12 }}>
          <Text size="2" weight="bold" color="red" as="p">
            审阅结果面板加载失败
          </Text>
          <Text size="1" color="gray" as="p" mt="2">
            {this.state.error.message}
          </Text>
          <Text size="1" color="gray" as="p" mt="2">
            详细堆栈见浏览器控制台。可以先关闭本窗口继续编辑，改用「编辑」 面板里的保存按钮提交。
          </Text>
        </Box>
      );
    }
    return this.props.children;
  }
}

function DialogFlexBody({ children }: { children: ReactNode }) {
  return (
    <Flex direction="column" style={{ flex: '1 1 auto', minHeight: 0 }}>
      {children}
    </Flex>
  );
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
    default:
      return '未知条目';
  }
}

function getReportBlockScopeLabel(block: ReviewReportBlock): string | null {
  if (block.kind === 'manual') return null;
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
  if (block.kind === 'manual') return null;
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
    <Box
      style={{
        border: '1px solid var(--amll-border)',
        background: 'var(--amll-muted)',
        borderRadius: 6,
        padding: 8,
        opacity: block.enabled ? 1 : 0.5,
      }}
    >
      <Flex align="center" justify="between" gap="2" mb="2">
        <Flex align="center" gap="2">
          <Checkbox
            checked={block.enabled}
            onCheckedChange={(v) => onToggle(block.id, v === true)}
          />
          <Text size="2" weight="medium">
            手写内容
          </Text>
        </Flex>
        <Flex align="center" gap="2">
          <Flex align="center" gap="1" title="在 Markdown 预览中另起一行">
            <Switch
              size="1"
              checked={block.lineBreakBefore === true}
              onCheckedChange={(v) => onLineBreakChange(block.id, v)}
              aria-label="换行"
            />
            <Text size="1" color="gray">
              换行
            </Text>
          </Flex>
          <Button
            size="1"
            variant="soft"
            disabled={!canMove(block.id, -1)}
            onClick={() => onMove(block.id, -1)}
            title="将手写条目上移"
          >
            上移
          </Button>
          <Button
            size="1"
            variant="soft"
            disabled={!canMove(block.id, 1)}
            onClick={() => onMove(block.id, 1)}
            title="将手写条目下移"
          >
            下移
          </Button>
          <Button
            size="1"
            variant="ghost"
            color="red"
            onClick={() => onDelete(block.id)}
            title="删除条目"
          >
            <Delete16Regular />
          </Button>
        </Flex>
      </Flex>
      {focused ? (
        <TextArea
          ref={textAreaRef}
          value={block.content}
          onChange={(e) => onChange(block.id, e.currentTarget.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="手写报告内容"
          style={{ minHeight: 96 }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setFocused(true);
            window.requestAnimationFrame(() => textAreaRef.current?.focus());
          }}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: 8,
            minHeight: 40,
            borderRadius: 4,
            border: '1px dashed var(--amll-border)',
            background: 'transparent',
            color: block.content.trim() ? 'inherit' : 'var(--amll-muted-foreground)',
            cursor: 'text',
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          {block.content.trim() || '点击展开并编辑手写内容'}
        </button>
      )}
    </Box>
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
    <Flex
      align="center"
      justify="between"
      gap="1"
      style={{
        border: '1px solid var(--amll-border)',
        background: 'var(--amll-muted)',
        borderRadius: 4,
        padding: '4px 6px',
        opacity: block.enabled ? 1 : 0.5,
        minWidth: 0,
      }}
    >
      <Flex align="center" gap="1" style={{ flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
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
                style={{
                  border: '1px solid var(--amll-border)',
                  borderRadius: 3,
                  padding: '1px 5px',
                  fontSize: 12,
                  cursor: 'pointer',
                  background: enabled ? 'var(--amll-primary-soft)' : 'transparent',
                  color: enabled ? 'var(--amll-primary)' : 'var(--amll-muted-foreground)',
                  textDecoration: enabled ? 'none' : 'line-through',
                }}
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
            style={{
              border: '1px solid var(--amll-border)',
              borderRadius: 3,
              padding: '1px 5px',
              fontSize: 12,
              cursor: 'pointer',
              background: block.enabled ? 'var(--amll-primary-soft)' : 'transparent',
              color: block.enabled ? 'var(--amll-primary)' : 'var(--amll-muted-foreground)',
              textDecoration: block.enabled ? 'none' : 'line-through',
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {blockSummary(block)}
          </button>
        )}
      </Flex>
      <Button
        size="1"
        variant="ghost"
        color="red"
        onClick={() => onDelete(block.id)}
        title="删除条目"
        style={{ flexShrink: 0 }}
      >
        <Delete16Regular />
      </Button>
      {title ? <span style={{ display: 'none' }}>{title}</span> : null}
    </Flex>
  );
}

const ACTION_BUTTONS = [
  { action: 'approve', label: '接受', color: 'green', Icon: Checkmark16Regular },
  { action: 'revision', label: '需要修改', color: 'red', Icon: Edit16Regular },
  { action: 'missing_audio', label: '缺少音源', color: 'orange', Icon: MusicNote216Regular },
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
      [next[index], next[target]] = [next[target], next[index]];
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
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Content
        style={{
          maxWidth: '1100px',
          width: '92vw',
          zIndex: 400,
          position: 'relative',
          height: '88vh',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          backgroundColor: 'var(--amll-card)',
          color: 'var(--amll-foreground)',
          border: '1px solid var(--amll-border)',
          boxShadow: 'var(--shadow-6)',
          ...BRAND_ACCENT,
        }}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogContentBoundary>
          <DialogFlexBody>
            <Dialog.Title style={{ fontWeight: 600, flexShrink: 0 }}>
              对稿件【{dialog.title}】做出的审阅结果如下：
            </Dialog.Title>
            <Box style={{ flexShrink: 0 }}>
              <ReviewTemplateSection open={dialog.open} onInsertTemplate={insertTemplate} />
            </Box>

            <Tabs.Root
              value={activeTab}
              onValueChange={setActiveTab}
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: '1 1 auto',
                minHeight: 0,
              }}
            >
              <Tabs.List style={{ flexShrink: 0 }}>
                <Tabs.Trigger value="blocks">条目</Tabs.Trigger>
                <Tabs.Trigger value="format">格式</Tabs.Trigger>
                <Tabs.Trigger value="text">文本</Tabs.Trigger>
                <Tabs.Trigger value="preview">预览</Tabs.Trigger>
              </Tabs.List>

              {/* 条目 */}
              <Tabs.Content
                value="blocks"
                style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}
              >
                <Text size="1" color="gray" as="p" mb="2" style={{ flexShrink: 0 }}>
                  结构化条目按系统顺序排列；手写条目可通过上移/下移插入序列。
                </Text>
                <ScrollArea
                  type="auto"
                  style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}
                >
                  {blockGroups.length === 0 ? (
                    <Flex align="center" justify="center" style={{ height: 200 }}>
                      <Text color="gray" size="2">
                        暂无报告条目
                      </Text>
                    </Flex>
                  ) : (
                    <Flex direction="column" gap="3">
                      {blockGroups.map((group) => (
                        <Box key={group.key} style={{ minWidth: 0 }}>
                          {group.scopeLabel && (
                            <Text size="1" color="gray" as="p" mb="1" style={{ fontWeight: 600 }}>
                              {group.scopeLabel}
                            </Text>
                          )}
                          <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
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
                          </Flex>
                        </Box>
                      ))}
                    </Flex>
                  )}
                </ScrollArea>
                <Flex
                  justify="end"
                  mt="2"
                  style={{
                    flexShrink: 0,
                    position: 'sticky',
                    bottom: 0,
                    background: 'var(--amll-card)',
                  }}
                >
                  <Button size="1" variant="soft" onClick={addManual}>
                    新增手写条目
                  </Button>
                </Flex>
              </Tabs.Content>

              {/* 格式 */}
              <Tabs.Content
                value="format"
                style={{
                  flex: '1 1 auto',
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  padding: 8,
                }}
              >
                <ReportFormatEditor
                  value={reportFormat}
                  onChange={setReportFormat}
                  report={draft}
                />
              </Tabs.Content>

              {/* 文本 */}
              <Tabs.Content value="text" style={{ flex: '1 1 auto', minHeight: 0 }}>
                <ScrollArea
                  type="auto"
                  style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}
                >
                  <Box style={{ padding: 8 }}>
                    <TextArea
                      value={renderedReport}
                      readOnly
                      aria-label="自动生成的审阅报告文本"
                      style={{ minHeight: 400, fontFamily: 'monospace' }}
                    />
                  </Box>
                </ScrollArea>
              </Tabs.Content>

              {/* 预览 */}
              <Tabs.Content value="preview" style={{ flex: '1 1 auto', minHeight: 0 }}>
                <ScrollArea
                  type="auto"
                  style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}
                >
                  <Box style={{ padding: 8 }}>
                    {renderedReport ? (
                      <div
                        className="comment-markdown"
                        dangerouslySetInnerHTML={{ __html: renderedReportHtml }}
                      />
                    ) : (
                      <Text size="2" color="gray">
                        （报告为空）
                      </Text>
                    )}
                  </Box>
                </ScrollArea>
              </Tabs.Content>
            </Tabs.Root>

            {/* 底部操作栏 */}
            <Flex align="center" gap="2" mt="3" wrap="wrap" style={{ flexShrink: 0 }}>
              <Button size="1" variant="soft" color="red" onClick={close}>
                放弃
              </Button>
              <Box flexGrow="1" />
              <Flex align="center" gap="1" mr="2">
                <Checkbox checked={uploadTtml} onCheckedChange={(v) => setUploadTtml(Boolean(v))} />
                <Text size="1" color="gray">
                  上传修订版
                </Text>
              </Flex>
              {ACTION_BUTTONS.map(({ action: key, label, color, Icon }) => (
                <Button
                  key={key}
                  size="1"
                  color={color}
                  variant={action === key ? 'solid' : 'soft'}
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
            </Flex>
          </DialogFlexBody>
        </DialogContentBoundary>
      </Dialog.Content>
    </Dialog.Root>
  );
};

export default ReviewReportDialog;
