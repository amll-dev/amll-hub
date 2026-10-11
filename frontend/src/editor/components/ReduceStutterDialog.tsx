import { useAtom, useAtomValue } from 'jotai';
import { useSetImmerAtom } from 'jotai-immer';
import { Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { msToTimestamp } from '@/lib/format';
import { audioEngine } from '$/modules/audio/audio-engine';
import { reduceStutterDialogAtom } from '$/states/dialogs.ts';
import { lyricLinesAtom } from '$/states/main.ts';
import type { LyricWord } from '$/types/ttml';

/** 音节间隔小于该值（ms）视为卡顿 */
const STUTTER_GAP_THRESHOLD = 100;

interface StutterPair {
  lineIndex: number;
  wordIndex: number;
  nextWordIndex: number;
  prevWord: LyricWord;
  nextWord: LyricWord;
  gap: number;
}

export function ReduceStutterDialog() {
  const [open, setOpen] = useAtom(reduceStutterDialogAtom);
  const lyricLines = useAtomValue(lyricLinesAtom);
  const setLyricLines = useSetImmerAtom(lyricLinesAtom);
  const [selectedPairs, setSelectedPairs] = useState<Set<string>>(new Set());

  const stutterPairs = useMemo<StutterPair[]>(() => {
    const pairs: StutterPair[] = [];
    lyricLines.lyricLines.forEach((line, lineIndex) => {
      // 过滤掉纯空白音节，只比较有实际内容的音节
      const nonSpaceWords = line.words.filter((w) => w.word.trim().length > 0);
      for (let i = 0; i < nonSpaceWords.length - 1; i++) {
        const currentWord = nonSpaceWords[i];
        const nextWord = nonSpaceWords[i + 1];
        if (!currentWord || !nextWord) continue;

        const gap = nextWord.startTime - currentWord.endTime;
        if (gap > 0 && gap < STUTTER_GAP_THRESHOLD) {
          const wordIndex = line.words.findIndex((w) => w.id === currentWord.id);
          const nextWordIndex = line.words.findIndex((w) => w.id === nextWord.id);
          pairs.push({
            lineIndex,
            wordIndex,
            nextWordIndex,
            prevWord: currentWord,
            nextWord,
            gap,
          });
        }
      }
    });
    return pairs;
  }, [lyricLines.lyricLines]);

  // 打开时默认全选所有卡顿项
  useEffect(() => {
    if (open.open) {
      setSelectedPairs(new Set(stutterPairs.map((_, index) => index.toString())));
    }
  }, [open.open, stutterPairs]);

  const togglePair = (index: string) => {
    setSelectedPairs((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    const selectedIndices = Array.from(selectedPairs).map((id) => parseInt(id, 10));

    setLyricLines((draft) => {
      selectedIndices.forEach((pairIndex) => {
        const pair = stutterPairs[pairIndex];
        if (!pair) return;

        const line = draft.lyricLines[pair.lineIndex];
        if (!line) return;

        const prevWord = line.words[pair.wordIndex];
        const nextWord = line.words[pair.nextWordIndex];
        if (!prevWord || !nextWord) return;

        // 把两个音节的边界对齐到中间时间点
        const middleTime = Math.round((prevWord.endTime + nextWord.startTime) / 2);
        prevWord.endTime = middleTime;
        nextWord.startTime = middleTime;
      });
    });

    setOpen({ open: false });
  };

  const handleClose = () => setOpen({ open: false });

  const handlePlay = (pair: StutterPair) => {
    // 播放前一个音节开始前 100ms 到后一个音节结束后 100ms
    const startTime = Math.max(0, pair.prevWord.startTime - 100) / 1000;
    const endTime = (pair.nextWord.endTime + 100) / 1000;
    audioEngine.auditionRange(startTime, endTime);
  };

  return (
    <Dialog open={open.open} onOpenChange={(v) => setOpen({ open: v })}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>消减卡顿</DialogTitle>
          <DialogDescription>
            检测到以下音节间隔小于 {STUTTER_GAP_THRESHOLD}ms，选中项将被调整为中间时间点
          </DialogDescription>
        </DialogHeader>

        {stutterPairs.length === 0 ? (
          <div className="py-6 text-center text-sm text-ink-3">未检测到卡顿</div>
        ) : (
          <ScrollArea className="max-h-96">
            <div className="flex flex-col gap-2 pr-3">
              {stutterPairs.map((pair, index) => (
                <div
                  key={`${pair.lineIndex}-${pair.wordIndex}`}
                  className="flex items-center gap-2 rounded-md bg-surface-2 p-2"
                >
                  <Checkbox
                    checked={selectedPairs.has(index.toString())}
                    onCheckedChange={() => togglePair(index.toString())}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    title="播放"
                    onClick={() => handlePlay(pair)}
                  >
                    <Play className="size-3.5" />
                  </Button>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-2">
                    {pair.prevWord.word} [{msToTimestamp(pair.prevWord.startTime)}~
                    {msToTimestamp(pair.prevWord.endTime)}] - {pair.nextWord.word} [
                    {msToTimestamp(pair.nextWord.startTime)}~{msToTimestamp(pair.nextWord.endTime)}]
                    : {pair.gap} ms
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={stutterPairs.length === 0 || selectedPairs.size === 0}
          >
            确认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
