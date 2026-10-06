import { DEFAULT_REVIEW_REPORT_EMPTY_TEXT } from './format-template';
import type { ReviewReport, ReviewReportBlock, ReviewReportInput } from './types';

export const DEFAULT_REVIEW_REPORT_TEXT = DEFAULT_REVIEW_REPORT_EMPTY_TEXT;

export const createReviewReportBlockId = (() => {
  let nextId = 0;
  return (prefix: string) => {
    nextId += 1;
    return `${prefix}-${Date.now().toString(36)}-${nextId.toString(36)}`;
  };
})();

export const createReviewReport = (blocks: ReviewReportBlock[] = []): ReviewReport => ({
  version: 1,
  blocks,
});

export function normalizeReportText(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === DEFAULT_REVIEW_REPORT_TEXT) return '';
  return trimmed;
}

export const createManualReviewReport = (content: string): ReviewReport => {
  const trimmed = normalizeReportText(content);
  if (!trimmed) return createReviewReport();
  return createReviewReport([
    {
      id: createReviewReportBlockId('manual'),
      kind: 'manual',
      content: trimmed,
      lineBreakBefore: false,
      enabled: true,
    },
  ]);
};

export const isReviewReport = (value: unknown): value is ReviewReport => {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as Partial<ReviewReport>;
  return maybe.version === 1 && Array.isArray(maybe.blocks);
};

export const normalizeReviewReport = (report: ReviewReportInput): ReviewReport => {
  if (isReviewReport(report)) {
    return createReviewReport(report.blocks ?? []);
  }
  if (typeof report === 'string') {
    return createManualReviewReport(report);
  }
  return createReviewReport();
};

export const normalizeReport = normalizeReportText;
