import type { EditorReviewRequirement } from '@/lib/types';
import type { LyricLine, LyricWord, TTMLLyric } from '$/types/ttml';
import { normalizeReviewReport } from './services/report-service/normalize-service';
import { renderReviewReportBlock } from './services/report-service/format-service';
import type {
  ReviewReportBlock,
  ReviewReportInput,
  ReviewReportLineRef,
  TimingField,
} from './services/report-service/types';

export type RequirementKind = 'metadata' | 'timing' | 'text' | 'overall';
export type RequirementStatus = 'done' | 'pending' | 'incorrect' | 'unknown';

export interface RequirementItem {
  key: string;
  text: string;
  kind: RequirementKind;
  lineNumber?: number;
  isBG?: boolean;
  wordIndex?: number;
  wordId?: string;
  metadataKey?: string;
  /** 自动判断当前内容是否已完成该要求；null 表示无法自动判断 */
  check?: (lyric: TTMLLyric) => RequirementStatus | null;
}

export interface ParsedRequirements {
  overall: RequirementItem[];
  lines: RequirementItem[];
}

/** 与大纲一致的显示行号：背景行沿用所属主行的行号 */
export const buildDisplayNumbers = (lines: LyricLine[]) => {
  const numbers: number[] = [];
  let current = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!i || !lines[i]?.isBG) current++;
    numbers.push(current);
  }
  return numbers;
};

/** 行号 + 背景标记 → 歌词行索引；行号对不上时退到最接近的一行 */
export const findLineIndex = (lines: LyricLine[], lineNumber: number, isBG?: boolean): number => {
  const numbers = buildDisplayNumbers(lines);
  return lines.findIndex(
    (line, index) => numbers[index] === lineNumber && Boolean(line.isBG) === Boolean(isBG)
  );
};

/** 仅用于跳转兜底：行号对不上时取最接近的一行；完成检测不会用它 */
export const findNearestLineIndex = (lines: LyricLine[], lineNumber: number): number => {
  const numbers = buildDisplayNumbers(lines);
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  lines.forEach((_, index) => {
    const distance = Math.abs((numbers[index] ?? 0) - lineNumber);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
};

const getLine = (lyric: TTMLLyric, lineNumber: number, isBG?: boolean): LyricLine | undefined => {
  const index = findLineIndex(lyric.lyricLines, lineNumber, isBG);
  return index >= 0 ? lyric.lyricLines[index] : undefined;
};

const getWord = (
  line: LyricLine | undefined,
  wordIndex?: number,
  wordId?: string
): LyricWord | undefined => {
  if (!line) return undefined;
  if (wordIndex != null && wordIndex >= 0) return line.words[wordIndex];
  if (wordId) return line.words.find((word) => word.id === wordId);
  return undefined;
};

/** 文字类：等于目标值算完成，仍等于原值算未修改，其余算改错 */
const compareText = (actual: string, oldText: string, newText: string): RequirementStatus => {
  if (actual === newText) return 'done';
  if (actual === oldText) return 'pending';
  return 'incorrect';
};

/** 时轴类：方向正确即算完成（提前/延后），不要求精确到目标毫秒 */
const compareTiming = (actual: number, oldTime: number, newTime: number): RequirementStatus => {
  if (Math.abs(actual - newTime) <= 1) return 'done';
  if (Math.abs(actual - oldTime) <= 1) return 'pending';

  const wantedDelta = newTime - oldTime;
  if (Math.abs(wantedDelta) <= 1) return 'pending';

  return Math.sign(actual - oldTime) === Math.sign(wantedDelta) ? 'done' : 'incorrect';
};

const combineStatuses = (statuses: RequirementStatus[]): RequirementStatus => {
  if (statuses.length === 0) return 'unknown';
  if (statuses.every((status) => status === 'done')) return 'done';
  if (statuses.every((status) => status === 'pending')) return 'pending';
  return 'incorrect';
};

const checkWordText =
  (
    lineNumber: number,
    isBG: boolean | undefined,
    wordIndex: number | undefined,
    wordId: string | undefined,
    oldWord: string,
    newWord: string
  ) =>
  (lyric: TTMLLyric) => {
    const line = getLine(lyric, lineNumber, isBG);
    const word = getWord(line, wordIndex, wordId);
    return word ? compareText(word.word, oldWord, newWord) : null;
  };

const checkWordRoman =
  (
    lineNumber: number,
    isBG: boolean | undefined,
    wordIndex: number | undefined,
    wordId: string | undefined,
    oldRoman: string,
    newRoman: string
  ) =>
  (lyric: TTMLLyric) => {
    const line = getLine(lyric, lineNumber, isBG);
    const word = getWord(line, wordIndex, wordId);
    return word ? compareText(word.romanWord, oldRoman, newRoman) : null;
  };

const checkWordAndRoman =
  (
    lineNumber: number,
    isBG: boolean | undefined,
    wordIndex: number | undefined,
    wordId: string | undefined,
    oldWord: string,
    newWord: string,
    oldRoman: string,
    newRoman: string
  ) =>
  (lyric: TTMLLyric) => {
    const line = getLine(lyric, lineNumber, isBG);
    const word = getWord(line, wordIndex, wordId);
    if (!word) return null;
    return combineStatuses([
      compareText(word.word, oldWord, newWord),
      compareText(word.romanWord, oldRoman, newRoman),
    ]);
  };

const checkTiming =
  (
    lineNumber: number,
    isBG: boolean | undefined,
    wordIndex: number | undefined,
    wordId: string | undefined,
    fields: TimingField[],
    oldStart: number,
    newStart: number,
    oldEnd: number,
    newEnd: number
  ) =>
  (lyric: TTMLLyric) => {
    const line = getLine(lyric, lineNumber, isBG);
    const word = getWord(line, wordIndex, wordId);
    if (!word) return null;
    return combineStatuses(
      fields.map((field) =>
        compareTiming(
          field === 'startTime' ? word.startTime : word.endTime,
          field === 'startTime' ? oldStart : oldEnd,
          field === 'startTime' ? newStart : newEnd
        )
      )
    );
  };

const checkLineTiming =
  (
    lineNumber: number,
    isBG: boolean | undefined,
    fields: TimingField[],
    oldStart: number,
    newStart: number,
    oldEnd: number,
    newEnd: number
  ) =>
  (lyric: TTMLLyric) => {
    const line = getLine(lyric, lineNumber, isBG);
    if (!line) return null;
    return combineStatuses(
      fields.map((field) =>
        compareTiming(
          field === 'startTime' ? line.startTime : line.endTime,
          field === 'startTime' ? oldStart : oldEnd,
          field === 'startTime' ? newStart : newEnd
        )
      )
    );
  };

/** 取出报告块对应的行引用 */
function getBlockLineRefs(block: ReviewReportBlock): ReviewReportLineRef[] {
  if (block.kind === 'timeShift') return block.lineRefs;
  if ('lineNumber' in block) {
    return [{ lineNumber: block.lineNumber, isBG: block.isBG }];
  }
  return [];
}

/** 时轴类条目跳打轴页，其余跳编辑页 */
function getBlockActionKind(block: ReviewReportBlock): 'timing' | 'text' {
  return block.kind === 'timing' || block.kind === 'lineTiming' ? 'timing' : 'text';
}

function renderBlockText(block: ReviewReportBlock): string {
  try {
    return renderReviewReportBlock(block).trim();
  } catch {
    // 历史报告结构异常时跳过该条，避免整个面板崩掉
    return '';
  }
}

/** 结构化报告 → 面板条目 */
function parseStructuredReport(review: EditorReviewRequirement): ParsedRequirements {
  const overall: RequirementItem[] = [];
  const lines: RequirementItem[] = [];
  const raw = review.structured ?? {};
  const candidate = raw.reviewReport ?? raw;
  const blocks = normalizeReviewReport(candidate as ReviewReportInput).blocks.filter(
    (block) => block.enabled !== false
  );

  blocks.forEach((block, index) => {
    const text = renderBlockText(block);
    if (!text) return;

    if (block.kind === 'metadata') {
      const items = block.items;
      overall.push({
        key: `block-${index}`,
        text,
        kind: 'metadata',
        metadataKey: block.key,
        check: (lyric) => {
          const values = lyric.metadata.find((item) => item.key === block.key)?.value ?? [];
          const matched = items.filter((item) => values.includes(item)).length;
          if (block.action === 'add') {
            if (matched === items.length) return 'done';
            if (matched === 0) return 'pending';
            return 'incorrect';
          }
          const removed = items.filter((item) => !values.includes(item)).length;
          if (removed === items.length) return 'done';
          if (removed === 0) return 'pending';
          return 'incorrect';
        },
      });
      return;
    }

    if (block.kind === 'manual' || block.kind === 'timeShift') {
      overall.push({ key: `block-${index}`, text, kind: 'overall' });
      return;
    }

    if (block.kind === 'wordTextGroup') {
      block.changes.forEach((change, changeIndex) => {
        if (change.enabled === false) return;
        const changeText = renderBlockText({
          ...block,
          id: `${block.id}-${changeIndex}`,
          changes: [change],
        });
        if (!changeText) return;
        lines.push({
          key: `block-${index}-${changeIndex}`,
          text: changeText,
          kind: 'text',
          lineNumber: block.lineNumber,
          isBG: block.isBG,
          wordIndex: change.wordIndex,
          wordId: change.wordId,
          check: checkWordText(
            block.lineNumber,
            block.isBG,
            change.wordIndex,
            change.wordId,
            change.oldWord,
            change.newWord
          ),
        });
      });
      return;
    }

    if (block.kind === 'wordTextShared') {
      block.lineRefs.forEach((ref, refIndex) => {
        const refText =
          renderBlockText({
            ...block,
            id: `${block.id}-${refIndex}`,
            lineRefs: [ref],
          }) || text;
        lines.push({
          key: `block-${index}-${refIndex}`,
          text: refText,
          kind: 'text',
          lineNumber: ref.lineNumber,
          isBG: ref.isBG,
          wordIndex: ref.wordIndex,
          check: checkWordText(
            ref.lineNumber,
            ref.isBG,
            ref.wordIndex,
            undefined,
            block.oldWord,
            block.newWord
          ),
        });
      });
      return;
    }

    const ref = getBlockLineRefs(block)[0];
    if (!ref) {
      overall.push({ key: `block-${index}`, text, kind: 'overall' });
      return;
    }

    const base = {
      key: `block-${index}`,
      text,
      lineNumber: ref.lineNumber,
      isBG: ref.isBG,
    };

    switch (block.kind) {
      case 'wordText':
        lines.push({
          ...base,
          kind: 'text',
          wordIndex: block.wordIndex,
          wordId: block.wordId,
          check: checkWordText(
            block.lineNumber,
            block.isBG,
            block.wordIndex,
            block.wordId,
            block.oldWord,
            block.newWord
          ),
        });
        break;
      case 'wordRoman':
        lines.push({
          ...base,
          kind: 'text',
          wordIndex: block.wordIndex,
          wordId: block.wordId,
          check: checkWordRoman(
            block.lineNumber,
            block.isBG,
            block.wordIndex,
            block.wordId,
            block.oldRoman,
            block.newRoman
          ),
        });
        break;
      case 'wordAndRoman':
        lines.push({
          ...base,
          kind: 'text',
          wordIndex: block.wordIndex,
          wordId: block.wordId,
          check: checkWordAndRoman(
            block.lineNumber,
            block.isBG,
            block.wordIndex,
            block.wordId,
            block.oldWord,
            block.newWord,
            block.oldRoman,
            block.newRoman
          ),
        });
        break;
      case 'lineTranslation':
        lines.push({
          ...base,
          kind: 'text',
          check: (lyric) => {
            const line = getLine(lyric, block.lineNumber, block.isBG);
            return line ? compareText(line.translatedLyric, block.oldText, block.newText) : null;
          },
        });
        break;
      case 'lineRoman':
        lines.push({
          ...base,
          kind: 'text',
          check: (lyric) => {
            const line = getLine(lyric, block.lineNumber, block.isBG);
            return line ? compareText(line.romanLyric, block.oldText, block.newText) : null;
          },
        });
        break;
      case 'wordAdded':
        lines.push({
          ...base,
          kind: 'text',
          wordIndex: block.wordIndex,
          wordId: block.wordId,
          check: (lyric) => {
            const line = getLine(lyric, block.lineNumber, block.isBG);
            if (!line) return null;
            if (block.wordIndex != null && line.words[block.wordIndex]?.word === block.word) {
              return 'done';
            }
            return line.words.some((word) => word.word === block.word) ? 'done' : 'pending';
          },
        });
        break;
      case 'wordRemoved':
        lines.push({
          ...base,
          kind: 'text',
          wordIndex: block.wordIndex,
          wordId: block.wordId,
          check: (lyric) => {
            const line = getLine(lyric, block.lineNumber, block.isBG);
            if (!line) return null;
            return line.words.some((word) => word.word === block.word) ? 'pending' : 'done';
          },
        });
        break;
      case 'lineAdded':
        lines.push({ ...base, kind: 'text' });
        break;
      case 'lineRemoved':
        lines.push({ ...base, kind: 'text' });
        break;
      case 'timing':
        lines.push({
          ...base,
          kind: 'timing',
          wordIndex: block.wordIndex,
          wordId: block.wordId,
          check: checkTiming(
            block.lineNumber,
            block.isBG,
            block.wordIndex,
            block.wordId,
            block.fields,
            block.oldStart,
            block.newStart,
            block.oldEnd,
            block.newEnd
          ),
        });
        break;
      case 'lineTiming':
        lines.push({
          ...base,
          kind: 'timing',
          check: checkLineTiming(
            block.lineNumber,
            block.isBG,
            ['startTime', 'endTime'],
            block.oldStart,
            block.newStart,
            block.oldEnd,
            block.newEnd
          ),
        });
        break;
      default:
        lines.push({ ...base, kind: getBlockActionKind(block) });
    }
  });

  return { overall, lines };
}

/** 纯文字意见 → 面板条目，尽量解析“第 N 行” */
function parseTextRequirement(text: string): ParsedRequirements {
  const overall: RequirementItem[] = [];
  const lines: RequirementItem[] = [];
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const cleaned = line.replace(/^[-*]\s+/, '').replace(/^#{1,6}\s*/, '');
      const kind: RequirementKind = /时轴|时间轴|打轴|毫秒|提前|延后/i.test(cleaned)
        ? 'timing'
        : 'text';
      const matches = [...cleaned.matchAll(/第\s*(\d+)\s*行/g)];
      if (matches.length === 0) {
        overall.push({ key: `text-${index}`, text: cleaned, kind: 'overall' });
        return;
      }
      const seen = new Set<number>();
      matches.forEach((match) => {
        const lineNumber = Number(match[1]);
        if (!Number.isFinite(lineNumber) || seen.has(lineNumber)) return;
        seen.add(lineNumber);
        lines.push({ key: `text-${index}-${lineNumber}`, text: cleaned, kind, lineNumber });
      });
    });
  return { overall, lines };
}

export function parseRequirement(review: EditorReviewRequirement): ParsedRequirements {
  if (review.source === 'report') {
    const parsed = parseStructuredReport(review);
    if (parsed.overall.length > 0 || parsed.lines.length > 0) return parsed;
  }
  const text = (review.comment || review.reportMd || '').trim();
  return text ? parseTextRequirement(text) : { overall: [], lines: [] };
}

export function getRequirementStatus(item: RequirementItem, lyric: TTMLLyric): RequirementStatus {
  if (!item.check) return 'unknown';
  return item.check(lyric) ?? 'unknown';
}

/** 统计未完成或改错的审核要求数量（无法自动判断的条目不计数） */
export function countIncompleteRequirements(
  review: EditorReviewRequirement | null | undefined,
  lyric: TTMLLyric
): number {
  if (!review) return 0;
  const { overall, lines } = parseRequirement(review);
  return [...overall, ...lines].filter((item) => {
    const status = getRequirementStatus(item, lyric);
    return status === 'pending' || status === 'incorrect';
  }).length;
}
