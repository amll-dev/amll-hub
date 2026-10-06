import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import type { CSSProperties, FC, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useContext, useEffect, useMemo, useRef } from 'react';
import { audioEngine } from '$/modules/audio/audio-engine.ts';
import {
  type ProcessedLyricLine,
  processedLyricLinesAtom,
} from '$/modules/segmentation/utils/segment-processing.ts';
import {
  previewLineAtom,
  type TimelineDragOperation,
  timelineDragAtom,
} from '$/modules/spectrogram/states/dnd.ts';
import {
  commitUpdatedLine,
  getUpdatedLineForDivider,
  getUpdatedLineForWordPan,
} from '$/modules/spectrogram/utils/timeline-mutations.ts';
import { selectedLinesAtom, showUnselectedLinesAtom } from '$/states/main.ts';
import { globalStore } from '$/states/store.ts';
import { LyricLineSegment } from './LyricLineSegment';
import styles from './LyricTimelineOverlay.module.css';
import { SpectrogramContext } from './SpectrogramContext.ts';

// 行级扩展插槽：调用方可以在每条歌词行内部叠加时间标记、命中区域或审阅提示。
export interface LyricTimelineOverlayLineContext {
  line: ProcessedLyricLine;
  allLines: ProcessedLyricLine[];
  zoom: number;
  scrollLeft: number;
  clientWidth: number;
}

export type LyricTimelineOverlayLineRenderer = (
  context: LyricTimelineOverlayLineContext
) => ReactNode;

export interface LyricTimelineAuxiliaryDivider {
  id: string;
  lineId: string;
  timeMs: number;
  offsetPx?: number;
  allowOutOfLineRange?: boolean;
  short?: boolean;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  onMouseDown?: (
    event: ReactMouseEvent<HTMLDivElement>,
    divider: LyricTimelineAuxiliaryDivider
  ) => void;
  onClick?: (
    event: ReactMouseEvent<HTMLDivElement>,
    divider: LyricTimelineAuxiliaryDivider
  ) => void;
}

interface LyricTimelineOverlayProps {
  clientWidth: number;
  hiddenLineIds?: Set<string> | null;
  renderLineOverlay?: LyricTimelineOverlayLineRenderer;
}

const SNAP_THRESHOLD_PX = 7;
const AUXILIARY_DIVIDER_WIDTH_PX = 15;

// 通用辅助分割线渲染器，只处理可见行过滤和毫秒到行内像素的换算。
export const createLyricTimelineAuxiliaryDividerRenderer =
  (dividers: readonly LyricTimelineAuxiliaryDivider[]): LyricTimelineOverlayLineRenderer =>
  ({ line, zoom }) => {
    if (line.startTime == null || line.endTime == null) return null;

    const lineDividers = dividers.filter(
      (divider) =>
        divider.lineId === line.id &&
        (divider.allowOutOfLineRange ||
          (divider.timeMs >= line.startTime && divider.timeMs <= line.endTime))
    );
    if (lineDividers.length === 0) return null;

    return lineDividers.map((divider) => {
      const left =
        ((divider.timeMs - line.startTime) / 1000) * zoom - AUXILIARY_DIVIDER_WIDTH_PX / 2;
      const isInteractive = Boolean(divider.onMouseDown || divider.onClick);
      const className = [
        styles.auxiliaryDivider,
        divider.short ? styles.auxiliaryDividerShort : '',
        isInteractive ? styles.auxiliaryDividerInteractive : '',
        divider.className ?? '',
      ]
        .filter(Boolean)
        .join(' ');

      return (
        <div
          key={divider.id}
          className={className}
          style={{
            left: `${left + (divider.offsetPx ?? 0)}px`,
            width: `${AUXILIARY_DIVIDER_WIDTH_PX}px`,
            ...divider.style,
          }}
          onMouseDown={(event) => divider.onMouseDown?.(event, divider)}
          onClick={(event) => divider.onClick?.(event, divider)}
          role="separator"
          aria-orientation="vertical"
          aria-label={divider.ariaLabel}
          aria-valuenow={divider.timeMs}
        />
      );
    });
  };

export const LyricTimelineOverlay: FC<LyricTimelineOverlayProps> = ({
  clientWidth,
  hiddenLineIds,
  renderLineOverlay,
}) => {
  const processedLines = useAtomValue(processedLyricLinesAtom);
  const [timelineDrag, setTimelineDrag] = useAtom(timelineDragAtom);
  const setPreviewLine = useSetAtom(previewLineAtom);
  const snapTargetsMs = useRef<number[]>([]);
  const { scrollContainerRef, zoom, scrollLeft } = useContext(SpectrogramContext);

  const showUnselectedLines = useAtomValue(showUnselectedLinesAtom);
  const selectedLines = useAtomValue(selectedLinesAtom);

  useEffect(() => {
    if (!timelineDrag) {
      return;
    }

    let lockedGapDirection: 'left' | 'right' | null = null;

    const handleGlobalMouseMove = (event: MouseEvent) => {
      event.preventDefault();

      switch (timelineDrag.type) {
        case 'divider': {
          const { startX, lineId, segmentIndex, isGapCreation, zoom } = timelineDrag;
          const lineBeingDragged = processedLines.find((l) => l.id === lineId);
          if (!lineBeingDragged) return;

          const deltaX = event.clientX - startX;

          if (isGapCreation && !lockedGapDirection) {
            if (deltaX > 2) lockedGapDirection = 'right';
            else if (deltaX < -2) lockedGapDirection = 'left';
          }

          const deltaTimeMs = Math.round((deltaX / zoom) * 1000);
          const baseTime =
            segmentIndex === -1
              ? lineBeingDragged.startTime
              : (lineBeingDragged.segments[segmentIndex]?.endTime ?? lineBeingDragged.startTime);
          let newTime = baseTime + deltaTimeMs;

          if (!event.shiftKey) {
            let closestSnapTime: number | null = null;
            let minDistancePx = SNAP_THRESHOLD_PX;
            const newTimePx = (newTime / 1000) * zoom;

            for (const targetTime of snapTargetsMs.current) {
              const targetTimePx = (targetTime / 1000) * zoom;
              const distancePx = Math.abs(newTimePx - targetTimePx);
              if (distancePx < minDistancePx) {
                minDistancePx = distancePx;
                closestSnapTime = targetTime;
              }
            }
            if (closestSnapTime !== null) newTime = closestSnapTime;
          }

          const preview = getUpdatedLineForDivider(
            lineBeingDragged,
            segmentIndex,
            newTime,
            isGapCreation,
            zoom,
            lockedGapDirection
          );
          setPreviewLine(preview);
          break;
        }

        case 'word-pan': {
          const { lineId, wordId, initialMouseTimeMS, initialWordStartMS } = timelineDrag;
          const processedLine = processedLines.find((l) => l.id === lineId);
          if (!processedLine) return;

          const scrollContainer = scrollContainerRef.current;
          if (!scrollContainer) return;
          const rect = scrollContainer.getBoundingClientRect();

          const mouseXPx = event.clientX - rect.left;
          const currentMouseTimeMS = ((scrollLeft + mouseXPx) / zoom) * 1000;
          const timeDeltaMS = currentMouseTimeMS - initialMouseTimeMS;
          const desiredNewStartMS = initialWordStartMS + timeDeltaMS;

          const preview = getUpdatedLineForWordPan(processedLine, wordId, desiredNewStartMS, zoom);
          setPreviewLine(preview);
          break;
        }
      }
    };

    const handleGlobalMouseUp = (event: MouseEvent) => {
      event.preventDefault();

      const lastSnappedLine = globalStore.get(previewLineAtom);
      if (lastSnappedLine) {
        if (timelineDrag.onCommit) {
          timelineDrag.onCommit(lastSnappedLine);
        } else {
          commitUpdatedLine(lastSnappedLine);
        }
      }

      setTimelineDrag(null);
      setPreviewLine(null);
    };

    let needsBoundarySnapping = false;

    if (timelineDrag.type === 'divider') {
      const { segmentIndex } = timelineDrag;
      const lineBeingDragged = processedLines.find((l) => l.id === timelineDrag.lineId);
      if (lineBeingDragged) {
        needsBoundarySnapping =
          segmentIndex === -1 || segmentIndex === lineBeingDragged.segments.length - 1;
      }
    }

    if (needsBoundarySnapping) {
      const lineId = (timelineDrag as TimelineDragOperation).lineId;
      const currentEngineTimeMs = audioEngine.musicCurrentTime * 1000;
      const targets: number[] = [currentEngineTimeMs];
      const otherLineBoundaries = processedLines
        .filter((line) => line.id !== lineId)
        .flatMap((line) => [line.startTime, line.endTime]);
      targets.push(...otherLineBoundaries);
      snapTargetsMs.current = targets.filter((time): time is number => time != null);
    }

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp, { once: true });

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      snapTargetsMs.current = [];
      setPreviewLine(null);
    };
  }, [
    timelineDrag,
    setTimelineDrag,
    setPreviewLine,
    zoom,
    scrollLeft,
    scrollContainerRef,
    processedLines,
  ]);

  const sharedBoundaryTimes = useMemo(() => {
    const endTimes = new Set<number>();
    const shared = new Set<number>();

    for (const line of processedLines) {
      if (line.endTime != null) endTimes.add(line.endTime);
    }
    for (const line of processedLines) {
      if (line.startTime != null && endTimes.has(line.startTime)) {
        shared.add(line.startTime);
      }
    }
    return shared;
  }, [processedLines]);

  const bufferPx = 500;
  const viewStartMs = ((scrollLeft - bufferPx) / zoom) * 1000;
  const viewEndMs = ((scrollLeft + clientWidth + bufferPx) / zoom) * 1000;

  const linesToRenderSet = new Set<ProcessedLyricLine>();
  let closestLeft: ProcessedLyricLine | null = null;
  let foundClosestRight = false;

  for (const line of processedLines) {
    if (line.startTime == null || line.endTime == null) continue;

    const inBufferedView = line.endTime > viewStartMs && line.startTime < viewEndMs;

    if (inBufferedView) {
      linesToRenderSet.add(line);
      continue;
    }

    if (line.endTime <= viewStartMs) {
      closestLeft = line;
    }

    if (line.startTime >= viewEndMs && !foundClosestRight) {
      linesToRenderSet.add(line);
      foundClosestRight = true;
    }
  }

  if (closestLeft) {
    linesToRenderSet.add(closestLeft);
  }

  const visibleLines = Array.from(linesToRenderSet);

  let linesToRender: ProcessedLyricLine[] = visibleLines;

  if (hiddenLineIds && hiddenLineIds.size > 0) {
    linesToRender = linesToRender.filter((line) => !hiddenLineIds.has(line.id));
  }

  if (!showUnselectedLines) {
    linesToRender = linesToRender.filter((line) => selectedLines.has(line.id));
  }

  return (
    <div className={styles.overlay}>
      {linesToRender.map((line) => (
        <LyricLineSegment key={line.id} line={line} sharedBoundaryTimes={sharedBoundaryTimes}>
          {renderLineOverlay?.({
            line,
            allLines: processedLines,
            zoom,
            scrollLeft,
            clientWidth,
          })}
        </LyricLineSegment>
      ))}
    </div>
  );
};
