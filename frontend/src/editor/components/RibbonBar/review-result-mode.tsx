import { Button, Checkbox, Flex, ScrollArea, Text, TextArea } from '@radix-ui/themes';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useMemo } from 'react';
import { Delete16Regular } from '@fluentui/react-icons';
import {
  effectiveReviewReportAtom,
  editedReviewReportAtom,
  reviewActionAtom,
  reviewManualNoteAtom,
  reviewSaveDialogOpenAtom,
  reviewUploadTtmlAtom,
} from '$/modules/review/states';
import {
  createReviewReport,
  normalizeReviewReport,
} from '$/modules/review/services/report-service/normalize-service';
import { applyReviewReportSelectionState } from '$/modules/review/services/report-service/selection-service';
import type { ReviewReportBlock } from '$/modules/review/services/report-service/types';
import { RibbonFrame, RibbonSection } from './common';

const ACTION_LABELS: Record<string, string> = {
  approve: '通过',
  revision: '需修改',
  reject: '拒绝',
  missing_audio: '缺音频',
};

function blockSummary(block: ReviewReportBlock): string {
  switch (block.kind) {
    case 'manual':
      return block.content.slice(0, 40) || '（空手写条目）';
    case 'wordTextShared':
      return `${block.newWord}`;
    case 'wordText':
      return `第 ${block.lineNumber} 行 · ${block.oldWord} → ${block.newWord}`;
    case 'wordTextGroup':
      return `第 ${block.lineNumber} 行 · ${block.changes.length} 处文字改动`;
    case 'wordRoman':
      return `第 ${block.lineNumber} 行音译 · ${block.oldRoman} → ${block.newRoman}`;
    case 'lineTranslation':
      return `第 ${block.lineNumber} 行翻译`;
    case 'lineRoman':
      return `第 ${block.lineNumber} 行音译`;
    case 'wordAndRoman':
      return `第 ${block.lineNumber} 行 · 原文+音译`;
    case 'wordAdded':
      return `第 ${block.lineNumber} 行新增「${block.word}」`;
    case 'wordRemoved':
      return `第 ${block.lineNumber} 行删除「${block.word}」`;
    case 'lineAdded':
      return `新增歌词「${block.text.slice(0, 20)}」`;
    case 'lineRemoved':
      return `删除歌词「${block.text.slice(0, 20)}」`;
    case 'timeShift':
      return `时轴平移 ${block.offsetMs > 0 ? '+' : ''}${block.offsetMs}ms · ${block.targetCount}/${block.totalLineCount} 行`;
    case 'timing':
      return `第 ${block.lineNumber} 行 · ${block.word} 打轴调整`;
    case 'lineTiming':
      return `第 ${block.lineNumber} 行时轴调整`;
    default:
      return '未知条目';
  }
}

export const ReviewResultRibbonBar = () => {
  const report = useAtomValue(effectiveReviewReportAtom);
  const setEdited = useSetAtom(editedReviewReportAtom);
  const [manualNote, setManualNote] = useAtom(reviewManualNoteAtom);
  const [uploadTtml, setUploadTtml] = useAtom(reviewUploadTtmlAtom);
  const [action, setAction] = useAtom(reviewActionAtom);
  const setDialogOpen = useSetAtom(reviewSaveDialogOpenAtom);

  const blocks = useMemo(() => {
    if (!report) return [];
    return normalizeReviewReport(report).blocks;
  }, [report]);

  const toggleBlock = (id: string, enabled: boolean) => {
    if (!report) return;
    const current = normalizeReviewReport(report);
    const base = createReviewReport(
      current.blocks.map((b) => (b.id === id ? { ...b, enabled } : b))
    );
    setEdited(applyReviewReportSelectionState(report, [base]));
  };

  const removeManualBlock = (id: string) => {
    if (!report) return;
    const normalized = normalizeReviewReport(report);
    setEdited(createReviewReport(normalized.blocks.filter((b) => b.id !== id)));
  };

  const blockCount = blocks.length;
  const enabledCount = blocks.filter((b) => b.enabled).length;

  return (
    <RibbonFrame>
      {/* 改动条目：逐条勾选是否写进报告 */}
      <RibbonSection label={`改动 ${enabledCount}/${blockCount}`}>
        <ScrollArea scrollbars="vertical" style={{ height: '86px', width: '260px' }}>
          {blockCount === 0 ? (
            <Text size="1" color="gray">
              尚无改动
            </Text>
          ) : (
            <Flex direction="column" gap="1" pr="2">
              {blocks.map((block) => (
                <Flex key={block.id} align="center" gap="2" style={{ minWidth: 0 }}>
                  <Checkbox
                    size="1"
                    checked={block.enabled}
                    onCheckedChange={(v) => toggleBlock(block.id, Boolean(v))}
                  />
                  <Text
                    size="1"
                    color={block.enabled ? undefined : 'gray'}
                    style={{
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={blockSummary(block)}
                  >
                    {blockSummary(block)}
                  </Text>
                  {block.kind === 'manual' && (
                    <Button
                      size="1"
                      variant="ghost"
                      color="red"
                      onClick={() => removeManualBlock(block.id)}
                      title="删除这条手写意见"
                    >
                      <Delete16Regular />
                    </Button>
                  )}
                </Flex>
              ))}
            </Flex>
          )}
        </ScrollArea>
      </RibbonSection>

      {/* 审核结论 */}
      <RibbonSection label="审核结论">
        <Flex direction="column" gap="1" align="start">
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <Flex key={value} align="center" gap="2">
              <input
                type="radio"
                name="review-action"
                checked={action === value}
                onChange={() => setAction(value as typeof action)}
                style={{ accentColor: 'var(--accent-9)' }}
              />
              <Text size="1">{label}</Text>
            </Flex>
          ))}
          <Flex align="center" gap="2" mt="1">
            <Checkbox
              size="1"
              checked={uploadTtml}
              onCheckedChange={(v) => setUploadTtml(Boolean(v))}
            />
            <Text size="1" color="gray">
              上传修订版
            </Text>
          </Flex>
        </Flex>
      </RibbonSection>

      {/* 补充说明 */}
      <RibbonSection label="补充说明">
        <TextArea
          size="1"
          value={manualNote}
          onChange={(e) => setManualNote(e.target.value)}
          placeholder="附在报告末尾…"
          style={{ height: '86px', width: '220px', resize: 'none' }}
        />
      </RibbonSection>

      <RibbonSection label=" ">
        <Button size="2" onClick={() => setDialogOpen(true)}>
          查看并提交
        </Button>
      </RibbonSection>
    </RibbonFrame>
  );
};

export default ReviewResultRibbonBar;
