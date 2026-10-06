import { ContextMenu } from '@radix-ui/themes';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { memo, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LyricLineMenu } from '$/components/Menus/lyric-line-menu';
import { useLyricListDrag } from '$/modules/lyric-drag/useLyricListDrag';
import {
  dragSourceAtom,
  isDraggingGlobalAtom,
  lyricLinesAtom,
  selectedLinesAtom,
  ToolMode,
  toolModeAtom,
} from '$/states/main.ts';
import { outlineJumpActionAtom } from '$/states/sidebar.ts';
import styles from './OutlinePanel.module.css';

export const OutlinePanel = memo(() => {
  const { t } = useTranslation();
  const store = useStore();

  const { lyricLines } = useAtomValue(lyricLinesAtom);
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
    for (let i = 0; i < lyricLines.length; i++) {
      if (!i || !lyricLines[i].isBG) currentNumber++;
      nums.push(currentNumber);
    }
    return nums;
  }, [lyricLines]);

  const handleItemDoubleClick = useCallback(
    (lineId: string) => {
      setSelectedLines(new Set([lineId]));
      setJumpAction({ id: lineId, ts: Date.now() });
    },
    [setSelectedLines, setJumpAction]
  );

  const handleContextMenuOpen = useCallback(
    (opened: boolean, lineId: string) => {
      if (opened && !isDragging) {
        const currentSelected = store.get(selectedLinesAtom);
        if (!currentSelected.has(lineId)) {
          store.set(selectedLinesAtom, new Set([lineId]));
        }
      }
    },
    [store, isDragging]
  );

  return (
    <div
      className={`${styles.outlineContainer} ${isDragging ? styles.isDraggingGlobal : ''}`}
      ref={containerRef}
      style={{ position: 'relative' }}
    >
      <div className={styles.dropIndicator} />

      {lyricLines.map((line, index) => {
        const isSelected = selectedLines.has(line.id);
        const isDragged = isDragging && dragSource === 'outline' && isSelected;
        const textContent = line.words.map((w) => w.word).join('');
        const hasText = textContent.trim().length > 0;

        return (
          <div
            key={line.id}
            className={styles.itemWrapper}
            data-line-id={line.id}
            data-absolute-index={index}
          >
            <ContextMenu.Root onOpenChange={(opened) => handleContextMenuOpen(opened, line.id)}>
              <ContextMenu.Trigger disabled={toolMode !== ToolMode.Edit}>
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
                      {hasText ? (
                        textContent
                      ) : (
                        <span className={styles.emptyText}>
                          {t('sidebar.outline.emptyLine', '(空行)')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </ContextMenu.Trigger>

              <ContextMenu.Content>
                <LyricLineMenu lineIndex={index} />
              </ContextMenu.Content>
            </ContextMenu.Root>
          </div>
        );
      })}
    </div>
  );
});
