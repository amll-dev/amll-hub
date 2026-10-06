import { useAtomValue, useSetAtom } from 'jotai';
import React, { type FC, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import type { ProcessedLyricLine } from '$/modules/segmentation/utils/segment-processing.ts';
import {
  previewLineAtom,
  selectedWordIdAtom,
  timelineDragAtom,
} from '$/modules/spectrogram/states/dnd.ts';
import {
  generateBoundaries,
  resolveBoundaryVisualState,
  resolveWordVisualState,
} from '$/modules/spectrogram/utils/timeline-boundary.ts';
import { editingTimeFieldAtom, selectedLinesAtom } from '$/states/main.ts';
import { DividerSegment } from './DividerSegment.tsx';
import { GapSegment } from './GapSegment.tsx';
import styles from './LyricLineSegment.module.css';
import { LyricWordSegment } from './LyricWordSegment.tsx';
import { SpectrogramContext } from './SpectrogramContext.ts';

interface LyricLineSegmentProps {
  line: ProcessedLyricLine;
  children?: ReactNode;
  sharedBoundaryTimes: Set<number>;
}

export const LyricLineSegment: FC<LyricLineSegmentProps> = ({
  line,
  children,
  sharedBoundaryTimes,
}) => {
  const previewLine = useAtomValue(previewLineAtom);
  const setSelectedLines = useSetAtom(selectedLinesAtom);
  const selectedWordId = useAtomValue(selectedWordIdAtom);
  const setSelectedWordId = useSetAtom(selectedWordIdAtom);
  const timelineDrag = useAtomValue(timelineDragAtom);
  const editingTimeField = useAtomValue(editingTimeFieldAtom);

  const { zoom } = useContext(SpectrogramContext);

  const [hoveredWordId, setHoveredWordId] = useState<string | null>(null);
  const [focusedWordId, setFocusedWordId] = useState<string | null>(null);

  const handleWordPointerEnter = useCallback((wordId: string) => {
    setHoveredWordId(wordId);
  }, []);

  const handleWordPointerLeave = useCallback((wordId: string) => {
    setHoveredWordId((prev) => (prev === wordId ? null : prev));
  }, []);

  const handleWordFocus = useCallback((wordId: string) => {
    setFocusedWordId(wordId);
  }, []);

  const handleWordBlur = useCallback((wordId: string) => {
    setFocusedWordId((prev) => (prev === wordId ? null : prev));
  }, []);

  const displayLine = previewLine?.id === line.id ? previewLine : line;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (editingTimeField) return;
      if (!displayLine) return;
      e.stopPropagation();

      setSelectedLines(new Set([displayLine.id]));
      setSelectedWordId(null);
    },
    [editingTimeField, displayLine, setSelectedLines, setSelectedWordId]
  );

  const boundaries = useMemo(() => generateBoundaries(displayLine), [displayLine]);

  if (!displayLine) return null;

  const { startTime, endTime, segments } = displayLine;

  if (startTime == null || endTime == null || endTime <= startTime) {
    return null;
  }

  const left = (startTime / 1000) * zoom;
  const width = ((endTime - startTime) / 1000) * zoom;

  if (width < 1) return null;

  let draggingBoundaryId: string | null = null;

  if (timelineDrag?.type === 'divider' && timelineDrag.lineId === displayLine.id) {
    if (timelineDrag.segmentIndex === -1) {
      draggingBoundaryId = `${displayLine.id}:start`;
    } else {
      const draggedSegment = displayLine.segments[timelineDrag.segmentIndex];
      if (draggedSegment) {
        draggingBoundaryId = `${displayLine.id}:boundary:${draggedSegment.id}`;
      }
    }
  }

  return (
    <div
      className={styles.lineSegment}
      style={{ left: `${left}px`, width: `${width}px`, cursor: 'auto' }}
      onMouseDown={handleMouseDown}
      tabIndex={0}
      role="button"
      aria-label="Lyric Line"
    >
      {children}

      <div className={styles.lineBody}>
        <div className={styles.segmentLayer}>
          {segments.map((segment) =>
            segment.type === 'word' ? (
              <LyricWordSegment
                key={segment.id}
                lineId={displayLine.id}
                segment={segment}
                lineStartTime={startTime}
                visualState={resolveWordVisualState(
                  segment.id,
                  selectedWordId,
                  hoveredWordId,
                  focusedWordId
                )}
                onPointerEnter={handleWordPointerEnter}
                onPointerLeave={handleWordPointerLeave}
                onFocus={handleWordFocus}
                onBlur={handleWordBlur}
              />
            ) : (
              <GapSegment key={segment.id} segment={segment} lineStartTime={startTime} />
            )
          )}
        </div>
      </div>

      <div className={styles.boundaryLayer}>
        {boundaries.map((boundary) => (
          <DividerSegment
            key={boundary.id}
            lineId={displayLine.id}
            segmentIndex={boundary.segmentIndex}
            timeMs={boundary.timeMs}
            lineStartTime={startTime}
            kind={boundary.kind}
            isShared={sharedBoundaryTimes.has(boundary.timeMs)}
            visualState={resolveBoundaryVisualState(boundary, {
              selectedWordId,
              hoveredWordId,
              focusedWordId,
              draggingBoundaryId,
            })}
          />
        ))}
      </div>
    </div>
  );
};
