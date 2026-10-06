import type { TTMLLyric } from '$/types/ttml';
import type { ReviewLineTimingOperation, ReviewOperationRecord } from '../operation-log-service';
import { replayReviewOperations } from '../operation-log-service';
import { buildReviewReportFromDiffs } from './edit-report-builder';
import { computeDisplayNumbers, getDisplayNumber } from './lyric-utils';
import { mergeReports } from './merge-service';
import { createReviewReport } from './normalize-service';
import { applyReviewReportSelectionState } from './selection-service';
import type { ReviewReportBlock, ReviewReportInput, ReviewReportLineRef } from './types';

type TimeShiftReportScope = {
  id: string;
  offsetMs: number;
  targetLineIds: string[];
  operations: ReviewOperationRecord[];
};

const buildLineTimeDeltaMap = (before: TTMLLyric, after: TTMLLyric) => {
  const afterLineMap = new Map(after.lyricLines.map((line) => [line.id, line]));
  const deltaMap = new Map<string, number>();
  before.lyricLines.forEach((line) => {
    const afterLine = afterLineMap.get(line.id);
    if (!afterLine) return;
    const startDelta = Math.round(afterLine.startTime - line.startTime);
    const endDelta = Math.round(afterLine.endTime - line.endTime);
    // 平移报告以行起始时间为代表；起始时间已触底不动时，用结束时间兜底保留实际变化。
    deltaMap.set(line.id, startDelta !== 0 ? startDelta : endDelta);
  });
  return deltaMap;
};

const buildTimeShiftReportScopes = (
  operations: ReviewOperationRecord[],
  freeze: TTMLLyric
): TimeShiftReportScope[] => {
  // 平移报告按“用户当次选择的作用域”合并，而不是按每一行的最终净位移重分组。
  // 这样全局平移后再局部微调时，全局记录仍保持为“全部歌词行”，不会被拆成大量散落行。
  // 报告里的 offset 使用同一作用域操作 replay 后的实际差值，避免负向平移触底 0ms 时误报原始操作量。
  const lineOrder = new Map<string, number>();
  freeze.lyricLines.forEach((line, index) => {
    lineOrder.set(line.id, index);
  });
  const scopeByKey = new Map<string, TimeShiftReportScope>();

  operations.forEach((operation) => {
    if (operation.kind !== 'timeShift' || operation.offsetMs === 0) return;

    const targetLineIds = Array.from(new Set(operation.targetLineIds))
      .filter((lineId) => lineOrder.has(lineId))
      .sort((a, b) => (lineOrder.get(a) ?? 0) - (lineOrder.get(b) ?? 0));
    if (targetLineIds.length === 0) return;

    // 全局作用域使用固定 key，避免行 id 串变化影响合并语义；局部作用域则用排序后的行集合精确匹配。
    const key = targetLineIds.length === freeze.lyricLines.length ? 'all' : targetLineIds.join(',');
    const scope = scopeByKey.get(key) ?? {
      id: `merged:${key}`,
      offsetMs: 0,
      targetLineIds,
      operations: [],
    };
    scope.operations.push(operation);
    scopeByKey.set(key, scope);
  });

  return Array.from(scopeByKey.values()).flatMap((scope) => {
    const replayedScope = replayReviewOperations(freeze, scope.operations);
    const deltaByLineId = buildLineTimeDeltaMap(freeze, replayedScope);
    const splitByActualDelta = new Map<number, string[]>();
    scope.targetLineIds.forEach((lineId) => {
      const delta = deltaByLineId.get(lineId) ?? 0;
      if (delta === 0) return;
      const lineIds = splitByActualDelta.get(delta) ?? [];
      lineIds.push(lineId);
      splitByActualDelta.set(delta, lineIds);
    });
    return Array.from(splitByActualDelta.entries()).map(([offsetMs, targetLineIds]) => ({
      id: `${scope.id}:${offsetMs}:${targetLineIds.join(',')}`,
      offsetMs,
      targetLineIds,
      operations: scope.operations,
    }));
  });
};

const buildTimeShiftReportBlock = (
  scope: TimeShiftReportScope,
  freeze: TTMLLyric
): Extract<ReviewReportBlock, { kind: 'timeShift' }> | null => {
  const displayNumbers = computeDisplayNumbers(freeze.lyricLines);
  const targetIds = new Set(scope.targetLineIds);
  const lineRefs: ReviewReportLineRef[] = freeze.lyricLines
    .filter((line) => targetIds.has(line.id))
    .map((line, index) => ({
      lineNumber: getDisplayNumber(line, index, displayNumbers),
      isBG: line.isBG ?? false,
    }));

  if (scope.offsetMs === 0 || lineRefs.length === 0) return null;

  return {
    id: `time-shift-${scope.id}`,
    kind: 'timeShift',
    enabled: true,
    operationId: scope.id,
    offsetMs: scope.offsetMs,
    lineRefs,
    targetCount: lineRefs.length,
    totalLineCount: freeze.lyricLines.length,
  };
};

const getLineTextSignature = (line: TTMLLyric['lyricLines'][number]) =>
  line.words.map((word) => word.word ?? '').join('\u0000');

const getLineTimingSnapshotTextSignature = (snapshot: ReviewLineTimingOperation['before']) =>
  snapshot.segments
    .filter((segment) => !segment.isRuby)
    .map((segment) => segment.word ?? '')
    .join('\u0000');

const findLineTimingOperationLineIndex = (
  operation: ReviewLineTimingOperation,
  freeze: TTMLLyric
) => {
  const candidateIndexes = freeze.lyricLines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.id === operation.lineId);
  const candidates =
    candidateIndexes.length > 0
      ? candidateIndexes
      : freeze.lyricLines.map((line, index) => ({ line, index }));
  const snapshotText = getLineTimingSnapshotTextSignature(operation.before);
  const timingMatches = candidates.filter(
    ({ line }) =>
      Math.round(line.startTime) === Math.round(operation.before.startTime) &&
      Math.round(line.endTime) === Math.round(operation.before.endTime)
  );
  const timingAndTextMatch = timingMatches.find(
    ({ line }) => getLineTextSignature(line) === snapshotText
  );
  if (timingAndTextMatch) return timingAndTextMatch.index;
  if (timingMatches[0]) return timingMatches[0].index;
  const textMatch = candidates.find(({ line }) => getLineTextSignature(line) === snapshotText);
  return textMatch?.index ?? candidateIndexes[0]?.index ?? -1;
};

const buildLineTimingOperationReportBlocks = (
  operation: ReviewLineTimingOperation,
  freeze: TTMLLyric
): ReviewReportBlock[] => {
  const displayNumbers = computeDisplayNumbers(freeze.lyricLines);
  const fallbackLineIndex = findLineTimingOperationLineIndex(operation, freeze);
  const freezeLine = fallbackLineIndex >= 0 ? freeze.lyricLines[fallbackLineIndex] : undefined;
  const lineNumber = freezeLine
    ? getDisplayNumber(freezeLine, fallbackLineIndex, displayNumbers)
    : 1;
  const isBG = freezeLine?.isBG ?? operation.before.isBG ?? false;
  const blocks: ReviewReportBlock[] = [];

  const beforeSegments = new Map(operation.before.segments.map((segment) => [segment.id, segment]));
  const afterSegments = new Map(operation.after.segments.map((segment) => [segment.id, segment]));
  const beforeSegmentOrder = new Map(
    operation.before.segments.map((segment, index) => [segment.id, index])
  );

  [...operation.reportItems]
    .sort(
      (a, b) =>
        (beforeSegmentOrder.get(a.wordId) ?? Number.MAX_SAFE_INTEGER) -
        (beforeSegmentOrder.get(b.wordId) ?? Number.MAX_SAFE_INTEGER)
    )
    .forEach((item) => {
      const beforeSegment = beforeSegments.get(item.wordId);
      const afterSegment = afterSegments.get(item.wordId);
      if (!beforeSegment || !afterSegment) return;

      const fields = item.fields.filter((field) => {
        if (field === 'startTime') {
          return Math.round(beforeSegment.startTime) !== Math.round(afterSegment.startTime);
        }
        return Math.round(beforeSegment.endTime) !== Math.round(afterSegment.endTime);
      });
      if (fields.length === 0) return;

      blocks.push({
        id: `timing-${operation.id}-${item.wordId}`,
        kind: 'timing',
        enabled: true,
        operationId: operation.id,
        wordId: item.wordId,
        lineNumber,
        wordIndex: beforeSegmentOrder.get(item.wordId),
        isBG,
        word: beforeSegment.word || '（空白）',
        oldStart: Math.round(beforeSegment.startTime),
        newStart: Math.round(afterSegment.startTime),
        oldEnd: Math.round(beforeSegment.endTime),
        newEnd: Math.round(afterSegment.endTime),
        fields,
      });
    });

  if (
    Math.round(operation.before.startTime) !== Math.round(operation.after.startTime) ||
    Math.round(operation.before.endTime) !== Math.round(operation.after.endTime)
  ) {
    blocks.push({
      id: `line-timing-${operation.id}`,
      kind: 'lineTiming',
      enabled: true,
      operationId: operation.id,
      lineId: operation.lineId,
      lineNumber,
      isBG,
      oldStart: Math.round(operation.before.startTime),
      newStart: Math.round(operation.after.startTime),
      oldEnd: Math.round(operation.before.endTime),
      newEnd: Math.round(operation.after.endTime),
    });
  }

  return blocks;
};

const sortOperationWordTimingSlots = (blocks: ReviewReportBlock[]) => {
  const timingBlocksByLine = new Map<string, Extract<ReviewReportBlock, { kind: 'timing' }>[]>();
  blocks.forEach((block) => {
    if (block.kind !== 'timing') return;
    const key = `${block.lineNumber}:${block.isBG ? 'bg' : 'main'}`;
    const lineBlocks = timingBlocksByLine.get(key) ?? [];
    lineBlocks.push(block);
    timingBlocksByLine.set(key, lineBlocks);
  });
  timingBlocksByLine.forEach((lineBlocks, key) => {
    timingBlocksByLine.set(
      key,
      [...lineBlocks].sort((a, b) => {
        const aWordIndex = a.wordIndex ?? Number.MAX_SAFE_INTEGER;
        const bWordIndex = b.wordIndex ?? Number.MAX_SAFE_INTEGER;
        return aWordIndex - bWordIndex;
      })
    );
  });

  const nextIndexByLine = new Map<string, number>();
  return blocks.map((block) => {
    if (block.kind !== 'timing') return block;
    const key = `${block.lineNumber}:${block.isBG ? 'bg' : 'main'}`;
    const nextIndex = nextIndexByLine.get(key) ?? 0;
    nextIndexByLine.set(key, nextIndex + 1);
    return timingBlocksByLine.get(key)?.[nextIndex] ?? block;
  });
};

const buildOperationReport = (freeze: TTMLLyric, operations: ReviewOperationRecord[]) =>
  createReviewReport([
    ...buildTimeShiftReportScopes(operations, freeze)
      .map<ReviewReportBlock | null>((scope) => buildTimeShiftReportBlock(scope, freeze))
      .filter((block): block is ReviewReportBlock => Boolean(block)),
    ...sortOperationWordTimingSlots(
      operations.flatMap((operation) =>
        operation.kind === 'lineTiming'
          ? buildLineTimingOperationReportBlocks(operation, freeze)
          : []
      )
    ),
  ]);

export const getReviewReplayBase = (freeze: TTMLLyric, operations: ReviewOperationRecord[]) =>
  replayReviewOperations(freeze, operations);

export const buildReviewReportFromOperationReplay = (
  baseReports: ReviewReportInput[],
  freeze: TTMLLyric,
  staged: TTMLLyric,
  operations: ReviewOperationRecord[],
  syncReport?: ReviewReportInput
) => {
  const replayedBase = getReviewReplayBase(freeze, operations);
  const operationReport = applyReviewReportSelectionState(
    buildOperationReport(freeze, operations),
    baseReports
  );
  const currentSyncReport = syncReport ?? createReviewReport();
  // The diff builder needs the complete previous report to restore enabled states.
  // It filters persistent blocks itself before assembling the final report.
  const currentReport = buildReviewReportFromDiffs(
    baseReports,
    replayedBase,
    staged,
    currentSyncReport
  );

  return mergeReports([operationReport, currentReport]);
};
