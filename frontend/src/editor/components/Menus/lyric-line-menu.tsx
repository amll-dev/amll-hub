import { atom, useAtomValue } from 'jotai';
import { useSetImmerAtom } from 'jotai-immer';
import * as React from 'react';
import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { lyricLinesAtom, selectedLinesAtom } from '$/states/main';
import { type LyricLine, newLyricLine, newLyricWord } from '$/types/ttml';

const selectedLinesSizeAtom = atom((get) => get(selectedLinesAtom).size);

export const LyricLineMenu = ({ lineIndex }: { lineIndex: number }) => {
  const selectedLinesSize = useAtomValue(selectedLinesSizeAtom);
  const selectedLines = useAtomValue(selectedLinesAtom);
  const editLyricLines = useSetImmerAtom(lyricLinesAtom);

  const lineObjs = useAtomValue(lyricLinesAtom);
  const selectedLineObjs = lineObjs.lyricLines.filter((line) => selectedLines.has(line.id));
  const [Bgchecked, setBgChecked] = React.useState(() => {
    if (selectedLineObjs.every((line) => line.isBG)) return true;
    else if (selectedLineObjs.every((line) => !line.isBG)) return false;
    else return 'indeterminate' as const;
  });
  const [DuetChecked, setDuetChecked] = React.useState(() => {
    if (selectedLineObjs.every((line) => line.isDuet)) return true;
    else if (selectedLineObjs.every((line) => !line.isDuet)) return false;
    else return 'indeterminate' as const;
  });
  const combineEnabled = (() => {
    if (selectedLinesSize < 2) return null;
    const lineIdxs = lineObjs.lyricLines
      .filter((line) => selectedLines.has(line.id))
      .map((line) => lineObjs.lyricLines.indexOf(line));
    const minIdx = Math.min(...lineIdxs);
    const maxIdx = Math.max(...lineIdxs);
    if (lineIdxs.length !== maxIdx - minIdx + 1) return null;
    for (let i = minIdx; i <= maxIdx; i++) if (!lineIdxs.includes(i)) return null;
    return { minIdx, maxIdx };
  })();

  function bgOnCheck(checked: boolean) {
    setBgChecked(checked);
    editLyricLines((state) => {
      const lines = state.lyricLines.filter((line) => selectedLines.has(line.id));
      for (const line of lines) line.isBG = checked;
    });
  }
  function duetOnCheck(checked: boolean) {
    setDuetChecked(checked);
    editLyricLines((state) => {
      const lines = state.lyricLines.filter((line) => selectedLines.has(line.id));
      for (const line of lines) line.isDuet = checked;
    });
  }

  return (
    <>
      <ContextMenuCheckboxItem checked={Bgchecked} onCheckedChange={bgOnCheck}>
        背景歌词
      </ContextMenuCheckboxItem>
      <ContextMenuCheckboxItem checked={DuetChecked} onCheckedChange={duetOnCheck}>
        对唱歌词
      </ContextMenuCheckboxItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        onSelect={() => {
          editLyricLines((state) => {
            state.lyricLines.splice(lineIndex, 0, newLyricLine());
          });
        }}
      >
        在前插入空行
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => {
          editLyricLines((state) => {
            state.lyricLines.splice(lineIndex + 1, 0, newLyricLine());
          });
        }}
      >
        在后插入空行
      </ContextMenuItem>
      <ContextMenuItem onSelect={copyLines} disabled={selectedLinesSize === 0}>
        复制行
      </ContextMenuItem>
      <ContextMenuItem onSelect={combineLines} disabled={!combineEnabled}>
        合并行
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => {
          editLyricLines((state) => {
            if (selectedLinesSize === 0) {
              state.lyricLines.splice(lineIndex, 1);
            } else {
              state.lyricLines = state.lyricLines.filter((line) => !selectedLines.has(line.id));
            }
          });
        }}
      >
        删除行
      </ContextMenuItem>
    </>
  );

  function combineLines() {
    editLyricLines((state) => {
      if (!combineEnabled) return;
      const { minIdx, maxIdx } = combineEnabled;
      const target = state.lyricLines[minIdx];
      if (!target) return;
      for (let i = minIdx + 1; i <= maxIdx; i++) {
        const line = state.lyricLines[i];
        if (!line) continue;
        target.words.push(...line.words);
      }
      target.endTime = state.lyricLines[maxIdx]?.endTime ?? target.endTime;
      state.lyricLines.splice(minIdx + 1, maxIdx - minIdx);
    });
  }

  function copyLines() {
    editLyricLines((state) => {
      state.lyricLines = state.lyricLines.flatMap((line) => {
        if (!selectedLines.has(line.id)) return line;
        const newLine: LyricLine = {
          ...line,
          id: newLyricLine().id,
          words: line.words.map((word) => ({
            ...word,
            id: newLyricWord().id,
          })),
        };
        return [line, newLine];
      });
    });
  }
};
