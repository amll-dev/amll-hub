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
  const gen = generateTTMLLyric(current);
  if (!gen.success) {
    return { ok: false, error: gen.error?.message ?? 'TTML 生成失败' };
  }
  const ttml = gen.data;

  const freeze = parseToEditorLyric(originalTtml);
  if (!freeze) {
    return {
      ok: true,
      bundle: { ttml, reportMd: manualNote, structured: emptyStructured() },
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

function parseToEditorLyric(ttml: string): TTMLLyric | null {
  const res = parseTTMLLyric(ttml);
  return res.success ? res.data : null;
}

/** 报告无法生成时的占位结构，保证后端拿到的 JSON 形状稳定 */
function emptyStructured(): Record<string, unknown> {
  return { version: 1, blocks: [] };
}
