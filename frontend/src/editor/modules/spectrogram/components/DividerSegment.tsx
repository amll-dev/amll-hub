import { useAtomValue, useSetAtom } from 'jotai';
import { type FC, useCallback, useContext } from 'react';
import { processedLyricLinesAtom } from '$/modules/segmentation/utils/segment-processing.ts';
import { timelineDragAtom } from '$/modules/spectrogram/states/dnd.ts';
import type {
  BoundaryKind,
  BoundaryVisualState,
} from '$/modules/spectrogram/utils/timeline-boundary.ts';
import {
  commitUpdatedLine,
  getUpdatedLineForDivider,
} from '$/modules/spectrogram/utils/timeline-mutations';
import styles from './DividerSegment.module.css';
import { SpectrogramContext } from './SpectrogramContext';

interface DividerSegmentProps {
  lineId: string;
  segmentIndex: number;
  timeMs: number;
  lineStartTime: number;
  lineEndTime: number;
  kind: BoundaryKind;
  visualState: BoundaryVisualState;
  isShared: boolean;
  /** roving tabindex：一行只让一个边界进 Tab 序列 */
  tabIndex: number;
  onFocus: () => void;
}

const NUDGE_MS = 10;
const SHIFT_NUDGE_MS = 50;

export const DividerSegment: FC<DividerSegmentProps> = ({
  lineId,
  segmentIndex,
  timeMs,
  lineStartTime,
  lineEndTime,
  kind,
  visualState,
  isShared,
  tabIndex,
  onFocus,
}) => {
  const setTimelineDrag = useSetAtom(timelineDragAtom);
  const processedLines = useAtomValue(processedLyricLinesAtom);
  const { zoom } = useContext(SpectrogramContext);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setTimelineDrag({
        type: 'divider',
        lineId: lineId,
        segmentIndex: segmentIndex,
        zoom: zoom,
        startX: e.clientX,
        isGapCreation: e.altKey,
      });
    },
    [lineId, segmentIndex, setTimelineDrag, zoom]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const lineBeingDragged = processedLines.find((l) => l.id === lineId);
      if (!lineBeingDragged) {
        return;
      }

      const nudgeAmount = event.shiftKey ? SHIFT_NUDGE_MS : NUDGE_MS;
      const newTime = event.key === 'ArrowRight' ? timeMs + nudgeAmount : timeMs - nudgeAmount;

      const updatedLine = getUpdatedLineForDivider(
        lineBeingDragged,
        segmentIndex,
        newTime,
        false,
        zoom
      );

      commitUpdatedLine(updatedLine);
    },
    [lineId, processedLines, segmentIndex, timeMs, zoom]
  );

  if (timeMs == null || timeMs < 0 || lineStartTime == null) return null;

  const timePx = ((timeMs - lineStartTime) / 1000) * zoom;

  return (
    <div
      className={styles.divider}
      style={{ left: `${timePx}px` }}
      data-kind={kind}
      data-shared={isShared}
      data-visual-state={visualState}
      onMouseDown={startDrag}
      onContextMenu={(e) => e.preventDefault()}
      // 时间轴上的边界本质是「可微调的数值」：用 slider 语义，
      // separator 配 aria-valuenow 是无效组合，读屏不会当控件处理。
      role="slider"
      tabIndex={tabIndex}
      onFocus={onFocus}
      aria-orientation="horizontal"
      aria-label={`第 ${segmentIndex + 1} 个词边界`}
      aria-valuemin={Math.round(lineStartTime)}
      aria-valuemax={Math.round(lineEndTime)}
      aria-valuenow={timeMs}
      onKeyDown={handleKeyDown}
    />
  );
};
