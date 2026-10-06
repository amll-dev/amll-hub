import type {
  ReviewElementPath,
  StructuredReviewChange,
  StructuredReviewChangeBlock,
  StructuredReviewLineTarget,
  StructuredReviewPathChange,
  StructuredReviewTimeShiftChange,
  StructuredReviewUpdates,
} from '$/types/structured-review-report';
import type { TTMLLyric } from '$/types/ttml';
import { pathKey } from '$/utils/content-addressed-id';
import { toStructuredValue, valuesEqual } from '$/utils/structured-review-value';
import { computeDisplayNumbers, getDisplayNumber } from './lyric-utils';
import type { ReviewReport, ReviewReportBlock } from './types';

/** 导出结构化 JSON 时去掉未启用/无实质改动的报告 block，避免冗余。 */
const pruneReportForExport = (report: ReviewReport): ReviewReport => {
  const blocks: ReviewReportBlock[] = [];
  for (const block of report.blocks) {
    if (!block.enabled) continue;
    if (block.kind === 'timeShift') {
      const isAllLines = block.targetCount === block.totalLineCount && block.totalLineCount > 0;
      blocks.push(
        isAllLines
          ? {
              ...block,
              operationId: `timeShift:${block.offsetMs}:all`,
              lineRefs: [],
            }
          : block
      );
      continue;
    }
    if (block.kind === 'wordTextGroup') {
      const changes = block.changes.filter((change) => change.enabled !== false);
      if (changes.length === 0) continue;
      blocks.push({ ...block, changes });
      continue;
    }
    blocks.push(block);
  }
  return {
    version: 1,
    blocks,
  };
};

const isContainer = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

type LineLocator = {
  lineNumber: number;
  isBG: boolean;
};

type WordLocator = LineLocator & {
  wordId?: string;
  wordIndex?: number;
};

type StructuredReviewSelectionContext = {
  freeze: TTMLLyric;
  staged: TTMLLyric;
  freezeDisplayNumbers: Map<string, number>;
  stagedDisplayNumbers: Map<string, number>;
  elementChanges: StructuredReviewPathChange[];
};

const getPathLineIndex = (path: ReviewElementPath) =>
  path[0] === 'lyricLines' && typeof path[1] === 'number' ? path[1] : null;

const getPathWordIndex = (path: ReviewElementPath) =>
  path[0] === 'lyricLines' &&
  typeof path[1] === 'number' &&
  path[2] === 'words' &&
  typeof path[3] === 'number'
    ? path[3]
    : null;

const getPathLeaf = (path: ReviewElementPath) => path[path.length - 1];

const isLinePath = (path: ReviewElementPath) =>
  path[0] === 'lyricLines' && typeof path[1] === 'number';

const isWholeLinePath = (path: ReviewElementPath) => isLinePath(path) && path.length === 2;

const isWordPath = (path: ReviewElementPath) =>
  isLinePath(path) && path[2] === 'words' && typeof path[3] === 'number';

const isWholeWordPath = (path: ReviewElementPath) => isWordPath(path) && path.length === 4;

const isWordFieldPath = (path: ReviewElementPath, field: string) =>
  isWordPath(path) && path.length === 5 && path[4] === field;

const isLineFieldPath = (path: ReviewElementPath, field: string) =>
  isLinePath(path) && path.length === 3 && path[2] === field;

const isTimingLeaf = (path: ReviewElementPath) => {
  const leaf = getPathLeaf(path);
  return leaf === 'startTime' || leaf === 'endTime';
};

const getLineTextFromValue = (value: unknown) => {
  if (!isContainer(value)) return '';
  const record = value as { words?: Array<{ word?: unknown }> };
  return Array.isArray(record.words)
    ? record.words.map((word) => (typeof word.word === 'string' ? word.word : '')).join('') ||
        '（空白）'
    : '';
};

const getWordTextFromValue = (value: unknown) => {
  if (!isContainer(value)) return '';
  const word = (value as { word?: unknown }).word;
  return typeof word === 'string' ? word || '（空白）' : '';
};

const getIdFromValue = (value: unknown) => {
  if (!isContainer(value)) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() ? id : null;
};

const changeValueMatches = (value: unknown, expected: unknown) => valuesEqual(value, expected);

const getChangeLineInfo = (
  context: StructuredReviewSelectionContext,
  change: StructuredReviewPathChange,
  source: 'before' | 'after'
) => {
  const lineIndex = getPathLineIndex(change.path);
  if (lineIndex === null) return null;
  const lyrics = source === 'before' ? context.freeze : context.staged;
  const displayNumbers =
    source === 'before' ? context.freezeDisplayNumbers : context.stagedDisplayNumbers;
  const line = lyrics.lyricLines[lineIndex];
  if (!line) return null;
  return {
    line,
    lineNumber: getDisplayNumber(line, lineIndex, displayNumbers),
    isBG: line.isBG ?? false,
  };
};

const changeLineMatches = (
  context: StructuredReviewSelectionContext,
  change: StructuredReviewPathChange,
  locator: LineLocator,
  source: 'before' | 'after' | 'either' = 'either'
) => {
  const sources = source === 'either' ? (['before', 'after'] as const) : ([source] as const);
  return sources.some((item) => {
    if (item === 'before' && !change.beforeExists) return false;
    if (item === 'after' && !change.afterExists) return false;
    const info = getChangeLineInfo(context, change, item);
    return info?.lineNumber === locator.lineNumber && info.isBG === locator.isBG;
  });
};

const getChangeWord = (
  context: StructuredReviewSelectionContext,
  change: StructuredReviewPathChange,
  source: 'before' | 'after'
) => {
  const lineIndex = getPathLineIndex(change.path);
  const wordIndex = getPathWordIndex(change.path);
  if (lineIndex === null || wordIndex === null) return null;
  const lyrics = source === 'before' ? context.freeze : context.staged;
  return lyrics.lyricLines[lineIndex]?.words[wordIndex] ?? null;
};

const changeWordMatches = (
  context: StructuredReviewSelectionContext,
  change: StructuredReviewPathChange,
  locator: WordLocator
) => {
  if (!changeLineMatches(context, change, locator)) return false;
  const pathWordIndex = getPathWordIndex(change.path);
  if (pathWordIndex === null) return false;

  if (locator.wordId) {
    const beforeWord = change.beforeExists ? getChangeWord(context, change, 'before') : null;
    const afterWord = change.afterExists ? getChangeWord(context, change, 'after') : null;
    if (beforeWord?.id === locator.wordId || afterWord?.id === locator.wordId) {
      return true;
    }
    if (
      getIdFromValue(change.before) === locator.wordId ||
      getIdFromValue(change.after) === locator.wordId
    ) {
      return true;
    }
  }

  return locator.wordIndex === undefined || pathWordIndex === locator.wordIndex;
};

const createReportChangeSelector = (context: StructuredReviewSelectionContext) => {
  const select = (
    predicate: (change: StructuredReviewPathChange) => boolean
  ): StructuredReviewPathChange[] => context.elementChanges.filter(predicate);

  const selectWordTextChange = (locator: WordLocator, oldWord: string, newWord: string) =>
    select(
      (change) =>
        isWordFieldPath(change.path, 'word') &&
        change.beforeExists &&
        change.afterExists &&
        changeWordMatches(context, change, locator) &&
        changeValueMatches(change.before, oldWord) &&
        changeValueMatches(change.after, newWord)
    );

  const selectWordRomanChange = (locator: WordLocator, oldRoman: string, newRoman: string) =>
    select(
      (change) =>
        isWordFieldPath(change.path, 'romanWord') &&
        change.beforeExists &&
        change.afterExists &&
        changeWordMatches(context, change, locator) &&
        changeValueMatches(change.before, oldRoman) &&
        changeValueMatches(change.after, newRoman)
    );

  const selectLineTextChange = (
    locator: LineLocator,
    field: 'translatedLyric' | 'romanLyric',
    oldText: string,
    newText: string
  ) =>
    select(
      (change) =>
        isLineFieldPath(change.path, field) &&
        change.beforeExists &&
        change.afterExists &&
        changeLineMatches(context, change, locator) &&
        changeValueMatches(change.before, oldText) &&
        changeValueMatches(change.after, newText)
    );

  const selectLineTimingChange = (
    locator: LineLocator,
    field: 'startTime' | 'endTime',
    oldTime: number,
    newTime: number
  ) =>
    select(
      (change) =>
        isLineFieldPath(change.path, field) &&
        change.beforeExists &&
        change.afterExists &&
        changeLineMatches(context, change, locator) &&
        changeValueMatches(change.before, oldTime) &&
        changeValueMatches(change.after, newTime)
    );

  const selectWordTimingChange = (
    locator: WordLocator,
    field: 'startTime' | 'endTime',
    oldTime: number,
    newTime: number
  ) =>
    select(
      (change) =>
        isWordFieldPath(change.path, field) &&
        change.beforeExists &&
        change.afterExists &&
        changeWordMatches(context, change, locator) &&
        changeValueMatches(change.before, oldTime) &&
        changeValueMatches(change.after, newTime)
    );

  const selectLineRefWordTextChange = (
    ref: LineLocator & { wordIndex?: number },
    oldWord: string,
    newWord: string
  ) =>
    selectWordTextChange(
      {
        lineNumber: ref.lineNumber,
        isBG: ref.isBG,
        wordIndex: ref.wordIndex,
      },
      oldWord,
      newWord
    );

  const selectBlockChanges = (block: ReviewReportBlock) => {
    switch (block.kind) {
      case 'manual':
        return [];
      case 'wordTextShared':
        return block.lineRefs.flatMap((ref) =>
          selectLineRefWordTextChange(ref, block.oldWord, block.newWord)
        );
      case 'wordTextGroup':
        return block.changes.flatMap((change) => {
          if (change.enabled === false) return [];
          return selectWordTextChange(
            {
              lineNumber: block.lineNumber,
              isBG: block.isBG,
              wordId: change.wordId,
              wordIndex: change.wordIndex,
            },
            change.oldWord,
            change.newWord
          );
        });
      case 'wordText':
        return selectWordTextChange(block, block.oldWord, block.newWord);
      case 'wordRoman':
        return selectWordRomanChange(block, block.oldRoman, block.newRoman);
      case 'lineTranslation':
        return selectLineTextChange(block, 'translatedLyric', block.oldText, block.newText);
      case 'lineRoman':
        return selectLineTextChange(block, 'romanLyric', block.oldText, block.newText);
      case 'wordAndRoman':
        return [
          ...selectWordTextChange(block, block.oldWord, block.newWord),
          ...selectWordRomanChange(block, block.oldRoman, block.newRoman),
        ];
      case 'wordAdded':
        return select(
          (change) =>
            isWholeWordPath(change.path) &&
            !change.beforeExists &&
            change.afterExists &&
            changeLineMatches(context, change, block, 'after') &&
            changeWordMatches(context, change, block) &&
            getWordTextFromValue(change.after) === block.word
        );
      case 'wordRemoved':
        return select(
          (change) =>
            isWholeWordPath(change.path) &&
            change.beforeExists &&
            !change.afterExists &&
            changeLineMatches(context, change, block, 'before') &&
            changeWordMatches(context, change, block) &&
            getWordTextFromValue(change.before) === block.word
        );
      case 'lineAdded':
        return select(
          (change) =>
            isWholeLinePath(change.path) &&
            !change.beforeExists &&
            change.afterExists &&
            changeLineMatches(context, change, block, 'after') &&
            getLineTextFromValue(change.after) === block.text
        );
      case 'lineRemoved':
        return select(
          (change) =>
            isWholeLinePath(change.path) &&
            change.beforeExists &&
            !change.afterExists &&
            changeLineMatches(context, change, block, 'before') &&
            getLineTextFromValue(change.before) === block.text
        );
      case 'timeShift': {
        const lineRefKeys = new Set(
          block.lineRefs.map((ref) => `${ref.lineNumber}:${ref.isBG ? 'bg' : 'main'}`)
        );
        return select((change) => {
          if (
            !isLinePath(change.path) ||
            !isTimingLeaf(change.path) ||
            !change.beforeExists ||
            !change.afterExists ||
            typeof change.before !== 'number' ||
            typeof change.after !== 'number' ||
            change.after - change.before !== block.offsetMs
          ) {
            return false;
          }
          const info = getChangeLineInfo(context, change, 'before');
          if (!info) return false;
          return lineRefKeys.has(`${info.lineNumber}:${info.isBG ? 'bg' : 'main'}`);
        });
      }
      case 'timing': {
        const fields = new Set(block.fields);
        return [
          ...(fields.has('startTime')
            ? selectWordTimingChange(block, 'startTime', block.oldStart, block.newStart)
            : []),
          ...(fields.has('endTime')
            ? selectWordTimingChange(block, 'endTime', block.oldEnd, block.newEnd)
            : []),
        ];
      }
      case 'lineTiming':
        return [
          ...selectLineTimingChange(block, 'startTime', block.oldStart, block.newStart),
          ...selectLineTimingChange(block, 'endTime', block.oldEnd, block.newEnd),
        ];
    }
  };

  return selectBlockChanges;
};

const getLineRefKey = (lineNumber: number, isBG: boolean) =>
  `${lineNumber}:${isBG ? 'bg' : 'main'}`;

const getTimeShiftLineIndexes = (
  context: StructuredReviewSelectionContext,
  block: Extract<ReviewReportBlock, { kind: 'timeShift' }>
) => {
  if (block.targetCount === block.totalLineCount) {
    return context.freeze.lyricLines.map((_, index) => index);
  }
  const lineRefKeys = new Set(block.lineRefs.map((ref) => getLineRefKey(ref.lineNumber, ref.isBG)));
  return context.freeze.lyricLines
    .map((line, index) => ({
      index,
      key: getLineRefKey(
        getDisplayNumber(line, index, context.freezeDisplayNumbers),
        line.isBG ?? false
      ),
    }))
    .filter((line) => lineRefKeys.has(line.key))
    .map((line) => line.index);
};

const createLineTarget = (
  lineIndexes: number[],
  totalLineCount: number
): StructuredReviewLineTarget | null => {
  const indexes = Array.from(
    new Set(
      lineIndexes.filter((index) => Number.isInteger(index) && index >= 0 && index < totalLineCount)
    )
  ).sort((left, right) => left - right);
  if (indexes.length === 0) return null;
  const isAll =
    indexes.length === totalLineCount && indexes.every((index, expected) => index === expected);
  if (isAll) {
    return {
      kind: 'all',
      lineCount: totalLineCount,
    };
  }
  const first = indexes[0];
  const last = indexes[indexes.length - 1];
  const isRange =
    first !== undefined &&
    last !== undefined &&
    indexes.every((index, offset) => index === first + offset);
  if (isRange && first !== undefined && last !== undefined) {
    return {
      kind: 'range',
      fromLineIndex: first,
      toLineIndex: last,
      lineCount: indexes.length,
    };
  }
  return {
    kind: 'lines',
    lineIndexes: indexes,
    lineCount: indexes.length,
  };
};

const createTimeShiftChange = (
  context: StructuredReviewSelectionContext,
  block: Extract<ReviewReportBlock, { kind: 'timeShift' }>,
  coveredLineIndexes: Set<number>
): StructuredReviewTimeShiftChange | null => {
  const lineIndexes = getTimeShiftLineIndexes(context, block).filter(
    (index) => !coveredLineIndexes.has(index)
  );
  const target = createLineTarget(lineIndexes, context.freeze.lyricLines.length);
  if (!target || block.offsetMs === 0) return null;
  for (const index of lineIndexes) {
    coveredLineIndexes.add(index);
  }
  return {
    kind: 'timeShift',
    offsetMs: block.offsetMs,
    target,
  };
};

const getChangeKey = (change: StructuredReviewChange) => {
  if (change.kind === 'path') return pathKey(change.path);
  return `timeShift:${change.offsetMs}:${JSON.stringify(change.target)}`;
};

const buildElementChangesFromReport = (
  freeze: TTMLLyric,
  staged: TTMLLyric,
  report: ReviewReport
): StructuredReviewChange[] => {
  const context: StructuredReviewSelectionContext = {
    freeze,
    staged,
    freezeDisplayNumbers: computeDisplayNumbers(freeze.lyricLines),
    stagedDisplayNumbers: computeDisplayNumbers(staged.lyricLines),
    elementChanges: buildElementChanges(freeze, staged),
  };
  const selectBlockChanges = createReportChangeSelector(context);
  const changes: StructuredReviewChange[] = [];
  const seen = new Set<string>();
  const coveredTimeShiftLineIndexes = new Set<number>();
  for (const block of report.blocks) {
    const blockChanges =
      block.kind === 'timeShift'
        ? [createTimeShiftChange(context, block, coveredTimeShiftLineIndexes)]
        : selectBlockChanges(block);
    for (const change of blockChanges) {
      if (!change) continue;
      const key = getChangeKey(change);
      if (seen.has(key)) continue;
      seen.add(key);
      changes.push(change);
    }
  }
  return changes;
};

const buildElementChanges = (
  freeze: TTMLLyric,
  staged: TTMLLyric
): StructuredReviewPathChange[] => {
  const changes: StructuredReviewPathChange[] = [];

  const addChange = (
    path: ReviewElementPath,
    before: unknown,
    after: unknown,
    beforeExists: boolean,
    afterExists: boolean
  ) => {
    const beforeValue = beforeExists ? toStructuredValue(before) : null;
    const afterValue = afterExists ? toStructuredValue(after) : null;
    const hasBefore = beforeExists && beforeValue !== null;
    const hasAfter = afterExists && afterValue !== null;
    if (!hasBefore && !hasAfter) return;
    changes.push({
      kind: 'path',
      path,
      beforeExists: hasBefore,
      afterExists: hasAfter,
      before: hasBefore ? beforeValue : null,
      after: hasAfter ? afterValue : null,
    });
  };

  const visit = (
    before: unknown,
    after: unknown,
    path: ReviewElementPath,
    beforeExists = true,
    afterExists = true
  ) => {
    if (beforeExists && afterExists && valuesEqual(before, after)) return;

    // 单侧存在：整棵子树作为一条原子变更（便于按行/按词选择接受）
    if (beforeExists !== afterExists) {
      addChange(path, before, after, beforeExists, afterExists);
      return;
    }

    const beforeArray = Array.isArray(before);
    const afterArray = Array.isArray(after);
    if (beforeArray && afterArray) {
      const length = Math.max(before.length, after.length);
      if (length === 0) {
        addChange(path, before, after, beforeExists, afterExists);
        return;
      }
      for (let index = 0; index < length; index += 1) {
        visit(
          before[index],
          after[index],
          [...path, index],
          index < before.length,
          index < after.length
        );
      }
      return;
    }

    const beforeObject = isContainer(before) && !beforeArray;
    const afterObject = isContainer(after) && !afterArray;
    if (beforeObject && afterObject) {
      const beforeRecord = before as Record<string, unknown>;
      const afterRecord = after as Record<string, unknown>;
      const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
      keys.delete('id');
      if (keys.size === 0) {
        addChange(path, before, after, beforeExists, afterExists);
        return;
      }
      for (const key of keys) {
        visit(
          beforeRecord[key],
          afterRecord[key],
          [...path, key],
          Object.hasOwn(beforeRecord, key),
          Object.hasOwn(afterRecord, key)
        );
      }
      return;
    }

    addChange(path, before, after, beforeExists, afterExists);
  };

  for (const key of new Set([...Object.keys(freeze), ...Object.keys(staged)])) {
    visit(
      freeze[key as keyof TTMLLyric],
      staged[key as keyof TTMLLyric],
      [key],
      Object.hasOwn(freeze, key),
      Object.hasOwn(staged, key)
    );
  }
  return changes;
};

const buildChangeBlocks = (
  elementChanges: StructuredReviewChange[]
): StructuredReviewChangeBlock[] => {
  const operationChanges: StructuredReviewTimeShiftChange[] = [];
  const lineChanges = new Map<number, StructuredReviewPathChange[]>();
  const documentChanges: StructuredReviewPathChange[] = [];
  for (const change of elementChanges) {
    if (change.kind !== 'path') {
      operationChanges.push(change);
      continue;
    }
    const lineIndex =
      change.path[0] === 'lyricLines' && typeof change.path[1] === 'number' ? change.path[1] : null;
    if (lineIndex === null) {
      documentChanges.push(change);
      continue;
    }
    const changes = lineChanges.get(lineIndex) ?? [];
    changes.push(change);
    lineChanges.set(lineIndex, changes);
  }

  const blocks: StructuredReviewChangeBlock[] = Array.from(lineChanges)
    .sort(([left], [right]) => left - right)
    .map(([, changes]) => ({
      kind: 'line' as const,
      changes,
    }));
  if (operationChanges.length > 0) {
    blocks.push({
      kind: 'operation',
      changes: operationChanges,
    });
  }
  if (documentChanges.length > 0) {
    blocks.push({
      kind: 'document',
      changes: documentChanges,
    });
  }
  return blocks;
};

export const buildStructuredReviewUpdates = (options: {
  freeze: TTMLLyric;
  staged: TTMLLyric;
  contentHash: string;
  report: ReviewReport;
}): StructuredReviewUpdates => {
  const reportHasBlocks = options.report.blocks.length > 0;
  const report = pruneReportForExport(options.report);
  const elementChanges = reportHasBlocks
    ? buildElementChangesFromReport(options.freeze, options.staged, report)
    : buildElementChanges(options.freeze, options.staged);
  return {
    version: 1,
    contentHash: options.contentHash,
    changes: {
      version: 1,
      report,
      blocks: buildChangeBlocks(elementChanges),
    },
  };
};
