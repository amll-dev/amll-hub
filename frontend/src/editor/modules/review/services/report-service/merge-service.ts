import { createReviewReport, normalizeReviewReport } from './normalize-service';
import { applyManualReviewReportPlacements } from './ordering-service';
import { getReviewReportBlockText } from './render-service';
import { getReviewReportSelectionKey } from './selection-service';
import type { ReviewReportBlock, ReviewReportInput, TimingField } from './types';

const mergeTimingBlocks = (blocks: Extract<ReviewReportBlock, { kind: 'timing' }>[]) => {
  if (blocks.length <= 1) return blocks[0] ?? null;
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  if (!first || !last) return null;
  const operationIds = blocks
    .map((block) => block.operationId)
    .filter((id): id is string => Boolean(id));
  const mergedFields = new Set<TimingField>(blocks.flatMap((block) => block.fields));
  const fields = Array.from(mergedFields).filter((field) =>
    field === 'startTime' ? first.oldStart !== last.newStart : first.oldEnd !== last.newEnd
  );
  if (fields.length === 0) return null;
  return {
    ...first,
    id: first.id,
    operationId:
      operationIds.length === blocks.length ? `merged:${operationIds.join('+')}` : undefined,
    word: first.word || last.word,
    oldStart: first.oldStart,
    newStart: last.newStart,
    oldEnd: first.oldEnd,
    newEnd: last.newEnd,
    fields,
  };
};

const mergeLineTimingBlocks = (blocks: Extract<ReviewReportBlock, { kind: 'lineTiming' }>[]) => {
  if (blocks.length <= 1) return blocks[0] ?? null;
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  if (!first || !last) return null;
  if (first.oldStart === last.newStart && first.oldEnd === last.newEnd) {
    return null;
  }
  const operationIds = blocks
    .map((block) => block.operationId)
    .filter((id): id is string => Boolean(id));
  return {
    ...first,
    id: first.id,
    operationId:
      operationIds.length === blocks.length ? `merged:${operationIds.join('+')}` : undefined,
    oldStart: first.oldStart,
    newStart: last.newStart,
    oldEnd: first.oldEnd,
    newEnd: last.newEnd,
  };
};

type WordEditReportBlock =
  | Extract<ReviewReportBlock, { kind: 'wordText' }>
  | Extract<ReviewReportBlock, { kind: 'wordRoman' }>
  | Extract<ReviewReportBlock, { kind: 'wordAndRoman' }>;

const mergeWordEditBlocks = (blocks: WordEditReportBlock[]) => {
  const first = blocks[0];
  if (!first) return null;
  if (blocks.length <= 1) return first;

  let oldWord: string | undefined;
  let newWord: string | undefined;
  let oldRoman: string | undefined;
  let newRoman: string | undefined;

  blocks.forEach((block) => {
    if (block.kind === 'wordText' || block.kind === 'wordAndRoman') {
      oldWord ??= block.oldWord;
      newWord = block.newWord;
    }
    if (block.kind === 'wordRoman') {
      oldWord ??= block.word;
      newWord ??= block.word;
      oldRoman ??= block.oldRoman;
      newRoman = block.newRoman;
    }
    if (block.kind === 'wordAndRoman') {
      oldRoman ??= block.oldRoman;
      newRoman = block.newRoman;
    }
  });

  const finalOldWord = oldWord ?? '';
  const finalNewWord = newWord ?? finalOldWord;
  const finalOldRoman = oldRoman ?? '';
  const finalNewRoman = newRoman ?? finalOldRoman;
  const hasWordChange = finalOldWord !== finalNewWord;
  const hasRomanChange = finalOldRoman !== finalNewRoman;
  if (!hasWordChange && !hasRomanChange) return null;
  if (hasWordChange && hasRomanChange) {
    return {
      id: first.id,
      kind: 'wordAndRoman' as const,
      enabled: first.enabled,
      wordId: first.wordId,
      lineNumber: first.lineNumber,
      wordIndex: first.wordIndex,
      isBG: first.isBG,
      oldWord: finalOldWord,
      newWord: finalNewWord,
      oldRoman: finalOldRoman,
      newRoman: finalNewRoman,
    };
  }
  if (hasWordChange) {
    return {
      id: first.id,
      kind: 'wordText' as const,
      enabled: first.enabled,
      wordId: first.wordId,
      lineNumber: first.lineNumber,
      wordIndex: first.wordIndex,
      isBG: first.isBG,
      oldWord: finalOldWord,
      newWord: finalNewWord,
    };
  }
  return {
    id: first.id,
    kind: 'wordRoman' as const,
    enabled: first.enabled,
    wordId: first.wordId,
    lineNumber: first.lineNumber,
    wordIndex: first.wordIndex,
    isBG: first.isBG,
    word: finalNewWord || finalOldWord,
    oldRoman: finalOldRoman,
    newRoman: finalNewRoman,
  };
};

const mergeWordOperationBlocks = (blocks: ReviewReportBlock[]) => {
  const wordEditGroups = new Map<
    string,
    {
      firstIndex: number;
      blocks: WordEditReportBlock[];
    }
  >();
  const timingGroups = new Map<
    string,
    {
      firstIndex: number;
      blocks: Extract<ReviewReportBlock, { kind: 'timing' }>[];
    }
  >();
  const lineTimingGroups = new Map<
    string,
    {
      firstIndex: number;
      blocks: Extract<ReviewReportBlock, { kind: 'lineTiming' }>[];
    }
  >();
  const keys = blocks.map((block, index) => {
    if (
      (block.kind === 'wordText' || block.kind === 'wordRoman' || block.kind === 'wordAndRoman') &&
      block.wordId
    ) {
      const key = `wordEdit:${block.wordId}`;
      const group = wordEditGroups.get(key);
      if (group) {
        group.blocks.push(block);
      } else {
        wordEditGroups.set(key, { firstIndex: index, blocks: [block] });
      }
      return key;
    }
    if (block.kind === 'timing') {
      const key = `timing:${block.wordId}`;
      const group = timingGroups.get(key);
      if (group) {
        group.blocks.push(block);
      } else {
        timingGroups.set(key, { firstIndex: index, blocks: [block] });
      }
      return key;
    }
    if (block.kind === 'lineTiming') {
      const key = `lineTiming:${block.lineId}`;
      const group = lineTimingGroups.get(key);
      if (group) {
        group.blocks.push(block);
      } else {
        lineTimingGroups.set(key, { firstIndex: index, blocks: [block] });
      }
      return key;
    }
    return null;
  });

  return blocks
    .map<ReviewReportBlock | null>((block, index) => {
      const key = keys[index];
      if (!key) return block;
      if (
        block.kind === 'wordText' ||
        block.kind === 'wordRoman' ||
        block.kind === 'wordAndRoman'
      ) {
        const group = wordEditGroups.get(key);
        if (!group || group.firstIndex !== index) return null;
        return mergeWordEditBlocks(group.blocks);
      }
      if (block.kind === 'timing') {
        const group = timingGroups.get(key);
        if (!group || group.firstIndex !== index) return null;
        return mergeTimingBlocks(group.blocks);
      }
      if (block.kind === 'lineTiming') {
        const group = lineTimingGroups.get(key);
        if (!group || group.firstIndex !== index) return null;
        return mergeLineTimingBlocks(group.blocks);
      }
      return block;
    })
    .filter((block): block is ReviewReportBlock => Boolean(block));
};

export const mergeReports = (reports: ReviewReportInput[]) => {
  const seen = new Set<string>();
  const reportBlocks = reports.flatMap((report) => normalizeReviewReport(report).blocks);
  const blocks = mergeWordOperationBlocks(reportBlocks).filter((block) => {
    if (block.enabled) {
      const text = getReviewReportBlockText(block);
      if (!text) return false;
    }
    if (block.kind === 'manual') return true;
    const dedupeKey =
      block.kind === 'timeShift'
        ? `${block.kind}:${block.operationId}`
        : getReviewReportSelectionKey(block);
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  });
  return createReviewReport(applyManualReviewReportPlacements(blocks));
};

const isOperationGeneratedReportBlock = (block: ReviewReportBlock) =>
  'operationId' in block && Boolean(block.operationId);

const isEditableGeneratedReportBlock = (block: ReviewReportBlock) =>
  (block.kind !== 'manual' && block.kind !== 'timing') || isOperationGeneratedReportBlock(block);

export const keepManualReviewReportBlocks = (report: ReviewReportInput) =>
  createReviewReport(
    normalizeReviewReport(report).blocks.filter((block) => block.kind === 'manual')
  );

export const keepPersistentReviewReportBlocks = (report: ReviewReportInput) => {
  // 自动编辑差异会随歌词变化重算；手写内容和已确认的时轴条目属于用户显式选择，需要跨刷新保留。
  return createReviewReport(
    normalizeReviewReport(report).blocks.filter((block) => !isEditableGeneratedReportBlock(block))
  );
};
