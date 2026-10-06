import type { ReviewReport } from '$/modules/review/services/report-service/types';

/** 冻结原稿坐标系下的节点坐标，例如 ["lyricLines", 3, "words", 1, "word"]。 */
export type ReviewElementPath = Array<string | number>;

export type StructuredReviewValue =
  | string
  | number
  | boolean
  | null
  | StructuredReviewValue[]
  | { [key: string]: StructuredReviewValue };

/** path 定位的原子字段/节点变更。 */
export type StructuredReviewPathChange = {
  kind: 'path';
  path: ReviewElementPath;
  beforeExists: boolean;
  afterExists: boolean;
  before: StructuredReviewValue | null;
  after: StructuredReviewValue | null;
};

/** 冻结原稿坐标系下的大范围行目标。 */
export type StructuredReviewLineTarget =
  | {
      kind: 'all';
      lineCount: number;
    }
  | {
      kind: 'range';
      fromLineIndex: number;
      toLineIndex: number;
      lineCount: number;
    }
  | {
      kind: 'lines';
      lineIndexes: number[];
      lineCount: number;
    };

/** 大范围时间轴平移：应用到目标行、逐词及 ruby 的 start/end 时间。 */
export type StructuredReviewTimeShiftChange = {
  kind: 'timeShift';
  offsetMs: number;
  target: StructuredReviewLineTarget;
};

/**
 * 单条可独立接受的变更（云端 updates 协议最小单元）。
 * 普通编辑使用 path 变更；大范围操作使用操作变更，避免展开成大量 path。
 */
export type StructuredReviewChange = StructuredReviewPathChange | StructuredReviewTimeShiftChange;

/**
 * 变更分组：仅用于打包展示；path 变更的行归属由 path 前缀 lyricLines/<index> 推导。
 */
export type StructuredReviewChangeBlock =
  | {
      kind: 'line';
      changes: StructuredReviewPathChange[];
    }
  | {
      kind: 'document';
      changes: StructuredReviewPathChange[];
    }
  | {
      kind: 'operation';
      changes: StructuredReviewTimeShiftChange[];
    };

export type StructuredReviewChanges = {
  version: 1;
  /** 审阅文案报告（已剔除未启用 block）；与内容 diff 并列放在 updates 内。 */
  report: ReviewReport;
  blocks: StructuredReviewChangeBlock[];
};

/**
 * 云端约定：可回放变动只写在 updates 内。
 * contentHash 即文档身份（与派生 documentId 相同），不再单独存 documentId。
 */
export type StructuredReviewUpdates = {
  version: 1;
  contentHash: string;
  changes: StructuredReviewChanges;
};

export type StructuredReviewReportMetadata = {
  title: string;
  artist: string;
  submitter: string;
};

export type StructuredReviewReport = {
  original: string;
  modified: string;
  metadata: StructuredReviewReportMetadata;
  updates: StructuredReviewUpdates;
};
