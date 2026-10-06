/*
 * Copyright 2023-2025 Steve Xiao (stevexmh@qq.com) and contributors.
 *
 * 本源代码文件是属于 AMLL TTML Tool 项目的一部分。
 * This source code file is a part of AMLL TTML Tool project.
 * 本项目的源代码的使用受到 GNU GENERAL PUBLIC LICENSE version 3 许可证的约束，具体可以参阅以下链接。
 * Use of this source code is governed by the GNU GPLv3 license that can be found through the following link.
 *
 * https://github.com/amll-dev/amll-ttml-tool/blob/main/LICENSE
 */

import { LayoutGroup } from 'framer-motion';
import { Box, ContextMenu, Flex, Text } from '@radix-ui/themes';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { splitAtom } from 'jotai/utils';
import { useSetImmerAtom } from 'jotai-immer';
import { focusAtom } from 'jotai-optics';
import {
  type FC,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ViewportList, type ViewportListRef } from 'react-viewport-list';
import { useFileOpener } from '$/hooks/useFileOpener.ts';
import { audioEngine } from '$/modules/audio/audio-engine.ts';
import { useLyricListDrag } from '$/modules/lyric-drag/useLyricListDrag';
import {
  locateActionAtom,
  lyricLinesAtom,
  selectedLinesAtom,
  ToolMode,
  toolModeAtom,
} from '$/states/main.ts';
import { outlineJumpActionAtom } from '$/states/sidebar.ts';
import {
  playbackCurrentTimeAtom,
  playbackHighlightedLineIdAtom,
  playbackLocatedLineIndexAtom,
} from '../utils/playback-locate';
import { type LyricLine, newLyricLine } from '$/types/ttml.ts';
import { createLogger } from '$/utils/logger.ts';
import styles from './index.module.css';
import { LyricLineView } from './lyric-line-view';

const lyricLinesViewLogger = createLogger('LyricLinesView');

const lyricLinesOnlyAtom = splitAtom(focusAtom(lyricLinesAtom, (o) => o.prop('lyricLines')));

const findCurrentLineIndex = (lines: LyricLine[], currentTime: number) => {
  const scan = (predicate?: (line: LyricLine) => boolean) => {
    let previousIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (predicate && !predicate(line)) continue;
      if (line.endTime <= line.startTime) continue;
      if (currentTime < line.startTime) {
        return previousIndex !== -1 ? previousIndex : i;
      }
      if (currentTime >= line.startTime && currentTime <= line.endTime) {
        return i;
      }
      previousIndex = i;
    }
    return previousIndex;
  };

  const mainIndex = scan((line) => !line.isBG);
  if (mainIndex !== -1) return mainIndex;
  return scan();
};

export const LyricLinesView: FC = forwardRef<HTMLDivElement>((_props, ref) => {
  const editLyric = useAtomValue(lyricLinesOnlyAtom);
  const lyricLines = useAtomValue(lyricLinesAtom).lyricLines;
  const editLyricLines = useSetImmerAtom(lyricLinesAtom);
  const viewRef = useRef<ViewportListRef>(null);
  const viewElRef = useRef<HTMLDivElement>(null);
  const toolMode = useAtomValue(toolModeAtom);
  const playbackLocatedLineIndex = useAtomValue(playbackLocatedLineIndexAtom);
  const playbackHighlightedLineId = useAtomValue(playbackHighlightedLineIdAtom);
  const setPlaybackCurrentTime = useSetAtom(playbackCurrentTimeAtom);
  const { t } = useTranslation();
  const { openFile } = useFileOpener();

  const handlePasteTTML = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const file = new File([text], 'lyric.ttml', {
        type: 'application/xml',
      });
      openFile(file, 'ttml');
    } catch (e) {
      lyricLinesViewLogger.error(t('error.pasteClipboardFailed', '读取剪贴板失败'), e);
    }
  }, [openFile, t]);

  const handleNewLine = useCallback(() => {
    editLyricLines((state) => {
      state.lyricLines.push(newLyricLine());
    });
  }, [editLyricLines]);

  const scrollToIndexAtom = useMemo(
    () =>
      atom((get) => {
        if (toolMode !== ToolMode.Sync) return;
        const selectedLines = get(selectedLinesAtom);
        let scrollToIndex = Number.NaN;
        let i = 0;
        for (const lineAtom of editLyric) {
          const line = get(lineAtom);
          if (selectedLines.has(line.id)) {
            scrollToIndex = i;
            break;
          }

          i++;
        }
        if (Number.isNaN(scrollToIndex)) return;
        return scrollToIndex;
      }),
    [editLyric, toolMode]
  );
  const scrollToIndex = useAtomValue(scrollToIndexAtom);

  const scrollToLineIndex = useCallback((index: number) => {
    const viewEl = viewElRef.current;
    if (!viewEl) return;
    const viewContainerEl = viewEl.parentElement;
    if (!viewContainerEl) return;
    viewRef.current?.scrollToIndex({
      index,
      offset: viewContainerEl.clientHeight / -2 + 50,
    });
  }, []);

  useEffect(() => {
    if (scrollToIndex === undefined) return;
    scrollToLineIndex(scrollToIndex);
  }, [scrollToIndex, scrollToLineIndex]);

  useEffect(() => {
    if (playbackLocatedLineIndex === undefined) return;
    scrollToLineIndex(playbackLocatedLineIndex);
  }, [playbackLocatedLineIndex, scrollToLineIndex]);

  useEffect(() => {
    const updatePlaybackCurrentTime = (timeInSeconds: number) => {
      setPlaybackCurrentTime(timeInSeconds * 1000);
    };

    updatePlaybackCurrentTime(audioEngine.musicCurrentTime);
    audioEngine.onTimeUpdate(updatePlaybackCurrentTime);
    return () => audioEngine.offTimeUpdate(updatePlaybackCurrentTime);
  }, [setPlaybackCurrentTime]);

  const setSelectedLines = useSetAtom(selectedLinesAtom);

  const handleLocate = useCallback(() => {
    const currentTime = audioEngine.musicCurrentTime * 1000;
    const index = findCurrentLineIndex(lyricLines, currentTime);
    if (index === -1) return;
    scrollToLineIndex(index);
    const targetLine = lyricLines[index];
    if (targetLine) {
      setSelectedLines(new Set([targetLine.id]));
    }
  }, [lyricLines, scrollToLineIndex, setSelectedLines]);

  const locateAction = useAtomValue(locateActionAtom);
  useEffect(() => {
    if (locateAction > 0) {
      handleLocate();
    }
  }, [locateAction, handleLocate]);

  const jumpAction = useAtomValue(outlineJumpActionAtom);
  useEffect(() => {
    if (!jumpAction) return;
    const annotationLinePrefix = '__annotation_line__:';
    if (jumpAction.id.startsWith(annotationLinePrefix)) {
      const lineIndex = Number.parseInt(jumpAction.id.slice(annotationLinePrefix.length), 10);
      if (Number.isFinite(lineIndex) && lineIndex >= 0) {
        scrollToLineIndex(lineIndex);
      }
      return;
    }
    const targetIndex = lyricLines.findIndex((l) => l.id === jumpAction.id);
    if (targetIndex !== -1) {
      scrollToLineIndex(targetIndex);
    }
  }, [jumpAction, lyricLines, scrollToLineIndex]);

  const { onPointerDown } = useLyricListDrag({
    containerRef: viewElRef,
    source: 'main',
    disableDrag: toolMode !== ToolMode.Edit,
  });

  useImperativeHandle(ref, () => viewElRef.current as HTMLDivElement, []);

  const innerView =
    editLyric.length === 0 ? (
      <Flex
        flexGrow="1"
        gap="2"
        align="center"
        justify="center"
        direction="column"
        height="100%"
        style={{ width: '100%', height: '100%' }}
        ref={ref}
      >
        <Text color="gray">{t('app.empty.title', '没有歌词行')}</Text>
        <Text color="gray">
          {t('app.empty.description', '在顶部面板中添加新歌词行或从菜单栏打开 / 导入已有歌词')}
        </Text>
      </Flex>
    ) : (
      <Box
        flexGrow="1"
        className={styles.lyricLinesWrapper}
        height="100%"
        style={{ width: '100%', height: '100%' }}
      >
        <Box
          flexGrow="1"
          style={{
            padding: toolMode === ToolMode.Sync ? '20vh 0' : undefined,
            maxHeight: '100%',
            overflowY: 'auto',
            position: 'relative',
          }}
          ref={viewElRef}
        >
          <LayoutGroup id="lyric-playback-line-highlight">
            <div className={styles.dropIndicator} />
            <ViewportList overscan={10} items={editLyric} ref={viewRef} viewportRef={viewElRef}>
              {(lineAtom, i) => (
                <LyricLineView
                  key={`${lineAtom}`}
                  lineAtom={lineAtom}
                  lineIndex={i}
                  playbackHighlightedLineId={playbackHighlightedLineId}
                  onPointerDown={onPointerDown}
                />
              )}
            </ViewportList>
          </LayoutGroup>
        </Box>
      </Box>
    );

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          width: '100%',
          height: '100%',
          minHeight: 0,
        }}
      >
        {innerView}
      </ContextMenu.Trigger>
      <ContextMenu.Content>
        <ContextMenu.Item onSelect={handlePasteTTML}>
          {t('contextMenu.pasteTTML', '粘贴 TTML')}
        </ContextMenu.Item>
        <ContextMenu.Item onSelect={handleNewLine}>
          {t('contextMenu.newLine', '新建行')}
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
});

export default LyricLinesView;
