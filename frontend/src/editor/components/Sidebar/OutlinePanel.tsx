import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { memo, type MouseEvent, useCallback, useMemo, useRef, useState } from 'react';
import { ViewportList } from 'react-viewport-list';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu';
import { LyricLineMenu } from '$/components/Menus/lyric-line-menu';
import { useLyricListDrag } from '$/modules/lyric-drag/useLyricListDrag';
import {
  dragSourceAtom,
  isDraggingGlobalAtom,
  outlineLinesAtom,
  selectedLinesAtom,
  ToolMode,
  toolModeAtom,
} from '$/states/main.ts';
import { outlineJumpActionAtom } from '$/states/sidebar.ts';
import styles from './OutlinePanel.module.css';

export const OutlinePanel = memo(() => {
  const store = useStore();

  const outlineLines = useAtomValue(outlineLinesAtom);
  const selectedLines = useAtomValue(selectedLinesAtom);
  const toolMode = useAtomValue(toolModeAtom);
  const isDragging = useAtomValue(isDraggingGlobalAtom);
  const dragSource = useAtomValue(dragSourceAtom);

  const setSelectedLines = useSetAtom(selectedLinesAtom);
  const setJumpAction = useSetAtom(outlineJumpActionAtom);

  const containerRef = useRef<HTMLDivElement>(null);

  const { onPointerDown } = useLyricListDrag({
    containerRef,
    source: 'outline',
    disableDrag: toolMode !== ToolMode.Edit,
  });

  const displayNumbers = useMemo(() => {
    const nums: number[] = [];
    let currentNumber = 0;
    for (let i = 0; i < outlineLines.length; i++) {
      if (!i || !outlineLines[i]?.isBG) currentNumber++;
      nums.push(currentNumber);
    }
    return nums;
  }, [outlineLines]);

  const handleItemDoubleClick = useCallback(
    (lineId: string) => {
      setSelectedLines(new Set([lineId]));
      setJumpAction({ id: lineId, ts: Date.now() });
    },
    [setSelectedLines, setJumpAction]
  );

  // 仅在编辑模式下挂右键菜单
  const menuEnabled = toolMode === ToolMode.Edit;
  const [contextLineIndex, setContextLineIndex] = useState<number | null>(null);

  /**
   * 整个面板只挂一个 ContextMenu（Radix 官方推荐的列表用法）。
   * 原来每行一个实例：200 行就是 200 套 Popper / portal / 全局监听。
   *
   * 用捕获阶段：保证在 Radix Trigger 打开菜单之前，目标行索引和选中行都已就位，
   * 菜单里的 LyricLineMenu 依赖 selectedLinesAtom 判断当前作用范围。
   */
  const handleContextMenu = useCallback(
    (evt: MouseEvent<HTMLDivElement>) => {
      if (!menuEnabled) return;
      const wrapper = (evt.target as HTMLElement).closest<HTMLElement>('[data-line-id]');
      const lineId = wrapper?.dataset.lineId;
      const rawIndex = wrapper?.dataset.absoluteIndex;
      const index = rawIndex === undefined ? Number.NaN : Number(rawIndex);

      if (isDragging || !lineId || !Number.isInteger(index)) {
        // 空白区域或拖拽中：连 Radix 的打开动作一起挡掉，
        // 否则会弹出一个带着上一次残留行索引的菜单。
        evt.preventDefault();
        evt.stopPropagation();
        setContextLineIndex(null);
        return;
      }

      const currentSelected = store.get(selectedLinesAtom);
      if (!currentSelected.has(lineId)) {
        store.set(selectedLinesAtom, new Set([lineId]));
      }
      setContextLineIndex(index);
    },
    [menuEnabled, isDragging, store]
  );

  const container = (
    <div
      className={`${styles.outlineContainer} ${isDragging ? styles.isDraggingGlobal : ''}`}
      ref={containerRef}
      style={{ position: 'relative' }}
      onContextMenuCapture={handleContextMenu}
    >
      <div className={styles.dropIndicator} />

      <ViewportList overscan={10} items={outlineLines} viewportRef={containerRef}>
        {(line, index) => {
          const isSelected = selectedLines.has(line.id);
          const isDragged = isDragging && dragSource === 'outline' && isSelected;
          const textContent = line.text;
          const hasText = textContent.trim().length > 0;

          return (
            <div
              key={line.id}
              className={styles.itemWrapper}
              data-line-id={line.id}
              data-absolute-index={index}
            >
              <div
                className={styles.outlineItem}
                data-selected={isSelected}
                data-is-dragged={isDragged}
                onPointerDown={(e) => {
                  onPointerDown(e, line.id, index);
                }}
                onDoubleClick={() => handleItemDoubleClick(line.id)}
              >
                <div className={styles.lineNumber}>{displayNumbers[index]}</div>

                <div
                  className={`${styles.textContent} ${line.isBG ? styles.isBG : ''} ${line.isDuet ? styles.isDuet : ''}`}
                >
                  <div className={styles.primaryText}>
                    {hasText ? textContent : <span className={styles.emptyText}>(空行)</span>}
                  </div>
                </div>
              </div>
            </div>
          );
        }}
      </ViewportList>
    </div>
  );

  if (!menuEnabled) return container;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{container}</ContextMenuTrigger>
      <ContextMenuContent>
        {contextLineIndex !== null && <LyricLineMenu lineIndex={contextLineIndex} />}
      </ContextMenuContent>
    </ContextMenu>
  );
});
