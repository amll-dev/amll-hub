import {
  type ReviewReportFormat,
  renderFormattedReviewReport,
  renderReviewReportBlock,
} from './format-service';
import { normalizeReportText, normalizeReviewReport } from './normalize-service';
import type { ReviewReportBlock, ReviewReportInput } from './types';

export const getReviewReportBlockText = (
  block: ReviewReportBlock,
  format?: Partial<ReviewReportFormat> | null
) => renderReviewReportBlock(block, format);

export const getReviewReportBlockLabel = (block: ReviewReportBlock) => {
  switch (block.kind) {
    case 'manual':
      return '手写内容';
    case 'wordTextShared':
    case 'wordTextGroup':
    case 'wordText':
    case 'wordAdded':
    case 'wordRemoved':
      return '歌词文本';
    case 'wordRoman':
    case 'lineRoman':
    case 'wordAndRoman':
      return '音译';
    case 'lineTranslation':
      return '翻译';
    case 'lineAdded':
    case 'lineRemoved':
      return '歌词行';
    case 'timeShift':
      return '时轴平移';
    case 'timing':
      return '时轴';
    case 'lineTiming':
      return '行时轴修正';
  }
};

export const renderReviewReport = (
  report: ReviewReportInput,
  format?: Partial<ReviewReportFormat> | null
) => {
  const normalized = normalizeReviewReport(report);
  return renderFormattedReviewReport(normalized, format);
};

export const hasReviewReportContent = (
  report: ReviewReportInput,
  format?: Partial<ReviewReportFormat> | null
) => {
  return normalizeReviewReport(report).blocks.some(
    (block) => block.enabled && normalizeReportText(getReviewReportBlockText(block, format))
  );
};
