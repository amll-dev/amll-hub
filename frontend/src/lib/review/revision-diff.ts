import type { LyricLine, Syllable, TTMLMetadata, TTMLResult } from '@/lib/ttml-processor';

export type LineChangeKind = 'unchanged' | 'modified' | 'added' | 'removed';

/** 单行时间戳偏移（毫秒） */
export interface TimingShift {
  kind: 'line' | 'word';
  /** 字序号，line 级为 -1 */
  index: number;
  text: string;
  from: number;
  to: number;
  /** to - from，正数表示延后 */
  delta: number;
}

/** 行级结构变化（翻译 / 音译 / 背景歌词 / 对唱）的结构化描述 */
export interface FeatureChange {
  kind: 'translation' | 'romanization' | 'background' | 'duet';
  /** 中文标签，用于报告模板与可视化 */
  label: string;
  before: string;
  after: string;
}

/** 单行差异 */
export interface LineDiff {
  kind: LineChangeKind;
  /** 原稿行号，added 时为 -1 */
  originalIndex: number;
  /** 修订稿行号，removed 时为 -1 */
  revisedIndex: number;
  originalText: string;
  revisedText: string;
  originalStart: number;
  revisedStart: number;
  /** 原稿行结束时间 */
  originalEnd: number;
  /** 修订稿行结束时间 */
  revisedEnd: number;
  /** 行起点偏移（ms） */
  startShift: number;
  /** 文本是否改动 */
  textChanged: boolean;
  /** 时间轴是否改动 */
  timingChanged: boolean;
  /** 逐字偏移明细（仅timingChanged 时非空） */
  shifts: TimingShift[];
  /** metadata 之外的结构变化：翻译/音译/背景歌词/对唱 */
  featureChanges: string[];
  /** 与 featureChanges 一一对应的结构化明细 */
  featureDetails: FeatureChange[];
  /** 逐字文本（仅 textChanged 时填充），供报告生成逐字定位 */
  originalWords?: string[];
  revisedWords?: string[];
  /** 背景歌词改动前后的文本（无背景时为 undefined） */
  backgroundText?: { before: string; after: string };
  /** 对唱归属改动前后的 agentId */
  agentText?: { before: string; after: string };
}

/** 元数据字段差异 */
export interface MetadataDiff {
  field: string;
  label: string;
  before: string;
  after: string;
}

/** 整体 diff 结果 */
export interface RevisionDiff {
  lines: LineDiff[];
  metadata: MetadataDiff[];
  stats: {
    originalLines: number;
    revisedLines: number;
    addedLines: number;
    removedLines: number;
    modifiedLines: number;
    unchangedLines: number;
    textChangedLines: number;
    timingChangedLines: number;
    /** 所有逐字偏移的平均绝对值（ms），仅统计有偏移的字 */
    meanAbsWordShift: number;
    /** 单字最大绝对偏移（ms） */
    maxAbsWordShift: number;
    /** 偏移超过阈值的字数 */
    shiftedWordCount: number;
    totalWordCount: number;
    /** 存在逻辑问题的行（时间倒序、无逐字时间轴等） */
    problemLineCount: number;
    problems: LineProblem[];
  };
}

export interface LineProblem {
  lineIndex: number;
  text: string;
  kind: 'reversed' | 'missing-words' | 'negative-time' | 'overlap' | 'no-translation';
  message: string;
}

/** 单字偏移超过该值（ms）计入「明显偏移」 */
const SHIFT_THRESHOLD_MS = 120;
/** 前后行间隔小于该值（ms）视为重叠 */
const OVERLAP_THRESHOLD_MS = 20;

/** 时间戳匹配容差（ms）：绝对值差小于此值视为同一时刻 */
const TIME_EPSILON = 5;

function timeClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= TIME_EPSILON;
}

function wordsOf(line: LyricLine | undefined): Syllable[] {
  return line?.words ?? [];
}

/** 收集一行的时间轴偏移明细 */
function collectShifts(before: LyricLine | undefined, after: LyricLine | undefined): TimingShift[] {
  const shifts: TimingShift[] = [];
  if (!before || !after) return shifts;

  if (!timeClose(before.startTime, after.startTime)) {
    shifts.push({
      kind: 'line',
      index: -1,
      text: after.text.slice(0, 20),
      from: before.startTime,
      to: after.startTime,
      delta: after.startTime - before.startTime,
    });
  }

  // 逐字对比只在字数一致时可靠，否则视为整体重排，不逐字报偏移
  const beforeWords = wordsOf(before);
  const afterWords = wordsOf(after);
  if (beforeWords.length && beforeWords.length === afterWords.length) {
    for (let i = 0; i < afterWords.length; i++) {
      const b = beforeWords[i];
      const a = afterWords[i];
      if (b && a && !timeClose(b.startTime, a.startTime)) {
        shifts.push({
          kind: 'word',
          index: i,
          text: a.text,
          from: b.startTime,
          to: a.startTime,
          delta: a.startTime - b.startTime,
        });
      }
    }
  }
  return shifts;
}

/** 检测一行的结构变化（翻译/音译/背景歌词/对唱） */
function collectFeatureChanges(
  before: LyricLine | undefined,
  after: LyricLine | undefined
): { labels: string[]; details: FeatureChange[] } {
  const details: FeatureChange[] = [];
  if (!before || !after) return { labels: [], details };

  const beforeTrans = (before.translations ?? []).map((t) => t.text).join('|');
  const afterTrans = (after.translations ?? []).map((t) => t.text).join('|');
  if (beforeTrans !== afterTrans) {
    details.push({
      kind: 'translation',
      label: '翻译',
      before: beforeTrans,
      after: afterTrans,
    });
  }

  const beforeRoman = (before.romanizations ?? []).map((r) => r.text).join('|');
  const afterRoman = (after.romanizations ?? []).map((r) => r.text).join('|');
  if (beforeRoman !== afterRoman) {
    details.push({
      kind: 'romanization',
      label: '音译',
      before: beforeRoman,
      after: afterRoman,
    });
  }

  const beforeBg = before.backgroundVocal?.text ?? '';
  const afterBg = after.backgroundVocal?.text ?? '';
  if (beforeBg !== afterBg) {
    details.push({ kind: 'background', label: '背景歌词', before: beforeBg, after: afterBg });
  }

  if ((before.agentId ?? '') !== (after.agentId ?? '')) {
    details.push({
      kind: 'duet',
      label: '对唱归属',
      before: before.agentId ?? '',
      after: after.agentId ?? '',
    });
  }

  // 兼容旧字段：纯文案列表，报告模板与旧测试都读它
  const labels = details.map((d) => {
    switch (d.kind) {
      case 'translation':
        return d.after ? '翻译已修改' : '翻译已删除';
      case 'romanization':
        return d.after ? '音译已修改' : '音译已删除';
      case 'background':
        return d.after ? '背景歌词已修改' : '背景歌词已删除';
      case 'duet':
        return '对唱归属已调整';
    }
  });
  return { labels, details };
}

/**
 * 行匹配：时间戳优先 → 文本次之→ 顺序兜底。
 *
 * 返回 [原稿行号, 修订行号] 配对数组，语义如下：
 *   [i, j]  两行配对
 *   [-1, j] 该修订行是新增（j 有效）
 *   [i, -1] 该原稿行被删除（i 有效）
 */
function pairLines(original: LyricLine[], revised: LyricLine[]): Array<[number, number]> {
  // 每个修订行先占位为「新增」，匹配成功后改写为真实原稿下标
  const pairs: Array<[number, number]> = revised.map((_, j) => [-1, j]);
  const usedOriginal = new Set<number>();

  // 第一轮：起点时间精确匹配
  const originalByTime = new Map<number, number[]>();
  original.forEach((line, i) => {
    const key = Math.round(line.startTime);
    const list = originalByTime.get(key) ?? [];
    list.push(i);
    originalByTime.set(key, list);
  });

  revised.forEach((line, j) => {
    const candidates = originalByTime.get(Math.round(line.startTime));
    if (!candidates) return;
    const free = candidates.find((i) => !usedOriginal.has(i));
    if (free === undefined) return;
    usedOriginal.add(free);
    pairs[j] = [free, j];
  });

  // 第二轮：剩余原稿按文本匹配
  const remaining = original.map((_, i) => i).filter((i) => !usedOriginal.has(i));
  const remainingByText = new Map<string, number[]>();
  for (const i of remaining) {
    const key = (original[i]?.text ?? '').trim();
    const list = remainingByText.get(key) ?? [];
    list.push(i);
    remainingByText.set(key, list);
  }

  revised.forEach((line, j) => {
    if (pairs[j]?.[0] !== -1) return;
    const key = (line.text ?? '').trim();
    const candidates = remainingByText.get(key);
    if (!candidates) return;
    const free = candidates.find((i) => !usedOriginal.has(i));
    if (free === undefined) return;
    usedOriginal.add(free);
    pairs[j] = [free, j];
  });

  // 第三轮：按剩余顺序兜底配对
  const freeOriginal = original.map((_, i) => i).filter((i) => !usedOriginal.has(i));
  let cursor = 0;
  revised.forEach((_, j) => {
    if (pairs[j]?.[0] !== -1) return;
    const i = freeOriginal[cursor++];
    if (i === undefined) return;
    usedOriginal.add(i);
    pairs[j] = [i, j];
  });

  // 未配对上的原稿行 =被删除
  for (const i of original.map((_, idx) => idx)) {
    if (!usedOriginal.has(i)) pairs.push([i, -1]);
  }
  return pairs;
}

/** 元数据字段的中文标签 */
/**
 * 平台 ID 的中文标签。
 *
 * ⚠️ `platformIds` 与 `rawProperties` 是**嵌套对象**，不能作为整体参与 diff ——
 * 之前它们被 `stableField` 压成 `ncmMusicId=123; qqMusicId=456` 这样一行，
 * 审核报告里既看不出改了哪个平台，label 还只写「平台 ID」。
 * 现在把平台 ID **摊平成独立字段**逐个比较。
 */
const PLATFORM_LABELS: Record<string, string> = {
  ncmMusicId: '网易云音乐 ID',
  qqMusicId: 'QQ 音乐 ID',
  spotifyId: 'Spotify 音乐 ID',
  appleMusicId: 'Apple Music ID',
};

const METADATA_LABELS: Record<string, string> = {
  title: '标题',
  artist: '歌手',
  album: '专辑',
  songwriters: '词作者',
  isrc: 'ISRC',
  authorIds: '作者 GitHub',
  authorNames: '作者昵称',
  language: '语言',
  timingMode: '时间轴模式',
  agents: '对唱角色',
};

/** 稳定序列化数组字段，保证 diff 可比较 */
function stableField(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map((v) => String(v)).join('、');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${stableField(v)}`)
      .join('; ');
  }
  return String(value);
}

function diffMetadata(before: TTMLMetadata, after: TTMLMetadata): MetadataDiff[] {
  const result: MetadataDiff[] = [];
  const push = (key: string, label: string, b: string, a: string) => {
    if (b === a) return;
    result.push({ field: key, label, before: b || '（空）', after: a || '（空）' });
  };

  // 1) 扁平字段：直接比较
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    // 嵌套的两个单独处理（下面摊平），不在这里整体比较
    if (key === 'platformIds' || key === 'rawProperties') continue;
    push(
      key,
      METADATA_LABELS[key] ?? key,
      stableField((before as Record<string, unknown>)[key]),
      stableField((after as Record<string, unknown>)[key])
    );
  }

  // 2) 平台 ID：摊平成 `platformIds.ncmMusicId` 这样的独立字段，
  //    这样审核报告里能明确看出「网易云音乐 ID 由 A 改成 B」。
  const bPlat = before?.platformIds ?? {};
  const aPlat = after?.platformIds ?? {};
  for (const p of new Set([...Object.keys(bPlat), ...Object.keys(aPlat)])) {
    push(
      `platformIds.${p}`,
      PLATFORM_LABELS[p] ?? p,
      stableField((bPlat as Record<string, unknown>)[p]),
      stableField((aPlat as Record<string, unknown>)[p])
    );
  }

  // 3) 自定义键：同样摊平，label 用键名本身
  const bRaw = before?.rawProperties ?? {};
  const aRaw = after?.rawProperties ?? {};
  for (const p of new Set([...Object.keys(bRaw), ...Object.keys(aRaw)])) {
    push(
      `rawProperties.${p}`,
      p,
      stableField((bRaw as Record<string, unknown>)[p]),
      stableField((aRaw as Record<string, unknown>)[p])
    );
  }

  return result;
}

/** 检查修订稿的逻辑问题 */
function findProblems(lines: LyricLine[]): LineProblem[] {
  const problems: LineProblem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const label = `${i + 1}`;
    if (line.startTime < 0) {
      problems.push({
        lineIndex: i,
        text: line.text,
        kind: 'negative-time',
        message: `第 ${label} 行时间为负值`,
      });
    }
    if (line.endTime < line.startTime) {
      problems.push({
        lineIndex: i,
        text: line.text,
        kind: 'reversed',
        message: `第 ${label} 行结束时间早于开始时间`,
      });
    }
    if (!line.words?.length) {
      problems.push({
        lineIndex: i,
        text: line.text,
        kind: 'missing-words',
        message: `第 ${label} 行缺少逐字时间轴`,
      });
    }
    const next = lines[i + 1];
    if (next && line.endTime > next.startTime + OVERLAP_THRESHOLD_MS) {
      problems.push({
        lineIndex: i,
        text: line.text,
        kind: 'overlap',
        message: `第 ${label} 行与下一行时间重叠`,
      });
    }
  }
  return problems;
}

/**
 * 计算原始投稿与修订版的完整差异
 */
export function computeRevisionDiff(original: TTMLResult, revised: TTMLResult): RevisionDiff {
  const pairs = pairLines(original.lines ?? [], revised.lines ?? []);

  const lines: LineDiff[] = [];
  let addedLines = 0;
  let removedLines = 0;
  let modifiedLines = 0;
  let unchangedLines = 0;
  let textChangedLines = 0;
  let timingChangedLines = 0;
  let totalWordCount = 0;
  let shiftedWordCount = 0;
  let shiftSum = 0;
  let maxAbsShift = 0;

  for (const [oi, ri] of pairs) {
    // pairLines 保证 ri 与 oi 至少有一个有效下标，这里兜底防御
    if (oi === -1 && ri === -1) continue;
    const before = oi >= 0 ? original.lines[oi] : undefined;
    const after = ri >= 0 ? revised.lines[ri] : undefined;

    if (!before && after) {
      addedLines++;
      totalWordCount += wordsOf(after).length;
      const features = collectFeatureChanges(undefined, after);
      lines.push({
        kind: 'added',
        originalIndex: -1,
        revisedIndex: ri,
        originalText: '',
        revisedText: after.text,
        originalStart: 0,
        revisedStart: after.startTime,
        originalEnd: 0,
        revisedEnd: after.endTime,
        startShift: 0,
        textChanged: true,
        timingChanged: false,
        shifts: [],
        featureChanges: features.labels,
        featureDetails: features.details,
        backgroundText:
          after.backgroundVocal?.text !== undefined
            ? { before: '', after: after.backgroundVocal.text }
            : undefined,
        originalWords: wordsOf(before).map((w) => w.text),
        revisedWords: wordsOf(after).map((w) => w.text),
      });
      continue;
    }
    if (before && !after) {
      removedLines++;
      totalWordCount += wordsOf(before).length;
      lines.push({
        kind: 'removed',
        originalIndex: oi,
        revisedIndex: -1,
        originalText: before.text,
        revisedText: '',
        originalStart: before.startTime,
        revisedStart: 0,
        originalEnd: before.endTime,
        revisedEnd: 0,
        startShift: 0,
        textChanged: true,
        timingChanged: false,
        shifts: [],
        featureChanges: [],
        featureDetails: [],
      });
      continue;
    }
    if (!before || !after) continue;

    const shifts = collectShifts(before, after);
    const features = collectFeatureChanges(before, after);
    const featureChanges = features.labels;
    const featureDetails = features.details;
    const textChanged = (before.text ?? '') !== (after.text ?? '');
    const timingChanged = shifts.length > 0;
    const kind: LineChangeKind =
      textChanged || timingChanged || featureChanges.length ? 'modified' : 'unchanged';

    if (kind === 'unchanged') unchangedLines++;
    else modifiedLines++;
    if (textChanged) textChangedLines++;
    if (timingChanged) timingChangedLines++;

    const beforeWordCount = wordsOf(before).length;
    const afterWordCount = wordsOf(after).length;
    totalWordCount += Math.max(beforeWordCount, afterWordCount);
    for (const s of shifts) {
      // 平均偏移只统计逐字：行级平移会被每个字重复计入，放进去会放大数值
      if (s.kind !== 'word') continue;
      const abs = Math.abs(s.delta);
      shiftSum += abs;
      if (abs > maxAbsShift) maxAbsShift = abs;
      if (abs > SHIFT_THRESHOLD_MS) shiftedWordCount++;
    }

    lines.push({
      kind,
      originalIndex: oi,
      revisedIndex: ri,
      originalText: before.text ?? '',
      revisedText: after.text ?? '',
      originalStart: before.startTime,
      revisedStart: after.startTime,
      originalEnd: before.endTime,
      revisedEnd: after.endTime,
      startShift: after.startTime - before.startTime,
      textChanged,
      timingChanged,
      shifts,
      featureChanges,
      featureDetails,
      originalWords: textChanged ? wordsOf(before).map((w) => w.text) : undefined,
      revisedWords: textChanged ? wordsOf(after).map((w) => w.text) : undefined,
      backgroundText: featureDetails.some((f) => f.kind === 'background')
        ? {
            before: before.backgroundVocal?.text ?? '',
            after: after.backgroundVocal?.text ?? '',
          }
        : undefined,
      agentText: featureDetails.some((f) => f.kind === 'duet')
        ? { before: before.agentId ?? '', after: after.agentId ?? '' }
        : undefined,
    });
  }

  const problems = findProblems(revised.lines ?? []);
  const shiftedSamples = lines.reduce(
    (n, l) => n + l.shifts.filter((s) => s.kind === 'word').length,
    0
  );

  return {
    lines,
    metadata: diffMetadata(original.metadata ?? {}, revised.metadata ?? {}),
    stats: {
      originalLines: original.lines?.length ?? 0,
      revisedLines: revised.lines?.length ?? 0,
      addedLines,
      removedLines,
      modifiedLines,
      unchangedLines,
      textChangedLines,
      timingChangedLines,
      meanAbsWordShift: shiftedSamples > 0 ? Math.round(shiftSum / shiftedSamples) : 0,
      maxAbsWordShift: Math.round(maxAbsShift),
      shiftedWordCount,
      totalWordCount,
      problemLineCount: problems.length,
      problems,
    },
  };
}
