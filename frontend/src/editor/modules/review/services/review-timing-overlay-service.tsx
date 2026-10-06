import { useAtomValue, useSetAtom } from 'jotai';
import { type CSSProperties, useCallback, useMemo } from 'react';
import { createReviewLineTimingOperation } from '$/modules/review/services/operation-log-service';
import type {
  TimingField,
  TimingReportSelectionItem,
} from '$/modules/review/services/report-service/types';
import type { ProcessedLyricLine } from '$/modules/segmentation/utils/segment-processing.ts';
import {
  createLyricTimelineAuxiliaryDividerRenderer,
  type LyricTimelineAuxiliaryDivider,
  type LyricTimelineOverlayLineRenderer,
} from '$/modules/spectrogram/components/LyricTimelineOverlay.tsx';
import {
  previewLineAtom,
  selectedWordIdAtom,
  timelineDragAtom,
} from '$/modules/spectrogram/states/dnd.ts';
import { commitUpdatedLine } from '$/modules/spectrogram/utils/timeline-mutations.ts';
import {
  pushReviewOperationAtom,
  reviewFreezeAtom,
  reviewSessionAtom,
  selectedWordsAtom,
} from '$/states/main';

const buildReviewTimingDividerKey = (wordId: string, field: TimingField) => `${wordId}:${field}`;

const REVIEW_TIMING_START_DIVIDER_PENDING_STYLE = {
  '--timeline-auxiliary-divider-color': 'var(--blue-9)',
  opacity: 0.72,
} as CSSProperties;

const REVIEW_TIMING_END_DIVIDER_PENDING_STYLE = {
  '--timeline-auxiliary-divider-color': 'var(--green-9)',
  opacity: 0.72,
} as CSSProperties;

const REVIEW_TIMING_LINE_BOUNDARY_STYLE = {
  '--timeline-auxiliary-divider-color': 'var(--amber-9)',
  opacity: 0.62,
} as CSSProperties;

const getReviewTimingDividerStyle = (field: TimingField) => {
  return field === 'startTime'
    ? REVIEW_TIMING_START_DIVIDER_PENDING_STYLE
    : REVIEW_TIMING_END_DIVIDER_PENDING_STYLE;
};

const REVIEW_TIMING_MIN_DIVIDER_WIDTH_PX = 15;
const REVIEW_TIMING_MIN_WORD_DURATION_MS = 10;
const REVIEW_TIMING_START_HANDLE_OFFSET_PX = 8;
const REVIEW_TIMING_END_HANDLE_OFFSET_PX = -8;

const getReviewLineBoundaryDetachPreview = (
  line: ProcessedLyricLine,
  wordId: string,
  field: TimingField,
  newTime: number,
  zoom: number
) => {
  // Ctrl 拖拽合并边界时只改词首/词尾，不改行首/行尾；这个特殊行为只属于审阅现场。
  const segmentIndex = line.segments.findIndex(
    (segment) => segment.type === 'word' && segment.id === wordId
  );
  if (segmentIndex < 0) return line;

  const segment = line.segments[segmentIndex];
  if (segment.type !== 'word') return line;

  const minVisualDurationMs = (REVIEW_TIMING_MIN_DIVIDER_WIDTH_PX / zoom) * 1000;
  const minDurationMs = Math.max(REVIEW_TIMING_MIN_WORD_DURATION_MS, minVisualDurationMs);
  const nextSegments = [...line.segments];

  if (field === 'startTime') {
    if (segmentIndex !== 0) return line;
    const clampedTime = Math.min(
      Math.max(newTime, line.startTime),
      segment.endTime - minDurationMs
    );
    nextSegments[segmentIndex] = {
      ...segment,
      startTime: clampedTime,
    };
  } else {
    if (segmentIndex !== line.segments.length - 1) return line;
    const clampedTime = Math.max(
      Math.min(newTime, line.endTime),
      segment.startTime + minDurationMs
    );
    nextSegments[segmentIndex] = {
      ...segment,
      endTime: clampedTime,
    };
  }

  return {
    ...line,
    segments: nextSegments,
  };
};

export const useReviewSpectrogramTimingOverlay = () => {
  const reviewSession = useAtomValue(reviewSessionAtom);
  const reviewFreeze = useAtomValue(reviewFreezeAtom);
  const selectedWordId = useAtomValue(selectedWordIdAtom);
  const setSelectedWords = useSetAtom(selectedWordsAtom);
  const setPreviewLine = useSetAtom(previewLineAtom);
  const setTimelineDrag = useSetAtom(timelineDragAtom);
  const pushReviewOperation = useSetAtom(pushReviewOperationAtom);

  const activeReviewSession =
    reviewSession && reviewSession.source !== 'update' ? reviewSession : null;

  const commitReviewTimingLine = useCallback(
    (
      beforeLine: ProcessedLyricLine,
      updatedLine: ProcessedLyricLine,
      reportItems: TimingReportSelectionItem[] = []
    ) => {
      const operation = createReviewLineTimingOperation({
        beforeLine,
        afterLine: updatedLine,
        reportItems,
      });
      if (!operation) return;
      pushReviewOperation(operation);
      commitUpdatedLine(updatedLine, { trackHistory: true });
    },
    [pushReviewOperation]
  );

  const startLineBoundaryDetachDrag = useCallback(
    (
      line: ProcessedLyricLine,
      wordId: string,
      field: TimingField,
      startX: number,
      zoom: number
    ) => {
      // 不写入 timelineDragAtom，避免污染通用频谱拖拽模型；review 自己维护预览和提交。
      const segment = line.segments.find(
        (segment) => segment.type === 'word' && segment.id === wordId
      );
      if (!segment || segment.type !== 'word') return;

      const initialTime = field === 'startTime' ? segment.startTime : segment.endTime;
      let latestPreview: ProcessedLyricLine | null = null;

      const handleMouseMove = (event: MouseEvent) => {
        event.preventDefault();
        const deltaTimeMs = Math.round(((event.clientX - startX) / zoom) * 1000);
        latestPreview = getReviewLineBoundaryDetachPreview(
          line,
          wordId,
          field,
          initialTime + deltaTimeMs,
          zoom
        );
        setPreviewLine(latestPreview);
      };

      const handleMouseUp = (event: MouseEvent) => {
        event.preventDefault();
        if (latestPreview) {
          commitReviewTimingLine(line, latestPreview, [{ wordId, field }]);
        }
        setPreviewLine(null);
        window.removeEventListener('mousemove', handleMouseMove);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp, { once: true });
    },
    [commitReviewTimingLine, setPreviewLine]
  );

  return useMemo<LyricTimelineOverlayLineRenderer | undefined>(() => {
    if (!activeReviewSession || !reviewFreeze || !selectedWordId) {
      return undefined;
    }

    return (context) => {
      const { line, zoom } = context;
      const segmentIndex = line.segments.findIndex(
        (segment) => segment.type === 'word' && segment.id === selectedWordId
      );
      if (segmentIndex < 0) return null;

      const selectedSegment = line.segments[segmentIndex];
      if (selectedSegment.type !== 'word') return null;

      // 当词边界与行边界重合时只显示一条合并线；Ctrl 拖这条线才把二者分离。
      const startMergedWithLine =
        segmentIndex === 0 && selectedSegment.startTime === line.startTime;
      const endMergedWithLine =
        segmentIndex === line.segments.length - 1 && selectedSegment.endTime === line.endTime;
      const fields: Array<{
        field: TimingField;
        timeMs: number;
        dragSegmentIndex: number;
        offsetPx: number;
        canDetachLineBoundary: boolean;
      }> = [
        {
          field: 'startTime',
          timeMs: selectedSegment.startTime,
          dragSegmentIndex: segmentIndex - 1,
          offsetPx: REVIEW_TIMING_START_HANDLE_OFFSET_PX,
          canDetachLineBoundary: startMergedWithLine,
        },
        {
          field: 'endTime',
          timeMs: selectedSegment.endTime,
          dragSegmentIndex: segmentIndex,
          offsetPx: REVIEW_TIMING_END_HANDLE_OFFSET_PX,
          canDetachLineBoundary: endMergedWithLine,
        },
      ];

      // 当前词的两条审阅手柄：普通拖拽走原 divider 逻辑，Ctrl+合并边界走 review 私有分离逻辑。
      const dividers: LyricTimelineAuxiliaryDivider[] = fields.map(
        ({ field, timeMs, dragSegmentIndex, offsetPx, canDetachLineBoundary }) => {
          const key = buildReviewTimingDividerKey(selectedWordId, field);
          const isStart = field === 'startTime';
          return {
            id: `review-timing-${key}`,
            lineId: line.id,
            timeMs,
            offsetPx,
            allowOutOfLineRange: true,
            short: true,
            ariaLabel: `${selectedSegment.word} ${isStart ? '起始' : '结束'}时间`,
            style: getReviewTimingDividerStyle(field),
            onMouseDown: (event) => {
              event.preventDefault();
              event.stopPropagation();
              setSelectedWords(new Set([selectedWordId]));
              if (event.ctrlKey && canDetachLineBoundary) {
                startLineBoundaryDetachDrag(line, selectedWordId, field, event.clientX, zoom);
                return;
              }
              setTimelineDrag({
                type: 'divider',
                lineId: line.id,
                segmentIndex: dragSegmentIndex,
                zoom,
                startX: event.clientX,
                isGapCreation: event.altKey,
                onCommit: (updatedLine) => {
                  commitReviewTimingLine(line, updatedLine, [{ wordId: selectedWordId, field }]);
                },
              });
            },
            onClick: (event) => {
              event.preventDefault();
              event.stopPropagation();
            },
          };
        }
      );

      // 额外显示行首/行尾；如果已经和当前词首/词尾合并，则由上面的词手柄代表它。
      const lineBoundaryDividers: LyricTimelineAuxiliaryDivider[] = [];
      if (!startMergedWithLine) {
        lineBoundaryDividers.push({
          id: `review-line-start-${line.id}`,
          lineId: line.id,
          timeMs: line.startTime,
          short: true,
          ariaLabel: '行起始时间',
          style: REVIEW_TIMING_LINE_BOUNDARY_STYLE,
          onMouseDown: (event) => {
            event.preventDefault();
            event.stopPropagation();
            setTimelineDrag({
              type: 'divider',
              lineId: line.id,
              segmentIndex: -1,
              zoom,
              startX: event.clientX,
              isGapCreation: event.altKey,
              onCommit: (updatedLine) => {
                commitReviewTimingLine(line, updatedLine);
              },
            });
          },
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
          },
        });
      }
      if (!endMergedWithLine) {
        lineBoundaryDividers.push({
          id: `review-line-end-${line.id}`,
          lineId: line.id,
          timeMs: line.endTime,
          short: true,
          ariaLabel: '行结束时间',
          style: REVIEW_TIMING_LINE_BOUNDARY_STYLE,
          onMouseDown: (event) => {
            event.preventDefault();
            event.stopPropagation();
            setTimelineDrag({
              type: 'divider',
              lineId: line.id,
              segmentIndex: line.segments.length - 1,
              zoom,
              startX: event.clientX,
              isGapCreation: event.altKey,
              onCommit: (updatedLine) => {
                commitReviewTimingLine(line, updatedLine);
              },
            });
          },
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
          },
        });
      }

      const allDividers = [...lineBoundaryDividers, ...dividers];
      if (allDividers.length === 0) return null;
      return createLyricTimelineAuxiliaryDividerRenderer(allDividers)(context);
    };
  }, [
    activeReviewSession,
    commitReviewTimingLine,
    reviewFreeze,
    selectedWordId,
    setSelectedWords,
    setTimelineDrag,
    startLineBoundaryDetachDrag,
  ]);
};
