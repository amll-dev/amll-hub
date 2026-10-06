import type { TTMLLyric } from '$/types/ttml';

/**
 * 审阅会话的冻结原稿身份。
 *
 * ID 一律「按需派生」：任何端都可用 contentHash + path 通过
 * `$/utils/content-addressed-id` 重算出同一个元素/行 ID，因此这里不持久化
 * 任何映射表——只留下 contentHash，以及会话内 rebind 需要的运行时行 id。
 */
export type ReviewStructuredLine = {
  lineIndex: number;
  /** 编辑器运行时行 id，仅会话内用于 rebind，不进入导出协议。 */
  sourceLineId: string;
};

export type ReviewStructuredSnapshot = {
  schemaVersion: 2;
  contentHash: string;
  lines: ReviewStructuredLine[];
};

export const createReviewStructuredSnapshot = (
  lyrics: TTMLLyric,
  contentHash: string
): ReviewStructuredSnapshot => ({
  schemaVersion: 2,
  contentHash,
  lines: lyrics.lyricLines.map((line, lineIndex) => ({
    lineIndex,
    sourceLineId: line.id,
  })),
});

export const rebindReviewStructuredSnapshot = (
  snapshot: ReviewStructuredSnapshot,
  lyrics: TTMLLyric
): ReviewStructuredSnapshot => ({
  ...snapshot,
  schemaVersion: 2,
  lines: snapshot.lines.map((line) => ({
    lineIndex: line.lineIndex,
    sourceLineId: lyrics.lyricLines[line.lineIndex]?.id ?? line.sourceLineId,
  })),
});
