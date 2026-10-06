import type { TTMLLyric } from '$/types/ttml';
import {
  buildLineMap,
  buildWordMap,
  computeDisplayNumbers,
  getDisplayNumber,
  getLineNumber,
  getLineText,
  getWordText,
} from './lyric-utils';
import { keepPersistentReviewReportBlocks, mergeReports } from './merge-service';
import {
  createReviewReport,
  createReviewReportBlockId,
  normalizeReviewReport,
} from './normalize-service';
import { applyReviewReportSelectionState } from './selection-service';
import type {
  LineChange,
  ReviewReportBlock,
  ReviewReportInput,
  WordChange,
  WordPresenceChange,
} from './types';

const compareWordOrder = (
  a: { lineNumber: number; isBG: boolean; wordIndex: number },
  b: { lineNumber: number; isBG: boolean; wordIndex: number }
) => a.lineNumber - b.lineNumber || Number(a.isBG) - Number(b.isBG) || a.wordIndex - b.wordIndex;

export const buildEditReport = (freeze: TTMLLyric, staged: TTMLLyric) => {
  const stagedLineMap = buildLineMap(staged.lyricLines);
  const freezeDisplayMap = computeDisplayNumbers(freeze.lyricLines);
  const stagedDisplayMap = computeDisplayNumbers(staged.lyricLines);
  const wordTextChanges: WordChange[] = [];
  const wordAndRomanChanges: WordChange[] = [];
  const romanOnlyChanges: WordChange[] = [];
  const wordAdditions: WordPresenceChange[] = [];
  const wordRemovals: WordPresenceChange[] = [];
  const lineChanges: LineChange[] = [];
  const blocks: ReviewReportBlock[] = [];
  const matchedStagedLines = new Set<(typeof staged.lyricLines)[number]>();

  freeze.lyricLines.forEach((freezeLine, index) => {
    // 优先按稳定 id 对齐；id 不存在或已被消费时再按位置兜底，避免插入/删除行后整段误报。
    const foundStagedById = stagedLineMap.get(freezeLine.id);
    const stagedById =
      foundStagedById && !matchedStagedLines.has(foundStagedById) ? foundStagedById : undefined;
    const fallbackLine = staged.lyricLines[index];
    const stagedLine =
      stagedById ??
      (fallbackLine && !matchedStagedLines.has(fallbackLine) ? fallbackLine : undefined);
    const lineNumber = getLineNumber(freezeLine, index, freezeDisplayMap, stagedDisplayMap);
    if (!stagedLine) {
      blocks.push({
        id: createReviewReportBlockId('line-removed'),
        kind: 'lineRemoved',
        enabled: true,
        lineNumber,
        isBG: freezeLine.isBG ?? false,
        text: getLineText(freezeLine),
      });
      return;
    }
    matchedStagedLines.add(stagedLine);
    const isBG = freezeLine.isBG ?? stagedLine.isBG ?? false;
    const oldTrans = freezeLine.translatedLyric ?? '';
    const newTrans = stagedLine.translatedLyric ?? '';
    const oldLineRoman = freezeLine.romanLyric ?? '';
    const newLineRoman = stagedLine.romanLyric ?? '';
    if (oldTrans !== newTrans || oldLineRoman !== newLineRoman) {
      lineChanges.push({
        lineNumber,
        isBG,
        oldTrans,
        newTrans,
        oldRoman: oldLineRoman,
        newRoman: newLineRoman,
      });
    }
    const stagedWordMap = buildWordMap(stagedLine.words);
    const matchedStagedWordIndexes = new Set<number>();
    const matchedStagedWords = new Set<(typeof stagedLine.words)[number]>();
    freezeLine.words.forEach((freezeWord, wordIndex) => {
      // 逐词也采用 id 优先、位置兜底的匹配策略，以支持分词微调后的报告仍能定位到原行。
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
      if (!stagedWord) {
        wordRemovals.push({
          wordId: freezeWord.id,
          lineNumber,
          wordIndex,
          isBG,
          word: getWordText(freezeWord),
        });
        return;
      }
      const stagedWordIndex =
        stagedByWordId && foundStagedIndexById >= 0 ? foundStagedIndexById : wordIndex;
      matchedStagedWordIndexes.add(stagedWordIndex);
      matchedStagedWords.add(stagedWord);
      const oldWord = freezeWord.word ?? '';
      const newWord = stagedWord.word ?? '';
      const oldRoman = freezeWord.romanWord ?? '';
      const newRoman = stagedWord.romanWord ?? '';
      if (oldWord !== newWord && oldRoman !== newRoman) {
        wordAndRomanChanges.push({
          wordId: freezeWord.id,
          lineNumber,
          wordIndex,
          isBG,
          oldWord,
          newWord,
          oldRoman,
          newRoman,
        });
      } else if (oldWord !== newWord) {
        wordTextChanges.push({
          wordId: freezeWord.id,
          lineNumber,
          wordIndex,
          isBG,
          oldWord,
          newWord,
          oldRoman,
          newRoman,
        });
      } else if (oldRoman !== newRoman) {
        romanOnlyChanges.push({
          wordId: freezeWord.id,
          lineNumber,
          wordIndex,
          isBG,
          oldWord,
          newWord,
          oldRoman,
          newRoman,
        });
      }
    });
    stagedLine.words.forEach((stagedWord, wordIndex) => {
      if (matchedStagedWordIndexes.has(wordIndex) || matchedStagedWords.has(stagedWord)) {
        return;
      }
      wordAdditions.push({
        wordId: stagedWord.id,
        lineNumber,
        wordIndex,
        isBG,
        word: getWordText(stagedWord),
      });
    });
  });

  staged.lyricLines.forEach((stagedLine, index) => {
    if (matchedStagedLines.has(stagedLine)) return;
    blocks.push({
      id: createReviewReportBlockId('line-added'),
      kind: 'lineAdded',
      enabled: true,
      lineNumber: getDisplayNumber(stagedLine, index, stagedDisplayMap),
      isBG: stagedLine.isBG ?? false,
      text: getLineText(stagedLine),
    });
  });

  const groupedByWord = new Map<string, WordChange[]>();
  wordTextChanges.forEach((change) => {
    const key = `${change.oldWord}=>${change.newWord}`;
    const list = groupedByWord.get(key) ?? [];
    list.push(change);
    groupedByWord.set(key, list);
  });
  const consumed = new Set<WordChange>();
  for (const group of groupedByWord.values()) {
    // 相同的文本修正如果跨多行出现，合并成一条报告，减少审阅输出里的重复噪声。
    const lineKeys = new Set(
      group.map((item) => `${item.lineNumber}:${item.isBG ? 'bg' : 'main'}`)
    );
    if (lineKeys.size <= 1) continue;
    const sample = group[0];
    if (!sample) continue;
    blocks.push({
      id: createReviewReportBlockId('word-text-shared'),
      kind: 'wordTextShared',
      enabled: true,
      lineRefs: group.map((item) => ({
        lineNumber: item.lineNumber,
        wordIndex: item.wordIndex,
        isBG: item.isBG,
      })),
      oldWord: sample.oldWord,
      newWord: sample.newWord,
    });
    group.forEach((item) => {
      consumed.add(item);
    });
  }

  const remainingWordChanges = wordTextChanges.filter((item) => !consumed.has(item));
  const groupByLine = new Map<string, { lineNumber: number; isBG: boolean; items: WordChange[] }>();
  remainingWordChanges.forEach((item) => {
    const key = `${item.lineNumber}:${item.isBG ? 'bg' : 'main'}`;
    const entry = groupByLine.get(key) ?? {
      lineNumber: item.lineNumber,
      isBG: item.isBG,
      items: [],
    };
    entry.items.push(item);
    groupByLine.set(key, entry);
  });
  const groupedLines = Array.from(groupByLine.values()).sort(
    (a, b) => a.lineNumber - b.lineNumber || Number(a.isBG) - Number(b.isBG)
  );
  groupedLines.forEach((entry) => {
    if (entry.items.length <= 1) return;
    const items = [...entry.items].sort((a, b) => a.wordIndex - b.wordIndex);
    blocks.push({
      id: createReviewReportBlockId('word-text-group'),
      kind: 'wordTextGroup',
      enabled: true,
      lineNumber: entry.lineNumber,
      isBG: entry.isBG,
      changes: items.map((item) => ({
        wordId: item.wordId,
        wordIndex: item.wordIndex,
        oldWord: item.oldWord,
        newWord: item.newWord,
      })),
    });
    items.forEach((item) => {
      consumed.add(item);
    });
  });

  const singleWordChanges = remainingWordChanges.filter((item) => !consumed.has(item));
  singleWordChanges.sort(compareWordOrder).forEach((item) => {
    blocks.push({
      id: createReviewReportBlockId('word-text'),
      kind: 'wordText',
      enabled: true,
      wordId: item.wordId,
      lineNumber: item.lineNumber,
      wordIndex: item.wordIndex,
      isBG: item.isBG,
      oldWord: item.oldWord,
      newWord: item.newWord,
    });
  });

  wordRemovals.sort(compareWordOrder).forEach((item) => {
    blocks.push({
      id: createReviewReportBlockId('word-removed'),
      kind: 'wordRemoved',
      enabled: true,
      wordId: item.wordId,
      lineNumber: item.lineNumber,
      wordIndex: item.wordIndex,
      isBG: item.isBG,
      word: item.word,
    });
  });

  wordAdditions.sort(compareWordOrder).forEach((item) => {
    blocks.push({
      id: createReviewReportBlockId('word-added'),
      kind: 'wordAdded',
      enabled: true,
      wordId: item.wordId,
      lineNumber: item.lineNumber,
      wordIndex: item.wordIndex,
      isBG: item.isBG,
      word: item.word,
    });
  });

  romanOnlyChanges.sort(compareWordOrder).forEach((item) => {
    blocks.push({
      id: createReviewReportBlockId('word-roman'),
      kind: 'wordRoman',
      enabled: true,
      wordId: item.wordId,
      lineNumber: item.lineNumber,
      wordIndex: item.wordIndex,
      isBG: item.isBG,
      word: item.oldWord,
      oldRoman: item.oldRoman,
      newRoman: item.newRoman,
    });
  });

  lineChanges
    .sort((a, b) => a.lineNumber - b.lineNumber || Number(a.isBG) - Number(b.isBG))
    .forEach((item) => {
      if (item.oldTrans !== item.newTrans) {
        blocks.push({
          id: createReviewReportBlockId('line-translation'),
          kind: 'lineTranslation',
          enabled: true,
          lineNumber: item.lineNumber,
          isBG: item.isBG,
          oldText: item.oldTrans,
          newText: item.newTrans,
        });
      }
      if (item.oldRoman !== item.newRoman) {
        blocks.push({
          id: createReviewReportBlockId('line-roman'),
          kind: 'lineRoman',
          enabled: true,
          lineNumber: item.lineNumber,
          isBG: item.isBG,
          oldText: item.oldRoman,
          newText: item.newRoman,
        });
      }
    });

  wordAndRomanChanges.sort(compareWordOrder).forEach((item) => {
    blocks.push({
      id: createReviewReportBlockId('word-and-roman'),
      kind: 'wordAndRoman',
      enabled: true,
      wordId: item.wordId,
      lineNumber: item.lineNumber,
      wordIndex: item.wordIndex,
      isBG: item.isBG,
      oldWord: item.oldWord,
      newWord: item.newWord,
      oldRoman: item.oldRoman,
      newRoman: item.newRoman,
    });
  });

  return createReviewReport(blocks);
};

export const buildReviewReportFromDiffs = (
  baseReports: ReviewReportInput[],
  freeze: TTMLLyric,
  staged: TTMLLyric,
  syncReport: ReviewReportInput = createReviewReport()
) => {
  const editReport = buildEditReport(freeze, staged);
  const editBlocks = normalizeReviewReport(editReport).blocks;
  const syncBlocks = normalizeReviewReport(syncReport).blocks;
  const generatedReport = applyReviewReportSelectionState(
    createReviewReport([...editBlocks, ...syncBlocks]),
    baseReports
  );
  // 这里是所有入口的统一组装点：先保留用户持久条目，再用最新 freeze/staged 重建自动编辑差异。
  const persistentBaseReports = baseReports.map(keepPersistentReviewReportBlocks);

  return mergeReports([...persistentBaseReports, generatedReport]);
};
