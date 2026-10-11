import { useAtom, useAtomValue } from 'jotai';
import { useSetImmerAtom } from 'jotai-immer';
import { Info } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  segmentationCustomRulesAtom,
  segmentationIgnoreListTextAtom,
  segmentationLangAtom,
  segmentationPunctuationModeAtom,
  segmentationPunctuationWeightAtom,
  segmentationRemoveEmptySegmentsAtom,
  segmentationSplitCJKAtom,
  segmentationSplitEnglishAtom,
  splitWordApplyToAllAtom,
  splitWordIgnoreCaseAtom,
} from '$/modules/segmentation/states';
import type { HyphenatorFunc, SegmentationConfig } from '$/modules/segmentation/types';
import { loadHyphenator } from '$/modules/segmentation/utils/hyphen-loader.ts';
import { recalculateWordTime, segmentWord } from '$/modules/segmentation/utils/segmentation.ts';
import { splitWordDialogAtom } from '$/states/dialogs.ts';
import { editingWordStateAtom, lyricLinesAtom } from '$/states/main';
import type { LyricWord } from '$/types/ttml';
import { ManualWordSplitter } from './ManualWordSplitter';

export const SplitWordDialog = memo(() => {
  const [splitWordDialog, splitWordDialogOpen] = useAtom(splitWordDialogAtom);
  const editingState = useAtomValue(editingWordStateAtom);
  const lyricLines = useAtomValue(lyricLinesAtom);
  const editLyricLines = useSetImmerAtom(lyricLinesAtom);

  const [splitIndices, setSplitIndices] = useState(new Set<number>());
  const [targetWordText, setTargetWordText] = useState('');

  const [applyToAll, setApplyToAll] = useAtom(splitWordApplyToAllAtom);
  const [ignoreCase, setIgnoreCase] = useAtom(splitWordIgnoreCaseAtom);

  const splitCJK = useAtomValue(segmentationSplitCJKAtom);
  const splitEnglish = useAtomValue(segmentationSplitEnglishAtom);
  const punctuationMode = useAtomValue(segmentationPunctuationModeAtom);
  const punctuationWeight = useAtomValue(segmentationPunctuationWeightAtom);
  const removeEmptySegments = useAtomValue(segmentationRemoveEmptySegmentsAtom);
  const ignoreListText = useAtomValue(segmentationIgnoreListTextAtom);
  const customRules = useAtomValue(segmentationCustomRulesAtom);
  const lang = useAtomValue(segmentationLangAtom);
  const [activeHyphenator, setActiveHyphenator] = useState<HyphenatorFunc | undefined>(undefined);

  useEffect(() => {
    let isMounted = true;

    const fetchHyphenator = async () => {
      const func = await loadHyphenator(lang);
      if (isMounted && func) {
        setActiveHyphenator(() => func);
      }
    };

    fetchHyphenator();

    return () => {
      isMounted = false;
    };
  }, [lang]);

  const ignoreList = useMemo(() => {
    return new Set(ignoreListText.split('\n').filter((line) => line.trim() !== ''));
  }, [ignoreListText]);

  const segmentationConfig = useMemo((): SegmentationConfig => {
    const weight = parseFloat(punctuationWeight);
    const finalPunctuationWeight = Number.isNaN(weight) ? 0.2 : weight;

    return {
      splitCJK,
      splitEnglish,
      punctuationMode,
      punctuationWeight: finalPunctuationWeight,
      removeEmptySegments,
      ignoreList,
      customRules,
      hyphenator: activeHyphenator,
    };
  }, [
    splitCJK,
    splitEnglish,
    punctuationMode,
    punctuationWeight,
    removeEmptySegments,
    ignoreList,
    customRules,
    activeHyphenator,
  ]);

  useEffect(() => {
    if (!splitWordDialog) {
      return;
    }

    const line = lyricLines.lyricLines[editingState.lineIndex];
    const word = line?.words[editingState.wordIndex];

    if (word) {
      setTargetWordText(word.word);

      const resultWords = segmentWord(word, segmentationConfig);
      if (resultWords.length > 1) {
        const indices = new Set<number>();
        let currentIndex = 0;
        for (let i = 0; i < resultWords.length - 1; i++) {
          currentIndex += resultWords[i]?.word.length ?? 0;
          indices.add(currentIndex);
        }
        setSplitIndices(indices);
      } else {
        setSplitIndices(new Set());
      }
    } else {
      setTargetWordText('');
      setSplitIndices(new Set());
    }
  }, [
    splitWordDialog,
    editingState.lineIndex,
    editingState.wordIndex,
    lyricLines,
    segmentationConfig,
  ]);

  const toggleSplitPoint = useCallback((index: number) => {
    setSplitIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const handleSplit = useCallback(() => {
    if (!targetWordText) return;

    const sortedIndices = Array.from(splitIndices).sort((a, b) => a - b);
    const buildSegments = (text: string) => {
      const parts: string[] = [];
      let lastIndex = 0;
      for (const index of sortedIndices) {
        if (index <= lastIndex) continue;
        parts.push(text.slice(lastIndex, index));
        lastIndex = index;
      }
      parts.push(text.slice(lastIndex));
      return parts.filter((p) => p.length > 0);
    };

    const targetSegments = buildSegments(targetWordText);

    if (targetSegments.length === 0) return;

    const createNewWords = (targetWord: LyricWord, segments: string[]): LyricWord[] => {
      return recalculateWordTime(targetWord, segments, segmentationConfig);
    };

    editLyricLines((state) => {
      if (applyToAll) {
        const targetLower = targetWordText.toLowerCase();

        for (const line of state.lyricLines) {
          line.words = line.words.flatMap((word) => {
            const isMatch = ignoreCase
              ? word.word.toLowerCase() === targetLower
              : word.word === targetWordText;

            if (isMatch) {
              const wordSegments = ignoreCase ? buildSegments(word.word) : targetSegments;
              return createNewWords(word, wordSegments.length > 0 ? wordSegments : targetSegments);
            }
            return word;
          });
        }
      } else {
        const line = state.lyricLines[editingState.lineIndex];
        if (line) {
          const word = line.words[editingState.wordIndex];
          if (word && word.word === targetWordText) {
            line.words.splice(editingState.wordIndex, 1, ...createNewWords(word, targetSegments));
          }
        }
      }
    });
  }, [
    targetWordText,
    splitIndices,
    editLyricLines,
    applyToAll,
    ignoreCase,
    editingState.lineIndex,
    editingState.wordIndex,
    segmentationConfig,
  ]);

  return (
    <Dialog open={splitWordDialog} onOpenChange={splitWordDialogOpen}>
      <DialogContent>
        <DialogTitle>拆分单词</DialogTitle>
        <div className="flex flex-col gap-2">
          <div className="rounded-lg border border-line bg-card p-3">
            <div className="flex items-start gap-2">
              <Info className="size-4 shrink-0 text-ink-3" />
              <span className="text-sm text-ink-3">
                拆分后新单词将会按自身单词字符平均分配原单词的始末时间，如有空拍则会被清除
              </span>
            </div>
          </div>

          <div className="my-3">
            <ManualWordSplitter
              word={targetWordText}
              splitIndices={splitIndices}
              onSplitIndexToggle={toggleSplitPoint}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="font-normal">
              <Checkbox checked={applyToAll} onCheckedChange={(c) => setApplyToAll(Boolean(c))} />
              将此拆分规则应用于所有相同的单词
            </Label>

            <Label className="font-normal" style={{ opacity: applyToAll ? 1 : 0.5 }}>
              <Checkbox
                disabled={!applyToAll}
                checked={ignoreCase}
                onCheckedChange={(c) => setIgnoreCase(Boolean(c))}
              />
              忽略大小写
            </Label>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button onClick={handleSplit}>执行</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
