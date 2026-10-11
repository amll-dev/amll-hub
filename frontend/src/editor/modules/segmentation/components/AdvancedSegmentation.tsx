/**
 * @description 高级分词组件
 */

import { Info, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Radio } from '@/components/ui/radio-group';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAtom, useAtomValue } from 'jotai';
import { useSetImmerAtom } from 'jotai-immer';
import { memo, useCallback, useMemo, useState } from 'react';
import {
  segmentationCustomRulesAtom,
  segmentationIgnoreListTextAtom,
  segmentationLangAtom,
  segmentationPunctuationModeAtom,
  segmentationPunctuationWeightAtom,
  segmentationRangeEndAtom,
  segmentationRangeStartAtom,
  segmentationRemoveEmptySegmentsAtom,
  segmentationScopeAtom,
  segmentationSplitCJKAtom,
  segmentationSplitEnglishAtom,
} from '$/modules/segmentation/states';
import { SUPPORTED_LANGUAGES } from '$/modules/segmentation/utils/hyphen-loader';
import { segmentLyricLines } from '$/modules/segmentation/utils/segmentation.ts';
import { advancedSegmentationDialogAtom } from '$/states/dialogs.ts';
import { lyricLinesAtom } from '$/states/main.ts';
import { type LyricWord, newLyricLine, newLyricWord } from '$/types/ttml';
import { segmentationLogger } from '../logger';
import { useSegmentationConfig } from '../utils/useSegmentationConfig';
import styles from './AdvancedSegmentation.module.css';
import { ManualWordSplitter } from './ManualWordSplitter';

export const AdvancedSegmentationDialog = memo(() => {
  const [open, setOpen] = useAtom(advancedSegmentationDialogAtom);
  const [scope, setScope] = useAtom(segmentationScopeAtom);
  const { config: segmentationConfig, isLoading: isLoadingLang } = useSegmentationConfig();
  const [rangeStart, setRangeStart] = useAtom(segmentationRangeStartAtom);
  const [rangeEnd, setRangeEnd] = useAtom(segmentationRangeEndAtom);
  const [splitCJK, setSplitCJK] = useAtom(segmentationSplitCJKAtom);
  const [splitEnglish, setSplitEnglish] = useAtom(segmentationSplitEnglishAtom);
  const [punctuationMode, setPunctuationMode] = useAtom(segmentationPunctuationModeAtom);
  const [punctuationWeight, setPunctuationWeight] = useAtom(segmentationPunctuationWeightAtom);
  const [removeEmptySegments, setRemoveEmptySegments] = useAtom(
    segmentationRemoveEmptySegmentsAtom
  );
  const [ignoreListText, setIgnoreListText] = useAtom(segmentationIgnoreListTextAtom);
  const [customRules, setCustomRules] = useAtom(segmentationCustomRulesAtom);

  const [testInput, setTestInput] = useState('');
  const [manualWordInput, setManualWordInput] = useState('');
  const [manualSplitIndices, setManualSplitIndices] = useState(new Set<number>());

  const editLyricLines = useSetImmerAtom(lyricLinesAtom);
  const currentLyric = useAtomValue(lyricLinesAtom);

  const [lang, setLang] = useAtom(segmentationLangAtom);

  const toggleSplitPoint = useCallback((index: number) => {
    setManualSplitIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const handleAddRule = useCallback(() => {
    if (!manualWordInput) return;

    const parts: string[] = [];
    let lastIndex = 0;
    const sortedIndices = Array.from(manualSplitIndices).sort((a, b) => a - b);

    for (const index of sortedIndices) {
      parts.push(manualWordInput.slice(lastIndex, index));
      lastIndex = index;
    }
    parts.push(manualWordInput.slice(lastIndex));

    const next = new Map(customRules);
    next.set(manualWordInput, parts);
    setCustomRules(next);

    setManualWordInput('');
    setManualSplitIndices(new Set());
  }, [manualWordInput, manualSplitIndices, customRules, setCustomRules]);

  const handleDeleteRule = useCallback(
    (word: string) => {
      const next = new Map(customRules);
      next.delete(word);
      setCustomRules(next);
    },
    [customRules, setCustomRules]
  );

  const handleEditRule = useCallback((word: string, parts: string[]) => {
    setManualWordInput(word);

    const indices = new Set<number>();
    let currentIndex = 0;
    for (let i = 0; i < parts.length - 1; i++) {
      currentIndex += parts[i]?.length ?? 0;
      indices.add(currentIndex);
    }
    setManualSplitIndices(indices);
  }, []);

  const testPreview = useMemo(() => {
    if (!testInput.trim()) {
      return;
    }

    const testWord: LyricWord = {
      ...newLyricWord(),
      word: testInput,
      startTime: 0,
      endTime: 10000,
    };

    try {
      const tempLine = { ...newLyricLine(), words: [testWord] };
      const processedLines = segmentLyricLines([tempLine], segmentationConfig);
      const resultWords = processedLines[0]?.words;

      if (!resultWords || resultWords.length === 0) return;

      return (
        <div className="flex flex-wrap items-center gap-1">
          {resultWords.map((w, i) => (
            <span className={styles.previewWord} key={`preview-word-${i}-${w.id}`}>
              {w.word.trim() === '' ? (
                <span className="text-ink-3">
                  {w.word.length > 0 ? `空格x${w.word.length}` : '空白'}
                </span>
              ) : (
                w.word
              )}
            </span>
          ))}
        </div>
      );
    } catch (error) {
      segmentationLogger.error('分词预览出错:', error);
      return <span className="text-ink-3">分词预览出错</span>;
    }
  }, [testInput, segmentationConfig]);

  const onApply = useCallback(() => {
    const maxLines = currentLyric.lyricLines.length;
    let startIndex = 0;
    let endIndex = maxLines;

    if (scope === 'range') {
      startIndex = (parseInt(rangeStart, 10) || 1) - 1;
      endIndex = parseInt(rangeEnd, 10) || maxLines;
      startIndex = Math.max(0, Math.min(startIndex, maxLines));
      endIndex = Math.max(startIndex, Math.min(endIndex, maxLines));
    }

    editLyricLines((draft) => {
      const linesToProcess = draft.lyricLines.slice(startIndex, endIndex);
      const processedLines = segmentLyricLines(linesToProcess, segmentationConfig);
      draft.lyricLines.splice(startIndex, processedLines.length, ...processedLines);
    });

    setOpen(false);
  }, [
    segmentationConfig,
    scope,
    rangeStart,
    rangeEnd,
    editLyricLines,
    currentLyric.lyricLines.length,
    setOpen,
  ]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] max-w-[800px] overflow-y-auto">
        <DialogTitle>高级分词</DialogTitle>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-sm text-foreground">应用范围</span>
            <div role="radiogroup" className="flex flex-col gap-1">
              <label className="flex items-center gap-2 text-sm">
                <Radio
                  name="segmentation-scope"
                  value="all"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                />
                <span>所有歌词行</span>
              </label>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <Radio
                  name="segmentation-scope"
                  value="range"
                  checked={scope === 'range'}
                  onChange={() => setScope('range')}
                />
                <span>从第</span>
                <Input
                  type="number"
                  value={rangeStart}
                  onChange={(e) => setRangeStart(e.target.value)}
                  disabled={scope !== 'range'}
                  className="max-w-20"
                />
                <span>行到第</span>
                <Input
                  type="number"
                  value={rangeEnd}
                  onChange={(e) => setRangeEnd(e.target.value)}
                  disabled={scope !== 'range'}
                  className="max-w-20"
                />
                <span>行</span>
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm text-foreground">自动分词规则</span>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={splitCJK} onCheckedChange={(c) => setSplitCJK(c)} />
              CJK 按字符分词
            </label>

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={splitEnglish} onCheckedChange={(c) => setSplitEnglish(c)} />
                西文单词按音节分词
              </label>

              {splitEnglish && (
                <div className="ml-5 flex flex-col gap-1">
                  <span className="text-sm text-ink-3">选择一个分词语言模型：</span>
                  <Select
                    value={lang}
                    onChange={(e) => setLang(e.currentTarget.value)}
                    disabled={isLoadingLang}
                    className="w-full"
                  >
                    {SUPPORTED_LANGUAGES.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>

            <div className="flex items-start gap-2 rounded-md border border-line bg-card px-3 py-2">
              <Info className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <span className="text-sm text-ink-3">
                分词后，原音节的时长会按照字符数和权重重新分配给新的音节
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <span className="text-sm text-foreground">后处理</span>
            <div className="flex flex-col gap-2">
              <span className="text-sm text-foreground">标点符号处理:</span>
              <div role="radiogroup" className="flex flex-col gap-1">
                <label className="flex items-center gap-2 text-sm">
                  <Radio
                    name="segmentation-punctuation"
                    value="merge"
                    checked={punctuationMode === 'merge'}
                    onChange={() => setPunctuationMode('merge')}
                  />
                  <span>合并到相邻音节</span>
                </label>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <Radio
                    name="segmentation-punctuation"
                    value="standalone"
                    checked={punctuationMode === 'standalone'}
                    onChange={() => setPunctuationMode('standalone')}
                  />
                  <span>设为新音节</span>
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm text-foreground">标点时长权重:</span>
              <Input
                type="number"
                value={punctuationWeight}
                onChange={(e) => setPunctuationWeight(e.target.value)}
                disabled={punctuationMode !== 'standalone'}
                className="max-w-[100px]"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={removeEmptySegments}
                onCheckedChange={(c) => setRemoveEmptySegments(c)}
              />
              <span>移除空白音节</span>
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm text-foreground">自定义分词规则</span>
            <Input
              placeholder="输入单词进行手动分割..."
              value={manualWordInput}
              onChange={(e) => {
                setManualWordInput(e.target.value);
                setManualSplitIndices(new Set());
              }}
            />
            <ManualWordSplitter
              word={manualWordInput}
              splitIndices={manualSplitIndices}
              onSplitIndexToggle={toggleSplitPoint}
            />
            <Button type="button" onClick={handleAddRule} disabled={!manualWordInput}>
              添加到自定义规则
            </Button>
            {customRules.size > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-sm text-foreground">自定义规则列表:</span>
                <div className={styles.ruleList}>
                  {Array.from(customRules.entries()).map(([word, parts]) => (
                    <div
                      key={word}
                      className="flex items-center justify-between border-b-[3px] border-line pt-1 pb-2 mb-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={styles.previewWord}>{word}</span>
                        <span className="text-ink-3">→</span>
                        {parts.map((part, i) => (
                          <span
                            className={styles.previewWord}
                            key={`${word}-${part}-${
                              // biome-ignore lint/suspicious/noArrayIndexKey: 这个列表顺序完全不会发生变化
                              i
                            }`}
                          >
                            {part.trim() === '' ? (
                              <span className="text-ink-3">
                                {part.length > 0 ? `空格x${part.length}` : '空白'}
                              </span>
                            ) : (
                              part
                            )}
                          </span>
                        ))}
                      </div>

                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => handleEditRule(word, parts)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDeleteRule(word)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm text-foreground">忽略列表</span>
            <Textarea
              placeholder="每行一个单词，在此列表中的单词将不会被自动分词"
              value={ignoreListText}
              onChange={(e) => setIgnoreListText(e.target.value)}
              className="min-h-[100px] resize-y"
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm text-foreground">分词测试</span>
            <Input
              placeholder="输入一行歌词或单词进行测试..."
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
            />
            <span className="text-sm text-foreground">预览结果:</span>
            <div className="min-h-[4em] rounded-md bg-muted p-2">{testPreview}</div>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-3">
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              取消
            </Button>
          </DialogClose>
          <Button type="button" onClick={onApply}>
            应用
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});
