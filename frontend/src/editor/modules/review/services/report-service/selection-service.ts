import { createReviewReport, normalizeReviewReport } from './normalize-service';
import type { ReviewReportBlock, ReviewReportInput, ReviewReportLineRef } from './types';

const reportLineRefKey = (ref: ReviewReportLineRef) =>
  `${ref.lineNumber}:${ref.isBG ? 'bg' : 'main'}`;

const reportLineRefsKey = (refs: ReviewReportLineRef[]) =>
  refs.map(reportLineRefKey).sort().join(',');

const reportLineKey = (lineNumber: number, isBG: boolean) =>
  `${lineNumber}:${isBG ? 'bg' : 'main'}`;

export const getWordTextGroupChangeKey = (
  block: Extract<ReviewReportBlock, { kind: 'wordTextGroup' }>,
  change: Extract<ReviewReportBlock, { kind: 'wordTextGroup' }>['changes'][number]
) =>
  change.wordId
    ? `wordText:${change.wordId}`
    : `wordText:${reportLineKey(block.lineNumber, block.isBG)}:${change.oldWord}->${change.newWord}`;

export const getReviewReportSelectionKey = (block: ReviewReportBlock) => {
  switch (block.kind) {
    case 'manual':
      return `manual:${block.id}`;
    case 'wordTextShared':
      return `${block.kind}:${block.oldWord}->${block.newWord}:${reportLineRefsKey(block.lineRefs)}`;
    case 'wordTextGroup':
      return `${block.kind}:${reportLineKey(block.lineNumber, block.isBG)}`;
    case 'wordText':
      return block.wordId
        ? `${block.kind}:${block.wordId}`
        : `${block.kind}:${reportLineKey(block.lineNumber, block.isBG)}:${block.oldWord}->${block.newWord}`;
    case 'wordRoman':
      return block.wordId
        ? `${block.kind}:${block.wordId}`
        : `${block.kind}:${reportLineKey(block.lineNumber, block.isBG)}`;
    case 'wordAndRoman':
      return block.wordId
        ? `${block.kind}:${block.wordId}`
        : `${block.kind}:${reportLineKey(block.lineNumber, block.isBG)}`;
    case 'wordAdded':
    case 'wordRemoved':
      return block.wordId
        ? `${block.kind}:${block.wordId}`
        : `${block.kind}:${reportLineKey(block.lineNumber, block.isBG)}:${block.word}`;
    case 'lineTranslation':
    case 'lineRoman':
      return `${block.kind}:${reportLineKey(block.lineNumber, block.isBG)}`;
    case 'lineAdded':
    case 'lineRemoved':
      return `${block.kind}:${reportLineKey(block.lineNumber, block.isBG)}:${block.text}`;
    case 'timeShift':
      return `${block.kind}:${block.operationId}`;
    case 'timing':
      return block.operationId
        ? `${block.kind}:${block.operationId}:${block.wordId}`
        : `${block.kind}:${block.wordId}`;
    case 'lineTiming':
      return block.operationId
        ? `${block.kind}:${block.operationId}:${block.lineId}`
        : `${block.kind}:${block.lineId}`;
  }
};

export const getReviewReportSelectionKeys = (block: ReviewReportBlock) => {
  const keys = [getReviewReportSelectionKey(block)];
  switch (block.kind) {
    case 'wordText':
    case 'wordRoman':
    case 'wordAndRoman':
      if (block.wordId) keys.push(`wordEdit:${block.wordId}`);
      break;
    case 'timing':
      keys.push(`timing:${block.wordId}`);
      break;
    case 'lineTiming':
      keys.push(`lineTiming:${block.lineId}`);
      break;
  }
  return keys;
};

type ReviewReportSelectionState = {
  blocks: Map<string, boolean>;
  groupChanges: Map<string, boolean>;
};

const getSelectionStateValue = (state: ReviewReportSelectionState, keys: string[]) => {
  for (const key of keys) {
    const value = state.blocks.get(key);
    if (value !== undefined) return value;
  }
  return undefined;
};

const collectReviewReportSelectionState = (
  reports: ReviewReportInput[]
): ReviewReportSelectionState => {
  const state: ReviewReportSelectionState = {
    blocks: new Map(),
    groupChanges: new Map(),
  };
  reports.forEach((report) => {
    normalizeReviewReport(report).blocks.forEach((block) => {
      getReviewReportSelectionKeys(block).forEach((key) => {
        state.blocks.set(key, block.enabled);
      });
      if (block.kind !== 'wordTextGroup') return;
      block.changes.forEach((change) => {
        const key = getWordTextGroupChangeKey(block, change);
        const enabled = block.enabled && change.enabled !== false;
        state.blocks.set(key, enabled);
        state.groupChanges.set(key, enabled);
      });
    });
  });
  return state;
};

export const applyReviewReportSelectionState = (
  report: ReviewReportInput,
  baseReports: ReviewReportInput[]
) => {
  const selectionState = collectReviewReportSelectionState(baseReports);
  return createReviewReport(
    normalizeReviewReport(report).blocks.map((block) => {
      if (block.kind === 'wordTextGroup') {
        const groupEnabled = getSelectionStateValue(
          selectionState,
          getReviewReportSelectionKeys(block)
        );
        const changes = block.changes.map((change) => {
          const key = getWordTextGroupChangeKey(block, change);
          const enabled = selectionState.groupChanges.get(key) ?? selectionState.blocks.get(key);
          return enabled === undefined ? change : { ...change, enabled };
        });
        const hasChangeState = changes.some((change, index) => {
          const original = block.changes[index];
          return original && change.enabled !== original.enabled;
        });
        if (hasChangeState) {
          return {
            ...block,
            enabled: changes.some((change) => change.enabled !== false),
            changes,
          };
        }
        if (groupEnabled !== undefined) {
          return {
            ...block,
            enabled: groupEnabled,
            changes: changes.map((change) => ({
              ...change,
              enabled: groupEnabled,
            })),
          };
        }
        return block;
      }
      const enabled = getSelectionStateValue(selectionState, getReviewReportSelectionKeys(block));
      return enabled === undefined ? block : { ...block, enabled };
    })
  );
};
