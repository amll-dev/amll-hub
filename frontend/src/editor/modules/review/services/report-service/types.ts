export type WordChange = {
  wordId: string;
  lineNumber: number;
  wordIndex: number;
  isBG: boolean;
  oldWord: string;
  newWord: string;
  oldRoman: string;
  newRoman: string;
};

export type LineChange = {
  lineNumber: number;
  isBG: boolean;
  oldTrans: string;
  newTrans: string;
  oldRoman: string;
  newRoman: string;
};

export type WordPresenceChange = {
  wordId: string;
  lineNumber: number;
  wordIndex: number;
  isBG: boolean;
  word: string;
};

export type SyncChangeCandidate = {
  wordId: string;
  lineNumber: number;
  wordIndex: number;
  isBG: boolean;
  word: string;
  oldStart: number;
  newStart: number;
  oldEnd: number;
  newEnd: number;
};

export type LineTimingChangeCandidate = {
  lineId: string;
  lineNumber: number;
  isBG: boolean;
  oldStart: number;
  newStart: number;
  oldEnd: number;
  newEnd: number;
};

export type TimingField = 'startTime' | 'endTime';

export type TimingReportSelectionItem = {
  wordId: string;
  field: TimingField;
};

export type ReviewReportLineRef = {
  lineNumber: number;
  wordIndex?: number;
  isBG: boolean;
};

export type ReviewReportBlockBase = {
  id: string;
  enabled: boolean;
};

export type ReviewReportBlock =
  | (ReviewReportBlockBase & {
      kind: 'manual';
      content: string;
      lineBreakBefore?: boolean;
      beforeBlockKey?: string;
      afterBlockKey?: string;
    })
  | (ReviewReportBlockBase & {
      kind: 'wordTextShared';
      lineRefs: ReviewReportLineRef[];
      oldWord: string;
      newWord: string;
    })
  | (ReviewReportBlockBase & {
      kind: 'wordTextGroup';
      lineNumber: number;
      isBG: boolean;
      changes: Array<{
        wordId?: string;
        wordIndex?: number;
        oldWord: string;
        newWord: string;
        enabled?: boolean;
      }>;
    })
  | (ReviewReportBlockBase & {
      kind: 'wordText';
      wordId?: string;
      lineNumber: number;
      wordIndex?: number;
      isBG: boolean;
      oldWord: string;
      newWord: string;
    })
  | (ReviewReportBlockBase & {
      kind: 'wordRoman';
      wordId?: string;
      lineNumber: number;
      wordIndex?: number;
      isBG: boolean;
      word: string;
      oldRoman: string;
      newRoman: string;
    })
  | (ReviewReportBlockBase & {
      kind: 'lineTranslation';
      lineNumber: number;
      isBG: boolean;
      oldText: string;
      newText: string;
    })
  | (ReviewReportBlockBase & {
      kind: 'lineRoman';
      lineNumber: number;
      isBG: boolean;
      oldText: string;
      newText: string;
    })
  | (ReviewReportBlockBase & {
      kind: 'wordAndRoman';
      wordId?: string;
      lineNumber: number;
      wordIndex?: number;
      isBG: boolean;
      oldWord: string;
      newWord: string;
      oldRoman: string;
      newRoman: string;
    })
  | (ReviewReportBlockBase & {
      kind: 'wordAdded';
      wordId?: string;
      lineNumber: number;
      wordIndex?: number;
      isBG: boolean;
      word: string;
    })
  | (ReviewReportBlockBase & {
      kind: 'wordRemoved';
      wordId?: string;
      lineNumber: number;
      wordIndex?: number;
      isBG: boolean;
      word: string;
    })
  | (ReviewReportBlockBase & {
      kind: 'lineAdded';
      lineNumber: number;
      isBG: boolean;
      text: string;
    })
  | (ReviewReportBlockBase & {
      kind: 'lineRemoved';
      lineNumber: number;
      isBG: boolean;
      text: string;
    })
  | (ReviewReportBlockBase & {
      kind: 'timeShift';
      operationId: string;
      offsetMs: number;
      lineRefs: ReviewReportLineRef[];
      targetCount: number;
      totalLineCount: number;
    })
  | (ReviewReportBlockBase & {
      kind: 'timing';
      operationId?: string;
      wordId: string;
      lineNumber: number;
      wordIndex?: number;
      isBG: boolean;
      word: string;
      oldStart: number;
      newStart: number;
      oldEnd: number;
      newEnd: number;
      fields: TimingField[];
    })
  | (ReviewReportBlockBase & {
      kind: 'lineTiming';
      operationId?: string;
      lineId: string;
      lineNumber: number;
      isBG: boolean;
      oldStart: number;
      newStart: number;
      oldEnd: number;
      newEnd: number;
    });

export type ReviewReport = {
  version: 1;
  blocks: ReviewReportBlock[];
};

export type ReviewReportInput = ReviewReport | string | null | undefined;
