import { useAtomValue, useSetAtom } from 'jotai';
import { memo, useCallback, useMemo, useState } from 'react';
import { formatDateTime } from '@/lib/format';
import {
  lyricLinesAtom,
  selectedLinesAtom,
  selectedWordsAtom,
  ToolMode,
  toolModeAtom,
} from '$/states/main.ts';
import { outlineJumpActionAtom } from '$/states/sidebar.ts';
import { metadataEditorDialogAtom, metadataEditorFocusKeyAtom } from '$/states/dialogs.ts';
import { audioEngine } from '$/modules/audio/audio-engine';
import { reviewRequirementAtom } from '$/modules/review/states';
import {
  findLineIndex,
  findNearestLineIndex,
  getRequirementStatus,
  parseRequirement,
  type RequirementItem,
} from '$/modules/review/requirements';
import type { LyricWord } from '$/types/ttml';
import styles from './ReviewRequirementsPanel.module.css';

const ACTION_LABELS: Record<string, string> = {
  need_revision: '需修改',
  revised: '待确认修订版',
  missing_audio: '缺音频',
  rejected: '未通过',
  approved: '已通过',
  approve: '已通过',
  reject: '未通过',
  pending: '待审核',
  reviewing: '审核中',
};

const STATUS_LABELS = {
  done: '已修改',
  pending: '未修改',
  incorrect: '未正确修改',
  unknown: '需人工确认',
} as const;

export const ReviewRequirementsPanel = memo(() => {
  const lyricData = useAtomValue(lyricLinesAtom);
  const requirement = useAtomValue(reviewRequirementAtom);
  const setSelectedLines = useSetAtom(selectedLinesAtom);
  const setSelectedWords = useSetAtom(selectedWordsAtom);
  const setToolMode = useSetAtom(toolModeAtom);
  const setJumpAction = useSetAtom(outlineJumpActionAtom);
  const setMetadataDialog = useSetAtom(metadataEditorDialogAtom);
  const setMetadataFocusKey = useSetAtom(metadataEditorFocusKeyAtom);
  /** 只高亮用户最后点击的那一条，而不是同一行的所有要求 */
  const [activeItemKey, setActiveItemKey] = useState<string | null>(null);

  const { lyricLines } = lyricData;

  const resolveLine = useCallback(
    (lineNumber: number, isBG?: boolean) => {
      const exact = findLineIndex(lyricLines, lineNumber, isBG);
      if (exact >= 0) {
        return { id: lyricLines[exact]!.id, index: exact, approximate: false };
      }
      const nearest = findNearestLineIndex(lyricLines, lineNumber);
      return nearest >= 0
        ? { id: lyricLines[nearest]!.id, index: nearest, approximate: true }
        : null;
    },
    [lyricLines]
  );

  const parsed = useMemo(
    () => (requirement ? parseRequirement(requirement) : { overall: [], lines: [] }),
    [requirement]
  );

  const sortedLines = useMemo(
    () =>
      [...parsed.lines].sort(
        (a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0) || Number(a.isBG) - Number(b.isBG)
      ),
    [parsed.lines]
  );

  const handleItemClick = useCallback(
    (item: RequirementItem) => {
      setActiveItemKey(item.key);
      if (item.kind === 'metadata') {
        setMetadataFocusKey(item.metadataKey ?? null);
        setMetadataDialog(true);
        return;
      }
      if (item.lineNumber == null) return;

      const target = resolveLine(item.lineNumber, item.isBG);
      if (!target) return;

      const line = lyricLines[target.index];
      let word: LyricWord | undefined;
      if (line) {
        if (item.wordIndex != null && item.wordIndex >= 0) {
          word = line.words[item.wordIndex];
        }
        if (!word && item.wordId) {
          word = line.words.find((candidate) => candidate.id === item.wordId);
        }
      }

      setSelectedLines(new Set([target.id]));
      setSelectedWords(word ? new Set([word.id]) : new Set());
      setToolMode(item.kind === 'timing' ? ToolMode.Sync : ToolMode.Edit);
      setJumpAction({ id: target.id, ts: Date.now() });

      // 时轴问题直接跳到该词的时间点，方便马上重打轴
      if (item.kind === 'timing' && word && Number.isFinite(word.startTime)) {
        if (audioEngine.musicLoaded) {
          audioEngine.seekMusic(word.startTime / 1000);
        }
      }
    },
    [
      lyricLines,
      resolveLine,
      setJumpAction,
      setMetadataDialog,
      setMetadataFocusKey,
      setSelectedLines,
      setSelectedWords,
      setToolMode,
    ]
  );

  const renderItemBody = (item: RequirementItem) => {
    const status = getRequirementStatus(item, lyricData);
    return (
      <div className={styles.itemBody}>
        <div className={styles.text}>{item.text}</div>
        <div className={styles.statusRow}>
          <span className={styles.statusBadge} data-status={status}>
            {STATUS_LABELS[status]}
          </span>
        </div>
      </div>
    );
  };

  if (!requirement) {
    return <div className={styles.empty}>暂无审核要求</div>;
  }

  const reviewerName = requirement.reviewerInfo?.displayName || requirement.reviewer || '审核员';
  const actionLabel = requirement.action ? ACTION_LABELS[requirement.action] : '';
  const isEmpty = parsed.overall.length === 0 && sortedLines.length === 0;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <span className={styles.badge}>
            {requirement.source === 'report' ? '审核报告' : '文字意见'}
          </span>
          {actionLabel && <span className={styles.action}>{actionLabel}</span>}
        </div>
        <div className={styles.reviewer}>由{reviewerName}进行审核</div>
        <div className={styles.time}>{formatDateTime(requirement.createdAt)}</div>
      </div>

      {isEmpty && <div className={styles.empty}>本次审核没有留下可展示的要求</div>}

      {parsed.overall.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>整体要求</div>
          {parsed.overall.map((item) =>
            item.kind === 'metadata' ? (
              <button
                key={item.key}
                type="button"
                className={styles.item}
                data-clickable="true"
                data-selected={activeItemKey === item.key}
                onClick={() => handleItemClick(item)}
                title="打开元数据面板"
              >
                <div className={styles.overallDot}>
                  <span />
                </div>
                {renderItemBody(item)}
              </button>
            ) : (
              <div key={item.key} className={styles.item} data-clickable="false">
                <div className={styles.overallDot}>
                  <span />
                </div>
                {renderItemBody(item)}
              </div>
            )
          )}
        </div>
      )}

      {sortedLines.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>按行要求（{sortedLines.length}）</div>
          {sortedLines.map((item) => {
            const selected = activeItemKey === item.key;
            const target = resolveLine(item.lineNumber ?? 0, item.isBG);
            const approximate = target?.approximate ?? false;
            const hasWord = item.wordIndex != null || item.wordId != null;
            const hint = approximate
              ? '行号已变化，跳转到最接近的一行，请人工确认'
              : item.kind === 'timing'
                ? hasWord
                  ? '跳到打轴并定位到该词'
                  : '跳到打轴并定位到该行'
                : hasWord
                  ? '跳到编辑并定位到该词'
                  : '跳到编辑并定位到该行';
            return (
              <button
                key={item.key}
                type="button"
                className={styles.item}
                data-selected={selected}
                onClick={() => handleItemClick(item)}
                title={hint}
              >
                <div className={styles.lineNumber}>
                  {item.lineNumber}
                  {approximate && (
                    <span className={styles.approxMark} title="行号已变化">
                      ≈
                    </span>
                  )}
                  {item.isBG && <span className={styles.bgMark}>背</span>}
                </div>
                {renderItemBody(item)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default ReviewRequirementsPanel;
