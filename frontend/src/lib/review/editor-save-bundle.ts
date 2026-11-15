import { buildReviewReportFromDiffs } from '@/editor/modules/review/services/report-service/edit-report-builder';
import { mergeReports } from '@/editor/modules/review/services/report-service/merge-service';
import { buildMetadataChanges } from '@/editor/modules/review/services/report-service/metadata-report-builder';
import { createReviewReport } from '@/editor/modules/review/services/report-service/normalize-service';
import { renderReviewReport } from '@/editor/modules/review/services/report-service/render-service';
import {
  buildLineTimingChanges,
  buildSyncChanges,
  buildSyncReport,
} from '@/editor/modules/review/services/report-service/sync-report-builder';
import { generateTTMLLyric, parseTTMLLyric } from '@/editor/modules/ttml-processor/index.ts';
import type { TTMLLyric } from '@/editor/types/ttml';

/** 编辑器对外暴露的保存产物 */
export interface EditorSaveBundle {
  /** 导出的 TTML 文本（提交修订版用） */
  ttml: string;
  /** 审核报告 Markdown（后端 `reportMd` 字段） */
  reportMd: string;
  /** 结构化报告（后端 `structured` 字段），存 JSON 便于后续统计 */
  structured: Record<string, unknown>;
}

export interface InvalidWordTiming {
  /** 展示用行号（与编辑器大纲一致，背景行不单独计数） */
  lineNumber: number;
  /** 词在该行内的序号（从 1 开始） */
  wordIndex: number;
  word: string;
}

/**
 * 找出 `endTime <= startTime` 的词。
 *
 * 频谱渲染会把这些词过滤掉（0 宽度没法交互），但导出 TTML 用的是原始数据，
 * 于是它们「看不见但还在文件里」——播放到这一句会卡住不亮，用户也没有
 * 任何入口发现。这里只做提示，不阻断保存。
 */
export function findInvalidWordTimings(lyric: TTMLLyric): InvalidWordTiming[] {
  const result: InvalidWordTiming[] = [];
  let displayNumber = 0;
  lyric.lyricLines.forEach((line, index) => {
    if (index === 0 || !line.isBG) displayNumber += 1;
    line.words.forEach((word, wordIndex) => {
      if (word.endTime <= word.startTime) {
        result.push({ lineNumber: displayNumber, wordIndex: wordIndex + 1, word: word.word });
      }
    });
  });
  return result;
}

/** 编辑器导出的 TTML 结果 */
export type EditorTtmlResult = { ok: true; ttml: string } | { ok: false; error: string };

/** 只导出 TTML（投稿者保存用，不生成审核报告） */
export function buildEditorTtml(current: TTMLLyric): EditorTtmlResult {
  const gen = generateTTMLLyric(current);
  if (!gen.success) {
    return { ok: false, error: gen.error?.message ?? 'TTML 生成失败' };
  }
  return { ok: true, ttml: gen.data };
}

/**
 * 从原始投稿与当前编辑状态，产出保存所需的三件套。
 *
 * @param originalTtml 投稿的原始 TTML 文本（后端存的）
 * @param current     编辑器当前的歌词状态
 * @param manualNote  审核员手写的话（拼在报告末尾）
 * @returns 失败时返回 error，调用方据此提示
 */
export function buildEditorSaveBundle(
  originalTtml: string,
  current: TTMLLyric,
  manualNote = ''
): { ok: true; bundle: EditorSaveBundle } | { ok: false; error: string } {
  // 1. 导出 TTML
  const gen = buildEditorTtml(current);
  if (!gen.ok) {
    return { ok: false, error: gen.error };
  }
  const ttml = gen.ttml;

  const freeze = parseToEditorLyric(originalTtml);
  if (!freeze) {
    // 原稿解析失败时不能静默产出「格式合法但内容为空」的报告：
    // 审核员的所有改动都会从报告里消失，且 UI 不会有任何提示。
    return {
      ok: false,
      error: '原稿 TTML 解析失败，无法生成审核报告，请人工核对原稿后再提交',
    };
  }
  const wordTimingChanges = buildSyncChanges(freeze, current);
  const lineTimingChanges = buildLineTimingChanges(freeze, current);
  const report = buildReviewReportFromDiffs(
    [],
    freeze,
    current,
    buildSyncReport(wordTimingChanges, lineTimingChanges)
  );

  const metadataBlocks = buildMetadataChanges(freeze, current);
  const finalReport =
    metadataBlocks.length > 0 ? mergeReports([report, createReviewReport(metadataBlocks)]) : report;

  let reportMd = renderReviewReport(finalReport);
  if (manualNote.trim()) {
    reportMd = `${reportMd}\n\n---\n\n${manualNote.trim()}`;
  }

  return {
    ok: true,
    bundle: {
      ttml,
      reportMd,
      structured: { ...emptyStructured(), reviewReport: finalReport },
    },
  };
}

/**
 * 原稿 TTML 在一次编辑会话里不会变，WASM 解析结果只需要算一次。
 *
 * 用单条缓存而不是 Map：同时只有一份原稿在用，避免随打开过的稿件在内存里累积。
 * 下游 buildSyncChanges / buildLineTimingChanges / buildEditReport / buildMetadataChanges
 * 对 freeze 全是只读遍历（读 id、时间、文本，构建 Map），不会回写，复用是安全的。
 */
let cachedFreeze: { ttml: string; lyric: TTMLLyric | null } | null = null;

function parseToEditorLyric(ttml: string): TTMLLyric | null {
  if (cachedFreeze?.ttml === ttml) return cachedFreeze.lyric;
  const res = parseTTMLLyric(ttml);
  const lyric = res.success ? res.data : null;
  cachedFreeze = { ttml, lyric };
  return lyric;
}

/** 报告无法生成时的占位结构，保证后端拿到的 JSON 形状稳定 */
function emptyStructured(): Record<string, unknown> {
  return { version: 1, blocks: [] };
}
