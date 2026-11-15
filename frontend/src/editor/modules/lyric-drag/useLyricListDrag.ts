import { useSetAtom, useStore } from 'jotai';
import { useCallback, useEffect, useRef } from 'react';
import { reorderOrCopyLyricLines } from '$/modules/lyric-drag/drag-reorder';
import {
  draggedCountAtom,
  dragSourceAtom,
  isCopyModeAtom,
  isDraggingGlobalAtom,
  lyricLinesAtom,
  selectedLinesAtom,
  selectedWordsAtom,
} from '$/states/main';

export interface UseLyricListDragOptions {
  containerRef: React.RefObject<HTMLElement | null>;
  source: 'main' | 'outline';
  disableDrag?: boolean;
}

export const useLyricListDrag = ({
  containerRef,
  source,
  disableDrag = false,
}: UseLyricListDragOptions) => {
  const store = useStore();

  const setIsDraggingGlobal = useSetAtom(isDraggingGlobalAtom);
  const setDraggedCount = useSetAtom(draggedCountAtom);
  const setDragSource = useSetAtom(dragSourceAtom);
  const setIsCopyModeGlobal = useSetAtom(isCopyModeAtom);

  const handleDragStart = useCallback(
    (startLineId: string) => {
      const currentSelected = store.get(selectedLinesAtom);
      if (!currentSelected.has(startLineId)) {
        const nextSelected = new Set([startLineId]);
        store.set(selectedLinesAtom, nextSelected);
        return new Set(nextSelected);
      }
      return new Set(currentSelected);
    },
    [store]
  );

  const handleDrop = useCallback(
    (draggedIds: Set<string>, targetIndex: number, isCopy: boolean) => {
      const lyricState = store.get(lyricLinesAtom);
      const originalLines = lyricState.lyricLines;

      const { nextLines, newlyCreatedIds } = reorderOrCopyLyricLines(
        originalLines,
        draggedIds,
        targetIndex,
        isCopy
      );

      store.set(lyricLinesAtom, { ...lyricState, lyricLines: nextLines });

      if (isCopy && newlyCreatedIds.size > 0) {
        store.set(selectedLinesAtom, newlyCreatedIds);
        store.set(selectedWordsAtom, new Set());
      }
    },
    [store]
  );

  const handleSelect = useCallback(
    (lineId: string, lineIndex: number, evt: React.PointerEvent) => {
      if (evt.ctrlKey || evt.metaKey) {
        store.set(selectedLinesAtom, (prev) => {
          const next = new Set(prev);
          if (next.has(lineId)) next.delete(lineId);
          else next.add(lineId);
          return next;
        });
        return;
      }

      if (evt.shiftKey) {
        store.set(selectedLinesAtom, (prev) => {
          const next = new Set(prev);
          if (next.size > 0) {
            let minBoundary = Number.NaN;
            let maxBoundary = Number.NaN;
            const currentLines = store.get(lyricLinesAtom).lyricLines;

            currentLines.forEach((line, i) => {
              if (next.has(line.id)) {
                if (Number.isNaN(minBoundary)) minBoundary = i;
                if (Number.isNaN(maxBoundary)) maxBoundary = i;
                minBoundary = Math.min(minBoundary, i, lineIndex);
                maxBoundary = Math.max(maxBoundary, i, lineIndex);
              }
            });

            for (let i = minBoundary; i <= maxBoundary; i++) {
              const line = currentLines[i];
              if (line) next.add(line.id);
            }
          } else {
            next.add(lineId);
          }
          return next;
        });
        return;
      }

      store.set(selectedLinesAtom, new Set([lineId]));
      store.set(selectedWordsAtom, new Set());
    },
    [store]
  );

  const ctx = useRef({
    active: false,
    isDragging: false,
    isCopyMode: false,
    startX: 0,
    startY: 0,
    startLineId: '',
    startIndex: -1,
    allowDrag: true,
    draggedIds: new Set<string>(),
    originalEvent: null as React.PointerEvent | null,
    rafId: null as number | null,
    dropIndex: null as number | null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const stopAutoScroll = useCallback(() => {
    if (ctx.current.rafId !== null) {
      cancelAnimationFrame(ctx.current.rafId);
      ctx.current.rafId = null;
    }
  }, []);

  const handleAutoScroll = useCallback(
    (clientY: number) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const edgeThreshold = 40;
      const scrollSpeed = 12;
      let amount = 0;

      if (clientY < rect.top + edgeThreshold) amount = -scrollSpeed;
      else if (clientY > rect.bottom - edgeThreshold) amount = scrollSpeed;

      if (amount !== 0) {
        if (ctx.current.rafId === null) {
          const scrollStep = () => {
            if (!ctx.current.active) return stopAutoScroll();
            container.scrollTop += amount;
            ctx.current.rafId = requestAnimationFrame(scrollStep);
          };
          ctx.current.rafId = requestAnimationFrame(scrollStep);
        }
      } else {
        stopAutoScroll();
      }
    },
    [containerRef, stopAutoScroll]
  );

  // 拖拽开始时一次性量好所有行的「容器内内容坐标」，pointermove 期间只扫这个数组，
  // 不再每帧 querySelectorAll + 每行 getBoundingClientRect/getComputedStyle
  const dragLayoutRef = useRef<{
    items: {
      absoluteIndex: number;
      lineId: string | null;
      contentTop: number;
      height: number;
      marginTop: number;
      marginBottom: number;
    }[];
    containerGap: number;
    containerPaddingTop: number;
    minContentTop: number;
    maxContentBottom: number;
  } | null>(null);

  const buildDragLayout = useCallback(() => {
    const container = containerRef.current;
    if (!container) return null;
    const containerRect = container.getBoundingClientRect();
    const containerStyle = window.getComputedStyle(container);
    const containerPaddingTop = parseFloat(containerStyle.paddingTop) || 0;
    const containerGap = parseFloat(containerStyle.rowGap || containerStyle.gap) || 0;
    const scrollTop = container.scrollTop;

    let minContentTop = Number.POSITIVE_INFINITY;
    let maxContentBottom = Number.NEGATIVE_INFINITY;
    const items = Array.from(container.querySelectorAll('[data-absolute-index]')).map((node) => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      // 视口坐标 → 容器内内容坐标（与 scrollTop 无关，滚动时无需重新量）
      const contentTop = rect.top - containerRect.top + scrollTop - containerPaddingTop;
      const height = rect.height;
      minContentTop = Math.min(minContentTop, contentTop);
      maxContentBottom = Math.max(maxContentBottom, contentTop + height);
      return {
        absoluteIndex: parseInt(node.getAttribute('data-absolute-index') || '0', 10),
        lineId: node.getAttribute('data-line-id'),
        contentTop,
        height,
        marginTop: parseFloat(style.marginTop) || 0,
        marginBottom: parseFloat(style.marginBottom) || 0,
      };
    });
    items.sort((a, b) => a.contentTop - b.contentTop);
    return { items, containerGap, containerPaddingTop, minContentTop, maxContentBottom };
  }, [containerRef]);

  const calculateTargetIndex = useCallback(
    (clientY: number) => {
      const container = containerRef.current;
      if (!container) return;

      let layout = dragLayoutRef.current;
      if (!layout) {
        layout = buildDragLayout();
        dragLayoutRef.current = layout;
      }
      if (!layout || layout.items.length === 0) return;

      const containerRect = container.getBoundingClientRect();
      const contentY =
        clientY - containerRect.top + container.scrollTop - layout.containerPaddingTop;

      // 虚拟滚动（ViewportList）下滚动会增删/复用行节点，鼠标滚出缓存覆盖范围时重建一次
      if (contentY < layout.minContentTop || contentY > layout.maxContentBottom) {
        layout = buildDragLayout();
        dragLayoutRef.current = layout;
        if (!layout || layout.items.length === 0) return;
      }

      let foundInsertIndex = -1;
      let targetY = 0;
      let showIndicator = true;

      for (const item of layout.items) {
        const bottom = item.contentTop + item.height;
        if (
          contentY >= item.contentTop &&
          contentY <= bottom &&
          item.lineId &&
          ctx.current.draggedIds.has(item.lineId)
        ) {
          showIndicator = false;
          ctx.current.dropIndex = null;
          break;
        }

        const mid = item.contentTop + item.height / 2;
        if (contentY < mid) {
          foundInsertIndex = item.absoluteIndex;
          targetY = item.contentTop - (item.marginTop + layout.containerGap) / 2;
          break;
        }
      }

      if (foundInsertIndex === -1 && showIndicator) {
        const lastItem = layout.items[layout.items.length - 1];
        if (lastItem) {
          foundInsertIndex = lastItem.absoluteIndex + 1;
          targetY =
            lastItem.contentTop +
            lastItem.height +
            (lastItem.marginBottom + layout.containerGap) / 2;
        }
      }

      ctx.current.dropIndex = showIndicator && foundInsertIndex !== -1 ? foundInsertIndex : null;

      if (showIndicator && foundInsertIndex !== -1) {
        container.style.setProperty('--drop-indicator-y', `${targetY}px`);
        container.style.setProperty('--drop-indicator-display', 'block');
      } else {
        container.style.setProperty('--drop-indicator-display', 'none');
      }
    },
    [containerRef, buildDragLayout]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        ctx.current.isCopyMode = true;
        setIsCopyModeGlobal(true);
      }
    },
    [setIsCopyModeGlobal]
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        ctx.current.isCopyMode = false;
        setIsCopyModeGlobal(false);
      }
    },
    [setIsCopyModeGlobal]
  );
  const handleGlobalPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!ctx.current.active) return;

      const dist = Math.sqrt(
        (e.clientX - ctx.current.startX) ** 2 + (e.clientY - ctx.current.startY) ** 2
      );

      if (!ctx.current.isDragging && ctx.current.allowDrag && dist > 3) {
        if (disableDrag) return;
        ctx.current.isDragging = true;

        const draggedIds = handleDragStart(ctx.current.startLineId);
        ctx.current.draggedIds = draggedIds;

        // data-is-dragged 现在由行组件的 React 属性驱动，不再 setAttribute 直改 DOM，
        // 也省掉按 id 逐个 querySelectorAll 的全树扫描
        document.documentElement.style.setProperty('--drag-ghost-opacity', '1');

        setIsDraggingGlobal(true);
        setDraggedCount(draggedIds.size);
        setDragSource(source);
      }

      if (ctx.current.isDragging) {
        e.preventDefault();

        document.documentElement.style.setProperty('--drag-ghost-x', `${e.clientX}px`);
        document.documentElement.style.setProperty('--drag-ghost-y', `${e.clientY}px`);

        handleAutoScroll(e.clientY);
        calculateTargetIndex(e.clientY);
      }
    },
    [
      handleDragStart,
      handleAutoScroll,
      calculateTargetIndex,
      setIsDraggingGlobal,
      setDraggedCount,
      setDragSource,
      source,
      disableDrag,
    ]
  );

  const handleGlobalPointerEnd = useCallback(
    (_e: PointerEvent, isCancel: boolean) => {
      if (!ctx.current.active) return;

      ctx.current.active = false;
      const wasDragging = ctx.current.isDragging;
      ctx.current.isDragging = false;
      stopAutoScroll();

      abortControllerRef.current?.abort();
      abortControllerRef.current = null;

      const container = containerRef.current;
      if (container) {
        container.style.setProperty('--drop-indicator-display', 'none');
      }

      if (!wasDragging) {
        if (!isCancel && ctx.current.originalEvent) {
          handleSelect(ctx.current.startLineId, ctx.current.startIndex, ctx.current.originalEvent);
        }
      } else {
        if (!isCancel && ctx.current.dropIndex !== null) {
          handleDrop(ctx.current.draggedIds, ctx.current.dropIndex, ctx.current.isCopyMode);
        }
      }

      setIsDraggingGlobal(false);
      setDraggedCount(0);
      setDragSource(null);
      setIsCopyModeGlobal(false);
      document.documentElement.style.removeProperty('--drag-ghost-opacity');
      document.documentElement.style.removeProperty('--drag-ghost-x');
      document.documentElement.style.removeProperty('--drag-ghost-y');

      ctx.current.dropIndex = null;
      ctx.current.draggedIds = new Set();
      dragLayoutRef.current = null;
      ctx.current.originalEvent = null;
      ctx.current.isCopyMode = false;
    },
    [
      stopAutoScroll,
      handleSelect,
      handleDrop,
      setIsDraggingGlobal,
      setDraggedCount,
      setDragSource,
      setIsCopyModeGlobal,
      containerRef,
    ]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent, lineId: string, index: number, allowDrag = true) => {
      if (e.button !== 0) return;

      e.currentTarget.setPointerCapture(e.pointerId);

      abortControllerRef.current?.abort();

      const controller = new AbortController();
      abortControllerRef.current = controller;
      const { signal } = controller;

      const isCopyInitial = e.ctrlKey || e.metaKey;

      if (allowDrag && isCopyInitial) {
        setIsCopyModeGlobal(true);
      }

      ctx.current = {
        ...ctx.current,
        active: true,
        isDragging: false,
        isCopyMode: isCopyInitial,
        startX: e.clientX,
        startY: e.clientY,
        startLineId: lineId,
        startIndex: index,
        allowDrag,
        originalEvent: e,
      };

      window.addEventListener('pointermove', handleGlobalPointerMove, {
        signal,
      });
      window.addEventListener('pointerup', (ev) => handleGlobalPointerEnd(ev, false), { signal });
      window.addEventListener('pointercancel', (ev) => handleGlobalPointerEnd(ev, true), {
        signal,
      });
      window.addEventListener('keydown', handleKeyDown, { signal });
      window.addEventListener('keyup', handleKeyUp, { signal });
    },
    [
      handleGlobalPointerMove,
      handleGlobalPointerEnd,
      handleKeyDown,
      handleKeyUp,
      setIsCopyModeGlobal,
    ]
  );

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      stopAutoScroll();
      setIsDraggingGlobal(false);
      setDraggedCount(0);
      setDragSource(null);
      setIsCopyModeGlobal(false);
      document.documentElement.style.removeProperty('--drag-ghost-opacity');
      document.documentElement.style.removeProperty('--drag-ghost-x');
      document.documentElement.style.removeProperty('--drag-ghost-y');
    };
  }, [setDragSource, setDraggedCount, setIsCopyModeGlobal, setIsDraggingGlobal, stopAutoScroll]);

  return {
    onPointerDown,
  };
};
