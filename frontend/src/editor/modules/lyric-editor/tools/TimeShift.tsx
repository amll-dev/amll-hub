/**
 * @description “平移时间” 模态框
 */
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Radio, RadioGroup } from '@/components/ui/radio-group';
import { timeShiftDialogAtom } from '$/states/dialogs.ts';
import {
  lyricLinesAtom,
  pushReviewOperationAtom,
  selectedLinesAtom,
  undoableLyricLinesAtom,
} from '$/states/main.ts';
import { createReviewTimeShiftOperation } from '$/modules/review/services/operation-log-service';
import type { TTMLLyric } from '$/types/ttml';

type ShiftDirection = 'delay' | 'advance';
type ShiftScope = 'all' | 'selected' | 'selected-following' | 'custom';

export const TimeShiftDialog = () => {
  const [open, setOpen] = useAtom(timeShiftDialogAtom);
  const lyricLines = useAtomValue(lyricLinesAtom);
  useAtomValue(undoableLyricLinesAtom);
  const selectedLines = useAtomValue(selectedLinesAtom);
  const setLyricLines = useSetAtom(undoableLyricLinesAtom);
  const pushReviewOperation = useSetAtom(pushReviewOperationAtom);

  const directionName = useId();
  const scopeName = useId();

  const [offsetStr, setOffsetStr] = useState('100');
  const [direction, setDirection] = useState<ShiftDirection>('delay');
  const [scope, setScope] = useState<ShiftScope>('all');
  const [customStart, setCustomStart] = useState('1');
  const [customEnd, setCustomEnd] = useState('1');

  const hasSelection = selectedLines.size > 0;
  const totalLines = lyricLines.lyricLines.length;

  const adjustOffset = (delta: number) => {
    const current = parseInt(offsetStr, 10);
    const val = Number.isNaN(current) ? 0 : current;
    setOffsetStr(Math.max(0, val + delta).toString());
  };

  useEffect(() => {
    if (open) {
      if (hasSelection) {
        setScope('selected');
      } else {
        setScope('all');
      }
      setCustomEnd(totalLines.toString());
    }
  }, [open, hasSelection, totalLines]);

  const handleConfirm = () => {
    const amount = parseInt(offsetStr, 10);
    if (Number.isNaN(amount) || amount === 0) {
      setOpen(false);
      return;
    }

    const finalOffset = direction === 'delay' ? amount : -amount;

    const targetLineIndices = new Set<number>();
    const targetLineIds: string[] = [];

    /** 把 [from, to) 闭开区间的行加入目标集合。 */
    const addRange = (from: number, to: number) => {
      for (let i = Math.max(0, from); i < Math.min(totalLines, to); i++) {
        const line = lyricLines.lyricLines[i];
        if (!line) continue;
        targetLineIndices.add(i);
        targetLineIds.push(line.id);
      }
    };

    if (scope === 'all') {
      addRange(0, totalLines);
    } else if (scope === 'selected') {
      lyricLines.lyricLines.forEach((line, index) => {
        if (selectedLines.has(line.id)) {
          targetLineIndices.add(index);
          targetLineIds.push(line.id);
        }
      });
    } else if (scope === 'selected-following') {
      let firstSelectedIndex = -1;
      lyricLines.lyricLines.forEach((line, index) => {
        if (selectedLines.has(line.id)) {
          if (firstSelectedIndex === -1 || index < firstSelectedIndex) {
            firstSelectedIndex = index;
          }
        }
      });
      if (firstSelectedIndex !== -1) {
        addRange(firstSelectedIndex, totalLines);
      }
    } else if (scope === 'custom') {
      const start = parseInt(customStart, 10);
      const end = parseInt(customEnd, 10);
      if (!Number.isNaN(start) && !Number.isNaN(end)) {
        addRange(start - 1, end);
      }
    }

    if (targetLineIds.length > 0) {
      pushReviewOperation(
        createReviewTimeShiftOperation({
          offsetMs: finalOffset,
          targetLineIds,
        })
      );
    }

    setLyricLines((current: TTMLLyric) => {
      const draft = JSON.parse(JSON.stringify(current)) as TTMLLyric;
      draft.lyricLines.forEach((line, index) => {
        if (targetLineIndices.has(index)) {
          line.startTime = Math.max(0, line.startTime + finalOffset);
          line.endTime = Math.max(0, line.endTime + finalOffset);

          line.words.forEach((word) => {
            word.startTime = Math.max(0, word.startTime + finalOffset);
            word.endTime = Math.max(0, word.endTime + finalOffset);
            if (word.ruby && word.ruby.length > 0) {
              word.ruby.forEach((rubyWord) => {
                rubyWord.startTime = Math.max(0, rubyWord.startTime + finalOffset);
                rubyWord.endTime = Math.max(0, rubyWord.endTime + finalOffset);
              });
            }
          });
        }
      });
      return draft;
    });

    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-[450px]">
        <DialogTitle>平移时间</DialogTitle>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-bold">偏移量 (ms)</span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="icon"
                className="size-8 shrink-0"
                onClick={() => adjustOffset(-50)}
                title="- 50ms"
              >
                <ArrowLeft className="size-4" />
              </Button>
              <Input
                type="number"
                min="0"
                value={offsetStr}
                onChange={(e) => setOffsetStr(e.target.value)}
                placeholder="100"
                className="flex-1"
              />
              <Button
                variant="secondary"
                size="icon"
                className="size-8 shrink-0"
                onClick={() => adjustOffset(50)}
                title="+ 50ms"
              >
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-sm font-bold">方向</span>
            <RadioGroup className="flex-row gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Radio
                  name={directionName}
                  value="advance"
                  checked={direction === 'advance'}
                  onChange={() => setDirection('advance')}
                />
                提前 (-)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Radio
                  name={directionName}
                  value="delay"
                  checked={direction === 'delay'}
                  onChange={() => setDirection('delay')}
                />
                延后 (+)
              </label>
            </RadioGroup>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-bold">应用于</span>
            <RadioGroup>
              <label className="flex items-center gap-2 text-sm">
                <Radio
                  name={scopeName}
                  value="all"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                />
                所有行
              </label>

              <label className="flex items-center gap-2 text-sm">
                <Radio
                  name={scopeName}
                  value="selected"
                  checked={scope === 'selected'}
                  onChange={() => setScope('selected')}
                  disabled={!hasSelection}
                />
                所选行
                {hasSelection && ` (${selectedLines.size})`}
              </label>

              <label className="flex items-center gap-2 text-sm">
                <Radio
                  name={scopeName}
                  value="selected-following"
                  checked={scope === 'selected-following'}
                  onChange={() => setScope('selected-following')}
                  disabled={!hasSelection}
                />
                所选行及其后续
              </label>

              <label className="flex items-center gap-2 text-sm">
                <Radio
                  name={scopeName}
                  value="custom"
                  checked={scope === 'custom'}
                  onChange={() => setScope('custom')}
                />
                自定义范围
              </label>
            </RadioGroup>
          </div>

          {scope === 'custom' && (
            <div className="ml-4 flex items-center gap-2">
              <span className="text-sm">从</span>
              <Input
                className="w-[60px]"
                type="number"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
              <span className="text-sm">行 到</span>
              <Input
                className="w-[60px]"
                type="number"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
              <span className="text-sm">行</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">取消</Button>
          </DialogClose>
          <Button onClick={handleConfirm}>应用</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
