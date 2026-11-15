import type { LyricLine, LyricWord, TTMLLyric } from '$/types/ttml';

const DISPLAY_ID_KEY_PREFIX = 'id:';
const DISPLAY_INDEX_KEY_PREFIX = 'index:';

const getStableId = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const buildIdCounts = <T extends { id?: string }>(items: T[]) => {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const id = getStableId(item.id);
    if (!id) return;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  });
  return counts;
};

const getUniqueIdKey = (id: string | undefined, counts: Map<string, number>) => {
  const stableId = getStableId(id);
  if (!stableId || counts.get(stableId) !== 1) return null;
  return `${DISPLAY_ID_KEY_PREFIX}${stableId}`;
};

const getIndexKey = (index: number) => `${DISPLAY_INDEX_KEY_PREFIX}${index}`;

export const computeDisplayNumbers = (lines: LyricLine[]) => {
  let current = 0;
  const map = new Map<string, number>();
  const lineIdCounts = buildIdCounts(lines);
  lines.forEach((line, index) => {
    if (index === 0 || !line.isBG) {
      current += 1;
    }
    map.set(getIndexKey(index), current);
    const idKey = getUniqueIdKey(line.id, lineIdCounts);
    if (idKey) {
      map.set(idKey, current);
    }
  });
  return map;
};

export const buildLineMap = (lines: LyricLine[]) => {
  const map = new Map<string, LyricLine>();
  const lineIdCounts = buildIdCounts(lines);
  lines.forEach((line) => {
    const id = getStableId(line.id);
    if (id && lineIdCounts.get(id) === 1) {
      map.set(id, line);
    }
  });
  return map;
};

export const buildWordMap = (words: LyricWord[]) => {
  const map = new Map<string, LyricWord>();
  const wordIdCounts = buildIdCounts(words);
  words.forEach((word) => {
    const id = getStableId(word.id);
    if (id && wordIdCounts.get(id) === 1) {
      map.set(id, word);
    }
  });
  return map;
};

export const getLineText = (line: LyricLine) =>
  line.words.map((word) => word.word ?? '').join('') || '（空白）';

export const getWordText = (word: LyricWord) => word.word || '（空白）';

export const getDisplayNumber = (
  line: LyricLine,
  index: number,
  displayNumbers: Map<string, number>
) => {
  const stableId = getStableId(line.id);
  const idValue = stableId ? displayNumbers.get(`${DISPLAY_ID_KEY_PREFIX}${stableId}`) : undefined;
  return idValue ?? displayNumbers.get(getIndexKey(index)) ?? index + 1;
};

export const getLineNumber = (
  line: LyricLine,
  index: number,
  primary: Map<string, number>,
  fallback?: Map<string, number>
) => {
  const stableId = getStableId(line.id);
  const idKey = stableId ? `${DISPLAY_ID_KEY_PREFIX}${stableId}` : null;
  return (
    (idKey ? primary.get(idKey) : undefined) ??
    (idKey ? fallback?.get(idKey) : undefined) ??
    primary.get(getIndexKey(index)) ??
    fallback?.get(getIndexKey(index)) ??
    index + 1
  );
};

export interface AlignedLyricLine {
  /** freeze（基准稿）侧行下标 */
  index: number;
  freezeLine: LyricLine;
  /** 对齐到的 staged 行；未对齐到表示该行被删除 */
  stagedLine?: LyricLine;
  lineNumber: number;
  isBG: boolean;
}

/**
 * freeze ↔ staged 的歌词行对齐：**id 优先、位置兜底**，且每条 staged 行只能用一次。
 *
 * 这段逻辑原来在 `sync-report-builder`（两份）和 `edit-report-builder`（一份）
 * 里逐字重复，一次保存会把同一套对齐算三遍。改这里等于同时改三处，
 * 也避免出现「某处改了兜底策略、另一处没改」这种最难查的差异。
 *
 * `computeDisplayNumbers` 的结果由调用方传入：同一份歌词只算一次。
 */
export function alignLyricLines(
  freeze: TTMLLyric,
  staged: TTMLLyric,
  displayMaps: { freeze: Map<string, number>; staged: Map<string, number> }
): AlignedLyricLine[] {
  const stagedLineMap = buildLineMap(staged.lyricLines);
  const matchedStagedLines = new Set<LyricLine>();
  return freeze.lyricLines.map((freezeLine, index) => {
    const foundStagedById = stagedLineMap.get(freezeLine.id ?? '');
    const stagedById =
      foundStagedById && !matchedStagedLines.has(foundStagedById) ? foundStagedById : undefined;
    const fallbackLine = staged.lyricLines[index];
    const stagedLine =
      stagedById ??
      (fallbackLine && !matchedStagedLines.has(fallbackLine) ? fallbackLine : undefined);
    if (stagedLine) matchedStagedLines.add(stagedLine);
    return {
      index,
      freezeLine,
      stagedLine,
      lineNumber: getLineNumber(freezeLine, index, displayMaps.freeze, displayMaps.staged),
      isBG: freezeLine.isBG ?? stagedLine?.isBG ?? false,
    };
  });
}
