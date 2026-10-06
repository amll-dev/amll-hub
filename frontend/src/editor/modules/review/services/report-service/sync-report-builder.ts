import type { TTMLLyric } from '$/types/ttml';
import { buildLineMap, buildWordMap, computeDisplayNumbers, getLineNumber } from './lyric-utils';
import { createReviewReport, createReviewReportBlockId } from './normalize-service';
import type {
  LineTimingChangeCandidate,
  ReviewReportBlock,
  SyncChangeCandidate,
  TimingField,
} from './types';

const wrap = (value: string | number) => `\`${value}\``;

const buildSyncParts = (item: SyncChangeCandidate, fields?: Set<TimingField>) => {
  const startDelta = item.newStart - item.oldStart;
  const endDelta = item.newEnd - item.oldEnd;
  const useStart = fields ? fields.has('startTime') : true;
  const useEnd = fields ? fields.has('endTime') : true;
  const parts: string[] = [];
  if (useStart && startDelta !== 0) {
    const speed = startDelta < 0 ? '提前' : '延后';
    const prefix = '起始';
    parts.push(`${prefix}${speed}了 ${wrap(Math.abs(startDelta))} 毫秒`);
  }
  if (useEnd && endDelta !== 0) {
    const speed = endDelta < 0 ? '提前' : '延后';
    const prefix = '结束';
    parts.push(`${prefix}${speed}了 ${wrap(Math.abs(endDelta))} 毫秒`);
  }
  return parts;
};

const buildSyncReportBlocks = (
  candidates: SyncChangeCandidate[],
  fieldMap?: Map<string, Set<TimingField>>,
  lineCandidates: LineTimingChangeCandidate[] = []
) => {
  const wordTimingBlocks = candidates
    .map<Extract<ReviewReportBlock, { kind: 'timing' }> | null>((candidate) => {
      const fields = fieldMap?.get(candidate.wordId);
      if (fieldMap && !fields) return null;
      if (buildSyncParts(candidate, fields).length === 0) return null;
      return {
        id: createReviewReportBlockId('timing'),
        kind: 'timing' as const,
        enabled: true,
        wordId: candidate.wordId,
        lineNumber: candidate.lineNumber,
        wordIndex: candidate.wordIndex,
        isBG: candidate.isBG,
        word: candidate.word,
        oldStart: candidate.oldStart,
        newStart: candidate.newStart,
        oldEnd: candidate.oldEnd,
        newEnd: candidate.newEnd,
        fields: fieldMap
          ? Array.from(fields ?? [])
          : (['startTime', 'endTime'] satisfies TimingField[]),
      };
    })
    .filter((item): item is Extract<ReviewReportBlock, { kind: 'timing' }> => Boolean(item));
  const lineTimingBlocks = lineCandidates
    .map<Extract<ReviewReportBlock, { kind: 'lineTiming' }> | null>((candidate) => {
      if (candidate.oldStart === candidate.newStart && candidate.oldEnd === candidate.newEnd) {
        return null;
      }
      return {
        id: createReviewReportBlockId('line-timing'),
        kind: 'lineTiming' as const,
        enabled: true,
        lineId: candidate.lineId,
        lineNumber: candidate.lineNumber,
        isBG: candidate.isBG,
        oldStart: candidate.oldStart,
        newStart: candidate.newStart,
        oldEnd: candidate.oldEnd,
        newEnd: candidate.newEnd,
      };
    })
    .filter((item): item is Extract<ReviewReportBlock, { kind: 'lineTiming' }> => Boolean(item));
  return [...wordTimingBlocks, ...lineTimingBlocks];
};

export const buildSyncChanges = (freeze: TTMLLyric, staged: TTMLLyric) => {
  const stagedLineMap = buildLineMap(staged.lyricLines);
  const freezeDisplayMap = computeDisplayNumbers(freeze.lyricLines);
  const stagedDisplayMap = computeDisplayNumbers(staged.lyricLines);
  const reportLines: SyncChangeCandidate[] = [];
  const matchedStagedLines = new Set<(typeof staged.lyricLines)[number]>();

  freeze.lyricLines.forEach((freezeLine, index) => {
    const foundStagedById = stagedLineMap.get(freezeLine.id);
    const stagedById =
      foundStagedById && !matchedStagedLines.has(foundStagedById) ? foundStagedById : undefined;
    const fallbackLine = staged.lyricLines[index];
    const stagedLine =
      stagedById ??
      (fallbackLine && !matchedStagedLines.has(fallbackLine) ? fallbackLine : undefined);
    if (!stagedLine) return;
    matchedStagedLines.add(stagedLine);
    const lineNumber = getLineNumber(freezeLine, index, freezeDisplayMap, stagedDisplayMap);
    const isBG = freezeLine.isBG ?? stagedLine.isBG ?? false;
    const stagedWordMap = buildWordMap(stagedLine.words);
    const matchedStagedWordIndexes = new Set<number>();
    const matchedStagedWords = new Set<(typeof stagedLine.words)[number]>();
    freezeLine.words.forEach((freezeWord, wordIndex) => {
      const foundStagedByWordId = stagedWordMap.get(freezeWord.id);
      const foundStagedIndexById = foundStagedByWordId
        ? stagedLine.words.indexOf(foundStagedByWordId)
        : -1;
      const stagedByWordId =
        foundStagedByWordId &&
        foundStagedIndexById >= 0 &&
        !matchedStagedWordIndexes.has(foundStagedIndexById) &&
        !matchedStagedWords.has(foundStagedByWordId)
          ? foundStagedByWordId
          : undefined;
      const fallbackWord = stagedLine.words[wordIndex];
      const stagedWord =
        stagedByWordId ??
        (fallbackWord &&
        !matchedStagedWordIndexes.has(wordIndex) &&
        !matchedStagedWords.has(fallbackWord)
          ? fallbackWord
          : undefined);
      if (!stagedWord) return;
      matchedStagedWordIndexes.add(
        stagedByWordId && foundStagedIndexById >= 0 ? foundStagedIndexById : wordIndex
      );
      matchedStagedWords.add(stagedWord);
      const oldStart = Math.round(freezeWord.startTime);
      const newStart = Math.round(stagedWord.startTime);
      const oldEnd = Math.round(freezeWord.endTime);
      const newEnd = Math.round(stagedWord.endTime);
      if (oldStart === newStart && oldEnd === newEnd) return;
      reportLines.push({
        wordId: freezeWord.id,
        lineNumber,
        wordIndex,
        isBG,
        word: freezeWord.word || '（空白）',
        oldStart,
        newStart,
        oldEnd,
        newEnd,
      });
    });
  });

  return reportLines;
};

export const buildLineTimingChanges = (freeze: TTMLLyric, staged: TTMLLyric) => {
  const stagedLineMap = buildLineMap(staged.lyricLines);
  const freezeDisplayMap = computeDisplayNumbers(freeze.lyricLines);
  const stagedDisplayMap = computeDisplayNumbers(staged.lyricLines);
  const reportLines: LineTimingChangeCandidate[] = [];
  const matchedStagedLines = new Set<(typeof staged.lyricLines)[number]>();

  freeze.lyricLines.forEach((freezeLine, index) => {
    const foundStagedById = stagedLineMap.get(freezeLine.id);
    const stagedById =
      foundStagedById && !matchedStagedLines.has(foundStagedById) ? foundStagedById : undefined;
    const fallbackLine = staged.lyricLines[index];
    const stagedLine =
      stagedById ??
      (fallbackLine && !matchedStagedLines.has(fallbackLine) ? fallbackLine : undefined);
    if (!stagedLine) return;
    matchedStagedLines.add(stagedLine);

    const oldStart = Math.round(freezeLine.startTime);
    const newStart = Math.round(stagedLine.startTime);
    const oldEnd = Math.round(freezeLine.endTime);
    const newEnd = Math.round(stagedLine.endTime);
    if (oldStart === newStart && oldEnd === newEnd) return;

    reportLines.push({
      lineId: freezeLine.id,
      lineNumber: getLineNumber(freezeLine, index, freezeDisplayMap, stagedDisplayMap),
      isBG: freezeLine.isBG ?? stagedLine.isBG ?? false,
      oldStart,
      newStart,
      oldEnd,
      newEnd,
    });
  });

  return reportLines;
};

export const buildSyncReport = (
  reportLines: SyncChangeCandidate[],
  lineTimingLines: LineTimingChangeCandidate[] = []
) => {
  return createReviewReport(buildSyncReportBlocks(reportLines, undefined, lineTimingLines));
};
