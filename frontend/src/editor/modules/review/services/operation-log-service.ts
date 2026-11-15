import { uid } from 'uid';
import type {
  TimingField,
  TimingReportSelectionItem,
} from '$/modules/review/services/report-service/types';
import type {
  ProcessedLyricLine,
  WordSegment,
} from '$/modules/segmentation/utils/segment-processing';
import { applyLineTimingSegmentsToWords } from '$/modules/spectrogram/utils/line-timing-application';
import type { TTMLLyric } from '$/types/ttml';

export type ReviewOperationKind = 'timeShift' | 'lineTiming';

type ReviewOperationBase = {
  id: string;
  kind: ReviewOperationKind;
  createdAt: string;
  /**
   * 入栈时歌词状态的指纹（见 `states/main.ts` 的 `lyricStateHash`）。
   *
   * 撤销时用它 O(n) 比对「刚撤销掉的是不是这一步 review 操作」，
   * 替代原来「深拷贝 + 回放 + 两次 stringify」的做法。
   */
  beforeStateHash?: string;
};

export type ReviewTimeShiftOperation = ReviewOperationBase & {
  kind: 'timeShift';
  offsetMs: number;
  targetLineIds: string[];
};

export type ReviewLineTimingSegmentSnapshot = {
  id: string;
  word: string;
  startTime: number;
  endTime: number;
  isRuby?: boolean;
  parentId?: string;
  rubyIndex?: number;
};

export type ReviewLineTimingSnapshot = {
  id: string;
  startTime: number;
  endTime: number;
  isBG?: boolean;
  segments: ReviewLineTimingSegmentSnapshot[];
};

export type ReviewLineTimingReportItem = {
  wordId: string;
  fields: TimingField[];
};

export type ReviewLineTimingOperation = ReviewOperationBase & {
  kind: 'lineTiming';
  lineId: string;
  before: ReviewLineTimingSnapshot;
  after: ReviewLineTimingSnapshot;
  reportItems: ReviewLineTimingReportItem[];
};

export type ReviewOperationRecord = ReviewTimeShiftOperation | ReviewLineTimingOperation;

export const createReviewTimeShiftOperation = (options: {
  offsetMs: number;
  targetLineIds: string[];
}): ReviewTimeShiftOperation => ({
  id: uid(),
  kind: 'timeShift',
  createdAt: new Date().toISOString(),
  offsetMs: options.offsetMs,
  targetLineIds: options.targetLineIds,
});

const createLineTimingSnapshot = (line: ProcessedLyricLine): ReviewLineTimingSnapshot => ({
  id: line.id,
  startTime: line.startTime,
  endTime: line.endTime,
  isBG: line.isBG,
  segments: line.segments
    .filter((segment): segment is WordSegment => segment.type === 'word')
    .map((segment) => ({
      id: segment.id,
      word: segment.word,
      startTime: segment.startTime,
      endTime: segment.endTime,
      isRuby: segment.isRuby,
      parentId: segment.parentId,
      rubyIndex: segment.rubyIndex,
    })),
});

const dedupeReportItems = (
  items: TimingReportSelectionItem[] = []
): ReviewLineTimingReportItem[] => {
  const fieldsByWord = new Map<string, Set<TimingField>>();
  for (const item of items) {
    const fields = fieldsByWord.get(item.wordId) ?? new Set<TimingField>();
    fields.add(item.field);
    fieldsByWord.set(item.wordId, fields);
  }
  return Array.from(fieldsByWord.entries()).map(([wordId, fields]) => ({
    wordId,
    fields: Array.from(fields),
  }));
};

const hasLineTimingSnapshotChange = (
  before: ReviewLineTimingSnapshot,
  after: ReviewLineTimingSnapshot
) => {
  if (
    Math.round(before.startTime) !== Math.round(after.startTime) ||
    Math.round(before.endTime) !== Math.round(after.endTime)
  ) {
    return true;
  }

  const beforeSegments = new Map(before.segments.map((segment) => [segment.id, segment]));
  return after.segments.some((afterSegment) => {
    const beforeSegment = beforeSegments.get(afterSegment.id);
    return (
      beforeSegment &&
      (Math.round(beforeSegment.startTime) !== Math.round(afterSegment.startTime) ||
        Math.round(beforeSegment.endTime) !== Math.round(afterSegment.endTime))
    );
  });
};

export const createReviewLineTimingOperation = (options: {
  beforeLine: ProcessedLyricLine;
  afterLine: ProcessedLyricLine;
  reportItems?: TimingReportSelectionItem[];
}): ReviewLineTimingOperation | null => {
  const before = createLineTimingSnapshot(options.beforeLine);
  const after = createLineTimingSnapshot(options.afterLine);
  if (!hasLineTimingSnapshotChange(before, after)) return null;

  return {
    id: uid(),
    kind: 'lineTiming',
    createdAt: new Date().toISOString(),
    lineId: before.id,
    before,
    after,
    reportItems: dedupeReportItems(options.reportItems),
  };
};

const cloneLyric = (data: TTMLLyric): TTMLLyric => JSON.parse(JSON.stringify(data)) as TTMLLyric;

export const applyReviewTimeShiftOperation = (
  lyric: TTMLLyric,
  operation: ReviewTimeShiftOperation
) => {
  const targetLineIds = new Set(operation.targetLineIds);
  if (targetLineIds.size === 0 || operation.offsetMs === 0) return lyric;

  const { offsetMs } = operation;

  lyric.lyricLines.forEach((line) => {
    if (!targetLineIds.has(line.id)) return;

    // 偏移量在行级别夹一次：提前时最多提前到该行最早的时间点，
    // 整行所有字段共用同一个 offset，行时长 / 词时长都不会被压扁。
    let minStart = line.startTime;
    line.words.forEach((word) => {
      minStart = Math.min(minStart, word.startTime);
      word.ruby?.forEach((rubyWord) => {
        minStart = Math.min(minStart, rubyWord.startTime);
      });
    });
    const appliedOffset = offsetMs < 0 ? Math.max(offsetMs, -minStart) : offsetMs;

    line.startTime += appliedOffset;
    line.endTime += appliedOffset;

    line.words.forEach((word) => {
      word.startTime += appliedOffset;
      word.endTime += appliedOffset;

      word.ruby?.forEach((rubyWord) => {
        rubyWord.startTime += appliedOffset;
        rubyWord.endTime += appliedOffset;
      });
    });
  });

  return lyric;
};

export const applyReviewLineTimingOperation = (
  lyric: TTMLLyric,
  operation: ReviewLineTimingOperation
) => {
  const line = lyric.lyricLines.find((line) => line.id === operation.lineId);
  if (!line) return lyric;

  line.startTime = operation.after.startTime;
  line.endTime = operation.after.endTime;
  line.words = applyLineTimingSegmentsToWords(line.words, operation.after.segments);

  return lyric;
};

export const applyReviewOperation = (lyric: TTMLLyric, operation: ReviewOperationRecord) => {
  switch (operation.kind) {
    case 'timeShift':
      return applyReviewTimeShiftOperation(lyric, operation);
    case 'lineTiming':
      return applyReviewLineTimingOperation(lyric, operation);
  }
};

export const replayReviewOperations = (base: TTMLLyric, operations: ReviewOperationRecord[]) => {
  const replayed = cloneLyric(base);
  operations.forEach((operation) => {
    applyReviewOperation(replayed, operation);
  });
  return replayed;
};
