import type { ProcessedLyricLine } from '$/modules/segmentation/utils/segment-processing.ts';

//#region 数据模型
export type BoundaryKind = 'line-start' | 'internal' | 'line-end';

export type BoundaryVisualState = 'default' | 'selected' | 'hovered' | 'editing';

export type WordVisualState = 'default' | 'selected' | 'hovered' | 'selected-hovered';

export interface TimelineBoundary {
  /** 边界的 id */
  id: string;

  /** 边界的时间 */
  timeMs: number;

  /**
   * 对应原 segments 数组的索引
   *
   * -1 表示行首边界 */
  segmentIndex: number;
  /**
   * 边界类型
   */
  kind: BoundaryKind;

  /** 左侧相邻的 Segment ID */
  leftSegmentId: string | null;

  /** 右侧相邻的 Segment ID */
  rightSegmentId: string | null;

  /**
   * 左侧相邻的 Word ID (Gap 会被忽略为 null)
   *
   * 用于快速判断当前边界是否应该受到选中/悬停状态的影响
   */
  leftWordId: string | null;

  /**
   * 右侧相邻的 Word ID (Gap 会被忽略为 null)
   *
   * 用于快速判断当前边界是否应该受到选中/悬停状态的影响
   */
  rightWordId: string | null;
}
//#endregion

//#region 边界生成器
/**
 * 将一条由多个音节组成的歌词行，转换为显式的边界数组
 *
 * 例如行内有 N 个音节，将会生成 N + 1 个边界
 */
export function generateBoundaries(line: ProcessedLyricLine): TimelineBoundary[] {
  const { id: lineId, startTime, segments } = line;
  if (startTime == null) return [];

  const boundaries: TimelineBoundary[] = [];

  boundaries.push({
    id: `${lineId}:start`,
    timeMs: startTime,
    segmentIndex: -1,
    kind: 'line-start',
    leftSegmentId: null,
    rightSegmentId: segments[0]?.id ?? null,
    leftWordId: null,
    rightWordId: segments[0]?.type === 'word' ? segments[0].id : null,
  });

  segments.forEach((segment, index) => {
    const nextSegment = segments[index + 1];
    const isEndBoundary = index === segments.length - 1;

    const resolvedEndTime =
      segment.endTime ?? nextSegment?.startTime ?? line.endTime ?? segment.startTime;

    boundaries.push({
      id: `${lineId}:boundary:${segment.id}`,
      timeMs: resolvedEndTime,
      segmentIndex: index,
      kind: isEndBoundary ? 'line-end' : 'internal',
      leftSegmentId: segment.id,
      rightSegmentId: nextSegment?.id ?? null,
      leftWordId: segment.type === 'word' ? segment.id : null,
      rightWordId: nextSegment?.type === 'word' ? nextSegment.id : null,
    });
  });

  return boundaries;
}
//#endregion

//#region 视觉状态解析器
interface BoundaryStateOptions {
  selectedWordId: string | null;
  hoveredWordId: string | null;
  focusedWordId: string | null;
  draggingBoundaryId: string | null;
}

/**
 * 决定一条垂直边界线应该呈现何种颜色/状态
 *
 * 优先级：拖拽中 > 悬停/聚焦 > 选中 > 默认
 */
export function resolveBoundaryVisualState(
  boundary: TimelineBoundary,
  options: BoundaryStateOptions
): BoundaryVisualState {
  const { selectedWordId, hoveredWordId, focusedWordId, draggingBoundaryId } = options;

  if (draggingBoundaryId === boundary.id) {
    return 'editing';
  }

  const adjacentWordIds = [boundary.leftWordId, boundary.rightWordId];

  if (hoveredWordId && adjacentWordIds.includes(hoveredWordId)) {
    return 'hovered';
  }
  if (focusedWordId && adjacentWordIds.includes(focusedWordId)) {
    return 'hovered';
  }

  if (selectedWordId && adjacentWordIds.includes(selectedWordId)) {
    return 'selected';
  }

  return 'default';
}

/**
 * 决定一个音节应该呈现什么样的背景和边框
 */
export function resolveWordVisualState(
  wordId: string,
  selectedWordId: string | null,
  hoveredWordId: string | null,
  focusedWordId: string | null
): WordVisualState {
  const isSelected = selectedWordId === wordId;
  const isHovered = hoveredWordId === wordId || focusedWordId === wordId;

  if (isSelected && isHovered) {
    return 'selected-hovered';
  }
  if (isSelected) {
    return 'selected';
  }
  if (isHovered) {
    return 'hovered';
  }

  return 'default';
}
//#endregion
