import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import {
  DEFAULT_REVIEW_REPORT_EMPTY_TEXT,
  DEFAULT_REVIEW_REPORT_FORMAT,
  type ReviewReportBlockFormat,
  type ReviewReportBlockKind,
  type ReviewReportFormat,
  reviewReportFormatBlockDefinitions,
} from './format-template';
import type { ReviewReport, ReviewReportBlock, TimingField } from './types';

export type {
  ReviewReportBlockFormat,
  ReviewReportBlockKind,
  ReviewReportFormat,
  ReviewReportFormatBlockDefinition,
  ReviewReportFormatVariable,
} from './format-template';
export {
  DEFAULT_REVIEW_REPORT_EMPTY_TEXT,
  DEFAULT_REVIEW_REPORT_FORMAT,
  reviewReportFormatBlockDefinitions,
} from './format-template';

const cloneDefaultFormat = (): ReviewReportFormat => ({
  version: 1,
  emptyText: DEFAULT_REVIEW_REPORT_FORMAT.emptyText,
  blocks: Object.fromEntries(
    Object.entries(DEFAULT_REVIEW_REPORT_FORMAT.blocks).map(([kind, blockFormat]) => [
      kind,
      { ...blockFormat },
    ])
  ) as Record<ReviewReportBlockKind, ReviewReportBlockFormat>,
});

export const normalizeReviewReportFormat = (
  format: Partial<ReviewReportFormat> | null | undefined
): ReviewReportFormat => {
  const defaults = cloneDefaultFormat();
  if (!format || typeof format !== 'object') return defaults;
  const blocks = { ...defaults.blocks };
  for (const definition of reviewReportFormatBlockDefinitions) {
    const value = format.blocks?.[definition.kind];
    if (!value || typeof value !== 'object') continue;
    blocks[definition.kind] = {
      template:
        typeof value.template === 'string'
          ? value.template
          : defaults.blocks[definition.kind].template,
      listItem:
        typeof value.listItem === 'boolean'
          ? value.listItem
          : defaults.blocks[definition.kind].listItem,
    };
  }
  return {
    version: 1,
    emptyText: typeof format.emptyText === 'string' ? format.emptyText : defaults.emptyText,
    blocks,
  };
};

type ReviewReportFormatRecord =
  | {
      kind: ReviewReportBlockKind;
      template?: string;
      listItem?: boolean;
    }
  | {
      emptyText?: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isBlockKind = (value: unknown): value is ReviewReportBlockKind =>
  typeof value === 'string' &&
  reviewReportFormatBlockDefinitions.some((item) => item.kind === value);

const normalizeFormatRecords = (records: ReviewReportFormatRecord[]): ReviewReportFormat => {
  const next = cloneDefaultFormat();
  for (const record of records) {
    if ('emptyText' in record && typeof record.emptyText === 'string') {
      next.emptyText = record.emptyText;
      continue;
    }
    if (!('kind' in record) || !isBlockKind(record.kind)) continue;
    next.blocks[record.kind] = {
      template:
        typeof record.template === 'string' ? record.template : next.blocks[record.kind].template,
      listItem:
        typeof record.listItem === 'boolean' ? record.listItem : next.blocks[record.kind].listItem,
    };
  }
  return normalizeReviewReportFormat(next);
};

export const serializeReviewReportFormat = (format: ReviewReportFormat) =>
  JSON.stringify(normalizeReviewReportFormat(format), null, '\t');

export const serializeReviewReportFormatJsonl = (format: ReviewReportFormat) => {
  const normalized = normalizeReviewReportFormat(format);
  const records: ReviewReportFormatRecord[] = [
    { emptyText: normalized.emptyText },
    ...reviewReportFormatBlockDefinitions.map((definition) => ({
      kind: definition.kind,
      ...normalized.blocks[definition.kind],
    })),
  ];
  return records.map((record) => JSON.stringify(record)).join('\n');
};

export const parseReviewReportFormatText = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('模板文件为空');
  try {
    const value = JSON.parse(trimmed);
    if (Array.isArray(value)) {
      return normalizeFormatRecords(value.filter(isRecord) as ReviewReportFormatRecord[]);
    }
    if (isRecord(value)) {
      if ('kind' in value || 'emptyText' in value) {
        return normalizeFormatRecords([value as ReviewReportFormatRecord]);
      }
      return normalizeReviewReportFormat(value as Partial<ReviewReportFormat>);
    }
  } catch (error) {
    if (trimmed.includes('\n')) {
      const records = trimmed
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter(isRecord) as ReviewReportFormatRecord[];
      return normalizeFormatRecords(records);
    }
    throw error;
  }
  throw new Error('模板文件格式不正确');
};

const reviewReportFormatStorageAtom = atomWithStorage<ReviewReportFormat>(
  'reviewReportFormat',
  DEFAULT_REVIEW_REPORT_FORMAT
);

export const reviewReportFormatAtom = atom(
  (get) => normalizeReviewReportFormat(get(reviewReportFormatStorageAtom)),
  (
    get,
    set,
    update: ReviewReportFormat | ((current: ReviewReportFormat) => ReviewReportFormat)
  ) => {
    const current = normalizeReviewReportFormat(get(reviewReportFormatStorageAtom));
    const next = typeof update === 'function' ? update(current) : update;
    set(reviewReportFormatStorageAtom, normalizeReviewReportFormat(next));
  }
);

const wrap = (value: string | number) => `\`${value}\``;

const formatLineLabel = (lineNumber: number, isBG?: boolean) =>
  `第 ${lineNumber} 行${isBG ? '（背景）' : ''}`;

const formatLineLabelList = (items: Array<{ lineNumber: number; isBG?: boolean }>) => {
  const seen = new Set<string>();
  const list = items
    .filter((item) => {
      const key = `${item.lineNumber}:${item.isBG ? 'bg' : 'main'}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.lineNumber - b.lineNumber || Number(a.isBG) - Number(b.isBG));
  return list.map((item) => formatLineLabel(item.lineNumber, item.isBG)).join('、');
};

const createLineVariables = (lineNumber: number, isBG: boolean) => ({
  lineLabel: formatLineLabel(lineNumber, isBG),
  lineNumber: String(lineNumber),
  isBackground: String(isBG),
  backgroundLabel: isBG ? '（背景）' : '',
});

const buildTimingPart = (prefix: '起始' | '结束', oldTime: number, newTime: number) => {
  const delta = newTime - oldTime;
  if (delta === 0) return '';
  const speed = delta < 0 ? '提前' : '延后';
  return `${prefix}${speed}了 ${wrap(Math.abs(delta))} 毫秒`;
};

const buildTimingParts = (block: Extract<ReviewReportBlock, { kind: 'timing' }>) => {
  const fields = new Set<TimingField>(block.fields);
  const startTimingChange = fields.has('startTime')
    ? buildTimingPart('起始', block.oldStart, block.newStart)
    : '';
  const endTimingChange = fields.has('endTime')
    ? buildTimingPart('结束', block.oldEnd, block.newEnd)
    : '';
  return {
    startTimingChange,
    endTimingChange,
    timingChanges: [startTimingChange, endTimingChange].filter(Boolean).join('，'),
  };
};

const buildLineTimingParts = (block: Extract<ReviewReportBlock, { kind: 'lineTiming' }>) => {
  const lineStartTimingChange = buildTimingPart('起始', block.oldStart, block.newStart);
  const lineEndTimingChange = buildTimingPart('结束', block.oldEnd, block.newEnd);
  return {
    lineStartTimingChange,
    lineEndTimingChange,
    lineTimingChanges: [lineStartTimingChange, lineEndTimingChange].filter(Boolean).join('，'),
  };
};

export const createReviewReportBlockVariables = (
  block: ReviewReportBlock
): Record<string, string> | null => {
  switch (block.kind) {
    case 'manual':
      return { content: block.content };
    case 'wordTextShared':
      return {
        lineLabels: formatLineLabelList(block.lineRefs),
        oldWord: block.oldWord,
        newWord: block.newWord,
      };
    case 'wordTextGroup': {
      const enabledChanges = block.changes.filter((item) => item.enabled !== false);
      if (enabledChanges.length === 0) return null;
      const oldWords = enabledChanges.map((item) => item.oldWord);
      const newWords = enabledChanges.map((item) => item.newWord);
      return {
        ...createLineVariables(block.lineNumber, block.isBG),
        oldWords: oldWords.join('、'),
        newWords: newWords.join('、'),
        oldWordsCode: oldWords.map(wrap).join('、'),
        newWordsCode: newWords.map(wrap).join('、'),
      };
    }
    case 'wordText':
      return {
        ...createLineVariables(block.lineNumber, block.isBG),
        oldWord: block.oldWord,
        newWord: block.newWord,
      };
    case 'wordRoman':
      return {
        ...createLineVariables(block.lineNumber, block.isBG),
        word: block.word,
        oldRoman: block.oldRoman,
        newRoman: block.newRoman,
      };
    case 'lineTranslation':
    case 'lineRoman':
      return {
        ...createLineVariables(block.lineNumber, block.isBG),
        oldText: block.oldText,
        newText: block.newText,
      };
    case 'wordAndRoman':
      return {
        ...createLineVariables(block.lineNumber, block.isBG),
        oldWord: block.oldWord,
        newWord: block.newWord,
        oldRoman: block.oldRoman,
        newRoman: block.newRoman,
      };
    case 'wordAdded':
    case 'wordRemoved':
      return {
        ...createLineVariables(block.lineNumber, block.isBG),
        word: block.word,
      };
    case 'lineAdded':
    case 'lineRemoved':
      return {
        ...createLineVariables(block.lineNumber, block.isBG),
        text: block.text,
      };
    case 'timeShift': {
      const isAllLines = block.targetCount === block.totalLineCount && block.totalLineCount > 0;
      const lineLabels = formatLineLabelList(block.lineRefs);
      return {
        lineLabels,
        scopeLabel: isAllLines ? '全部歌词行' : lineLabels,
        offset: String(block.offsetMs),
        absoluteOffset: String(Math.abs(block.offsetMs)),
        direction: block.offsetMs < 0 ? '提前' : '延后',
        targetCount: String(block.targetCount),
        totalLineCount: String(block.totalLineCount),
      };
    }
    case 'timing': {
      const timingParts = buildTimingParts(block);
      if (!timingParts.timingChanges) return null;
      return {
        ...createLineVariables(block.lineNumber, block.isBG),
        word: block.word,
        ...timingParts,
        oldStart: String(block.oldStart),
        newStart: String(block.newStart),
        oldEnd: String(block.oldEnd),
        newEnd: String(block.newEnd),
        startDelta: String(block.newStart - block.oldStart),
        endDelta: String(block.newEnd - block.oldEnd),
      };
    }
    case 'lineTiming': {
      const lineTimingParts = buildLineTimingParts(block);
      if (!lineTimingParts.lineTimingChanges) return null;
      return {
        ...createLineVariables(block.lineNumber, block.isBG),
        ...lineTimingParts,
        oldLineStart: String(block.oldStart),
        newLineStart: String(block.newStart),
        oldLineEnd: String(block.oldEnd),
        newLineEnd: String(block.newEnd),
        lineStartDelta: String(block.newStart - block.oldStart),
        lineEndDelta: String(block.newEnd - block.oldEnd),
      };
    }
  }
};

export const renderReviewReportTemplate = (template: string, variables: Record<string, string>) =>
  template
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, name: string) => variables[name] ?? '');

const renderMarkdownListItem = (text: string) => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const [first = '', ...rest] = lines;
  return [`- ${first}`, ...rest.map((line) => `  ${line}`)].join('\n');
};

export const renderReviewReportBlock = (
  block: ReviewReportBlock,
  formatInput?: Partial<ReviewReportFormat> | null
) => {
  const format = normalizeReviewReportFormat(formatInput);
  const variables = createReviewReportBlockVariables(block);
  if (!variables) return '';
  const text = renderReviewReportTemplate(format.blocks[block.kind].template, variables).trim();
  return text;
};

type RenderedReviewReportPart = {
  block: ReviewReportBlock;
  text: string;
  listItem: boolean;
  variables: Record<string, string>;
};

type RenderedReviewReportOutput = {
  text: string;
  listItem: boolean;
  lineBreakBefore: boolean;
};

const getLineMergeCategory = (block: ReviewReportBlock) => {
  switch (block.kind) {
    case 'wordTextGroup':
    case 'wordText':
    case 'wordAdded':
    case 'wordRemoved':
    case 'lineAdded':
    case 'lineRemoved':
      return 'text';
    case 'lineTranslation':
      return 'translation';
    case 'lineRoman':
      return 'roman';
    case 'wordRoman':
    case 'wordAndRoman':
      return 'wordRoman';
    case 'timing':
      return 'timing';
    case 'lineTiming':
      return 'lineTiming';
    case 'manual':
    case 'wordTextShared':
    case 'timeShift':
      return null;
  }
};

const getLineMergeKey = (part: RenderedReviewReportPart) => {
  const { block } = part;
  if (!('lineNumber' in block) || !('isBG' in block)) return null;
  const category = getLineMergeCategory(block);
  if (!category) return null;
  return [
    category,
    block.lineNumber,
    block.isBG ? 'bg' : 'main',
    part.listItem ? 'list' : 'plain',
  ].join(':');
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const createStyledLineLabelPattern = (lineLabel: string) => {
  const escapedLineLabel = escapeRegExp(lineLabel);
  return [
    `\\*\\*\\*${escapedLineLabel}\\*\\*\\*`,
    `___${escapedLineLabel}___`,
    `\\*\\*${escapedLineLabel}\\*\\*`,
    `__${escapedLineLabel}__`,
    `\\*${escapedLineLabel}\\*`,
    `_${escapedLineLabel}_`,
    `~~${escapedLineLabel}~~`,
    `<strong>${escapedLineLabel}</strong>`,
    `<b>${escapedLineLabel}</b>`,
    `<em>${escapedLineLabel}</em>`,
    `<i>${escapedLineLabel}</i>`,
    `<u>${escapedLineLabel}</u>`,
    escapedLineLabel,
  ].join('|');
};

const stripLinePrefix = (text: string, lineLabel: string) => {
  const trimmed = text.trim();
  const lineLabelPattern = createStyledLineLabelPattern(lineLabel);
  const prefixPattern = new RegExp(
    `^((?:#{1,6}\\s*)?(?:${lineLabelPattern})(?:\\s*(?:[:：]|-\\s+)|\\s+))`,
    'i'
  );
  const matchedPrefix = trimmed.match(prefixPattern)?.[1];
  if (matchedPrefix) {
    const rest = trimmed.slice(matchedPrefix.length);
    const bodyPrefix = rest.match(/^\s*/)?.[0] ?? '';
    return {
      body: rest.trim(),
      bodyPrefix,
      prefix: matchedPrefix,
    };
  }
  if (trimmed.startsWith(lineLabel)) {
    const rest = trimmed.slice(lineLabel.length);
    const bodyPrefix = rest.match(/^[\s:：-]*/)?.[0] ?? '';
    return {
      body: rest.replace(/^[\s:：-]+/, '').trim(),
      bodyPrefix,
      prefix: `${lineLabel}：`,
    };
  }
  return { body: trimmed, bodyPrefix: '', prefix: null };
};

const getBodyPrefixLineIndent = (bodyPrefix: string) => {
  const normalizedPrefix = bodyPrefix.replace(/\r\n?/g, '\n');
  if (!normalizedPrefix.includes('\n')) return null;
  return normalizedPrefix.slice(normalizedPrefix.lastIndexOf('\n') + 1);
};

const renderMergedLineBodies = (prefix: string, bodyPrefix: string, bodies: string[]) => {
  const bodyIndent = getBodyPrefixLineIndent(bodyPrefix);
  if (bodyIndent !== null) {
    return `${prefix}\n${bodyIndent}${bodies.join(`\n${bodyIndent}`)}`;
  }
  return `${prefix}${bodies.join('；')}`;
};

const renderMergedLinePart = (parts: RenderedReviewReportPart[]) => {
  const [first] = parts;
  if (!first) return '';
  if (parts.length === 1) return first.text;
  const lineLabel = first.variables.lineLabel;
  if (!lineLabel) return first.text;
  const seen = new Set<string>();
  const strippedParts = parts.map((part) => stripLinePrefix(part.text, lineLabel));
  const bodies = strippedParts
    .map((part) => part.body)
    .filter((body) => {
      if (!body || seen.has(body)) return false;
      seen.add(body);
      return true;
    });
  if (bodies.length === 0) return first.text;
  const firstStrippedPart = strippedParts[0];
  return renderMergedLineBodies(
    firstStrippedPart?.prefix ?? `${lineLabel}：`,
    firstStrippedPart?.bodyPrefix ?? '',
    bodies
  );
};

const mergeRenderedLineParts = (
  parts: RenderedReviewReportPart[]
): RenderedReviewReportOutput[] => {
  const groups = new Map<string, { firstIndex: number; parts: RenderedReviewReportPart[] }>();
  const partKeys = parts.map((part, index) => {
    const key = getLineMergeKey(part);
    if (!key) return null;
    const group = groups.get(key);
    if (group) {
      group.parts.push(part);
    } else {
      groups.set(key, { firstIndex: index, parts: [part] });
    }
    return key;
  });
  return parts
    .map<RenderedReviewReportOutput | null>((part, index) => {
      const key = partKeys[index];
      if (!key) {
        return {
          text: part.text,
          listItem: part.listItem,
          lineBreakBefore: part.block.kind === 'manual' && part.block.lineBreakBefore === true,
        };
      }
      const group = groups.get(key);
      if (!group || group.firstIndex !== index) return null;
      return {
        text: renderMergedLinePart(group.parts),
        listItem: part.listItem,
        lineBreakBefore: false,
      };
    })
    .filter((part): part is RenderedReviewReportOutput => Boolean(part));
};

export const renderFormattedReviewReport = (
  report: ReviewReport,
  formatInput?: Partial<ReviewReportFormat> | null
) => {
  const format = normalizeReviewReportFormat(formatInput);
  const parts = report.blocks
    .filter((block) => block.enabled)
    .map<RenderedReviewReportPart | null>((block) => {
      const variables = createReviewReportBlockVariables(block);
      if (!variables) return null;
      const text = renderReviewReportTemplate(format.blocks[block.kind].template, variables).trim();
      if (!text) return null;
      return {
        block,
        text,
        listItem: format.blocks[block.kind].listItem,
        variables,
      };
    })
    .filter((part): part is RenderedReviewReportPart => Boolean(part));
  const mergedParts = mergeRenderedLineParts(parts).map((part) => ({
    ...part,
    text: part.listItem ? renderMarkdownListItem(part.text) : part.text,
  }));
  if (mergedParts.length === 0) return format.emptyText || DEFAULT_REVIEW_REPORT_EMPTY_TEXT;
  return mergedParts.reduce(
    (output, part, index) =>
      `${output}${index === 0 ? '' : part.lineBreakBefore ? '\n\n' : '\n'}${part.text}`,
    ''
  );
};

export const updateReviewReportBlockFormat = (
  format: ReviewReportFormat,
  kind: ReviewReportBlockKind,
  patch: Partial<ReviewReportBlockFormat>
) =>
  normalizeReviewReportFormat({
    ...format,
    blocks: {
      ...format.blocks,
      [kind]: {
        ...format.blocks[kind],
        ...patch,
      },
    },
  });

export const resetReviewReportBlockFormat = (
  format: ReviewReportFormat,
  kind: ReviewReportBlockKind
) => updateReviewReportBlockFormat(format, kind, DEFAULT_REVIEW_REPORT_FORMAT.blocks[kind]);
