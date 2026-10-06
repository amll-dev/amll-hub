import type {
  ReviewElementPath,
  StructuredReviewChange,
  StructuredReviewChangeBlock,
  StructuredReviewPathChange,
  StructuredReviewReport,
} from '$/types/structured-review-report';
import { pathKey } from '$/utils/content-addressed-id';
import { msToTimestamp } from '@/lib/format';

export type AnnotationDecision = 'pending' | 'accepted' | 'rejected';

export type AnnotationItem = {
  key: string;
  path: ReviewElementPath;
  /** 同一条 UI 批注可能对应多条 path 变更（如链接的词界）。 */
  paths: ReviewElementPath[];
  changes: StructuredReviewChange[];
  /** 冻结原稿坐标系下行索引；文档级变更无行归属。 */
  lineIndex: number | null;
  summary: string;
  kind: 'add' | 'remove' | 'update';
};

const FIELD_LABELS: Record<string, string> = {
  word: '歌词',
  romanWord: '音译',
  translatedLyric: '翻译',
  romanLyric: '行音译',
  startTime: '开始时间',
  endTime: '结束时间',
  isBG: '背景人声',
  isDuet: '对唱',
  emptyBeat: '空拍',
  obscene: '敏感词',
  agent: '演唱者',
  songPart: '段落',
  ignoreSync: '忽略打轴',
};

const previewValue = (value: unknown, max = 24): string => {
  if (value === null || value === undefined) return '（空）';
  if (typeof value === 'string') {
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (!trimmed) return '（空）';
    return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
  }
  if (typeof value === 'number') {
    // 时间字段在 summarize 里单独格式化；此处作通用数字
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }
  if (Array.isArray(value)) return `[${value.length} 项]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.word === 'string') return previewValue(record.word, max);
    if (typeof record.text === 'string') return previewValue(record.text, max);
    return '{…}';
  }
  return String(value);
};

const formatTime = (value: unknown): string => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return msToTimestamp(value);
  }
  return previewValue(value);
};

const leafName = (path: ReviewElementPath): string => {
  const last = path[path.length - 1];
  if (typeof last === 'string') return last;
  if (path.includes('words')) return '词';
  if (path[0] === 'lyricLines') return '行';
  return '内容';
};

const fieldLabel = (path: ReviewElementPath): string => {
  const leaf = leafName(path);
  return FIELD_LABELS[leaf] ?? leaf;
};

export const getChangeKind = (change: StructuredReviewChange): AnnotationItem['kind'] => {
  if (change.kind === 'timeShift') return 'update';
  if (!change.beforeExists && change.afterExists) return 'add';
  if (change.beforeExists && !change.afterExists) return 'remove';
  return 'update';
};

/** 词/行对象等是否值得在总结里写出具体文本 */
const isConcretePreview = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return typeof record.word === 'string' || typeof record.text === 'string';
  }
  return false;
};

/** 词级整词 path：lyricLines[i].words[j] */
export const isWholeWordPath = (path: ReviewElementPath): boolean =>
  path[0] === 'lyricLines' &&
  typeof path[1] === 'number' &&
  path[2] === 'words' &&
  typeof path[3] === 'number' &&
  path.length === 4;

export const getWordTextFromValue = (value: unknown): string => previewValue(value);

const summarizeTimeShiftChange = (
  change: Extract<StructuredReviewChange, { kind: 'timeShift' }>
) => {
  const direction = change.offsetMs < 0 ? '提前' : '延后';
  const offset = Math.abs(change.offsetMs);
  switch (change.target.kind) {
    case 'all':
      return `全部歌词行整体${direction} \`${offset}ms\``;
    case 'range':
      return `第 ${change.target.fromLineIndex + 1}-${change.target.toLineIndex + 1} 行整体${direction} \`${offset}ms\``;
    case 'lines':
      return `${change.target.lineCount} 行歌词整体${direction} \`${offset}ms\``;
  }
};

export const summarizeStructuredChange = (change: StructuredReviewChange): string => {
  if (change.kind === 'timeShift') return summarizeTimeShiftChange(change);
  const kind = getChangeKind(change);
  const field = leafName(change.path);
  const label = fieldLabel(change.path);
  if (kind === 'add') {
    if (
      field === 'word' ||
      field === '词' ||
      isWholeWordPath(change.path) ||
      typeof change.after === 'string' ||
      isConcretePreview(change.after)
    ) {
      return `添加了 \`${previewValue(change.after)}\``;
    }
    return `添加了${label}`;
  }
  if (kind === 'remove') {
    if (
      field === 'word' ||
      field === '词' ||
      isWholeWordPath(change.path) ||
      typeof change.before === 'string' ||
      isConcretePreview(change.before)
    ) {
      return `删除了 \`${previewValue(change.before)}\``;
    }
    return `删除了${label}`;
  }
  if (
    field === 'word' ||
    field === 'translatedLyric' ||
    field === 'romanLyric' ||
    field === 'romanWord'
  ) {
    return `将 \`${previewValue(change.before)}\` 改为 \`${previewValue(change.after)}\``;
  }
  if (field === 'startTime' || field === 'endTime') {
    return `调整${label}：\`${formatTime(change.before)}\` → \`${formatTime(change.after)}\``;
  }
  return `修改${label}：\`${previewValue(change.before)}\` → \`${previewValue(change.after)}\``;
};

export type AnnotationSummarySegment =
  { kind: 'text'; text: string } | { kind: 'code'; text: string };

/** 将 summary 中的 `code` 片段拆成可渲染段（反引号仅作标记，不展示）。 */
export const parseAnnotationSummary = (summary: string): AnnotationSummarySegment[] => {
  const segments: AnnotationSummarySegment[] = [];
  const re = /`([^`]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null = re.exec(summary);
  while (match) {
    if (match.index > last) {
      segments.push({ kind: 'text', text: summary.slice(last, match.index) });
    }
    segments.push({ kind: 'code', text: match[1] });
    last = match.index + match[0].length;
    match = re.exec(summary);
  }
  if (last < summary.length) {
    segments.push({ kind: 'text', text: summary.slice(last) });
  }
  return segments.length > 0 ? segments : [{ kind: 'text', text: summary }];
};

export const plainAnnotationSummary = (summary: string): string => summary.replace(/`/g, '');

export const getLineIndexFromPath = (path: ReviewElementPath): number | null =>
  path[0] === 'lyricLines' && typeof path[1] === 'number' ? path[1] : null;

/** 词级：words[i].endTime 与 words[i+1].startTime */
const isWordEndPath = (path: ReviewElementPath) =>
  path[0] === 'lyricLines' &&
  typeof path[1] === 'number' &&
  path[2] === 'words' &&
  typeof path[3] === 'number' &&
  path[4] === 'endTime' &&
  path.length === 5;

/** 行级：lyricLines[i].endTime 与 lyricLines[i+1].startTime */
const isLineEndPath = (path: ReviewElementPath) =>
  path[0] === 'lyricLines' &&
  typeof path[1] === 'number' &&
  path[2] === 'endTime' &&
  path.length === 3;

const sameAfterTime = (a: StructuredReviewChange, b: StructuredReviewChange) =>
  a.kind === 'path' &&
  b.kind === 'path' &&
  typeof a.after === 'number' &&
  typeof b.after === 'number' &&
  a.after === b.after;

/**
 * 合并因 endTime 链接产生的成对时轴变更，避免 UI 显示两条。
 * 数据层仍保留 end + 下一词/行 start 两条 path；展示只描述当前词/行的结束时间，
 * 链接的 start 调整隐式随接受一并应用。
 */
const coalesceLinkedTimingChanges = (changes: StructuredReviewPathChange[]): AnnotationItem[] => {
  const used = new Set<string>();
  const items: AnnotationItem[] = [];
  const byKey = new Map(changes.map((c) => [pathKey(c.path), c]));

  const tryPair = (
    left: StructuredReviewPathChange,
    rightPath: ReviewElementPath,
    summary: string
  ) => {
    const right = byKey.get(pathKey(rightPath));
    if (!right) return false;
    if (used.has(pathKey(left.path)) || used.has(pathKey(right.path))) return false;
    if (!sameAfterTime(left, right)) return false;
    if (getChangeKind(left) !== 'update' || getChangeKind(right) !== 'update') return false;
    const key = `${pathKey(left.path)}+${pathKey(right.path)}`;
    used.add(pathKey(left.path));
    used.add(pathKey(right.path));
    items.push({
      key,
      path: left.path,
      paths: [left.path, right.path],
      changes: [left, right],
      lineIndex: getLineIndexFromPath(left.path),
      summary,
      kind: 'update',
    });
    return true;
  };

  for (const change of changes) {
    const key = pathKey(change.path);
    if (used.has(key)) continue;

    if (isWordEndPath(change.path)) {
      const lineIndex = change.path[1] as number;
      const wordIndex = change.path[3] as number;
      const nextStart = [
        'lyricLines',
        lineIndex,
        'words',
        wordIndex + 1,
        'startTime',
      ] as ReviewElementPath;
      // 链接的下一词 startTime 仅隐式一并应用；UI 只说明当前词结束时间
      const paired = tryPair(change, nextStart, summarizeStructuredChange(change));
      if (paired) continue;
    }

    if (isLineEndPath(change.path)) {
      const lineIndex = change.path[1] as number;
      const nextStart = ['lyricLines', lineIndex + 1, 'startTime'] as Array<string | number>;
      // 链接的下一行 startTime 仅隐式一并应用；UI 只说明当前行结束时间
      const paired = tryPair(change, nextStart, summarizeStructuredChange(change));
      if (paired) continue;
    }

    // 若只扫到 start 侧且 end 侧未处理，留给 start 自己成条（end 已优先配对）
    used.add(key);
    items.push({
      key,
      path: change.path,
      paths: [change.path],
      changes: [change],
      lineIndex: getLineIndexFromPath(change.path),
      summary: summarizeStructuredChange(change),
      kind: getChangeKind(change),
    });
  }

  return items;
};

export const flattenAnnotationItems = (blocks: StructuredReviewChangeBlock[]): AnnotationItem[] => {
  const pathChanges = blocks.flatMap((block) => (block.kind === 'operation' ? [] : block.changes));
  const operationItems = blocks.flatMap((block) => {
    if (block.kind !== 'operation') return [];
    return block.changes.map<AnnotationItem>((change) => ({
      key: `operation:${change.kind}:${change.offsetMs}:${JSON.stringify(change.target)}`,
      path: ['lyricLines'],
      paths: [['lyricLines']],
      changes: [change],
      lineIndex: null,
      summary: summarizeStructuredChange(change),
      kind: 'update',
    }));
  });
  return [...operationItems, ...coalesceLinkedTimingChanges(pathChanges)];
};

export const buildAnnotationItemsFromReport = (report: StructuredReviewReport): AnnotationItem[] =>
  flattenAnnotationItems(report.updates.changes.blocks);
