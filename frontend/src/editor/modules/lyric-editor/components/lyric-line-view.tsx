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

import {
  AddFilled,
  LinkMultiple20Regular,
  People24Regular,
  TextAlignRightFilled,
  VideoBackgroundEffectFilled,
} from '@fluentui/react-icons';
import { Button, ContextMenu, Flex, IconButton, Text, TextField } from '@radix-ui/themes';
import classNames from 'classnames';
import { motion } from 'framer-motion';
import type { Draft } from 'immer';
import { type Atom, atom, useAtomValue, useStore } from 'jotai';
import { splitAtom } from 'jotai/utils';
import { useSetImmerAtom } from 'jotai-immer';
import {
  type FC,
  Fragment,
  memo,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { LyricLineMenu } from '$/components/Menus/lyric-line-menu.tsx';
import { predictLineRomanization } from '$/modules/segmentation/utils/Transliteration/distributor';
import {
  enableAutoRomanizationPredictionAtom,
  showLineRomanizationAtom,
  showLineTranslationAtom,
  showTimestampsAtom,
  showWordRomanizationInputAtom,
} from '$/modules/settings/states/index.ts';
import { visualizeTimestampUpdateAtom } from '$/modules/settings/states/sync.ts';
import {
  dragSourceAtom,
  isDraggingGlobalAtom,
  lyricLinesAtom,
  selectedLinesAtom,
  selectedWordsAtom,
  showEndTimeAsDurationAtom,
  ToolMode,
  toolModeAtom,
} from '$/states/main.ts';
import { type LyricLine, newLyricLine, newLyricWord, type TTMLLyric } from '$/types/ttml.ts';
import { containsRadicalChar } from '$/utils/detect-radical.ts';
import { msToTimestamp } from '@/lib/format';
import styles from './index.module.css';
import LyricWordView from './lyric-word-view.tsx';
import { RomanWordView } from './roman-word-view.tsx';

const parseRubyShortcut = (value: string) => {
  if (value.endsWith('|')) {
    return {
      word: value.slice(0, -1),
      enableRuby: true,
    };
  }
  return {
    word: value,
    enableRuby: false,
  };
};

const parseLineVocalIds = (value?: string | string[]) => {
  if (!value) return [];
  const parts = Array.isArray(value) ? value : value.split(/[\s,]+/);
  return parts.map((v) => v.trim()).filter(Boolean);
};

// 定义一个派生 Atom，用于计算每一行的显示行号
const lineDisplayNumbersAtom = atom((get) => {
  const { lyricLines } = get(lyricLinesAtom);
  const displayNumbers: number[] = [];
  let currentNumber = 0;

  for (const [index, line] of lyricLines.entries()) {
    // 核心逻辑：只有当不是背景行时，计数器才+1
    // 这样背景行就会自动继承上一行的行号
    // 特例：首行从 1 开始
    if (!index || !line.isBG) {
      currentNumber++;
    }
    displayNumbers.push(currentNumber);
  }

  return displayNumbers;
});

const LyricLineScroller = ({
  lineAtom,
  wordsContainer,
  editingRomanWordIndex,
}: {
  lineAtom: Atom<LyricLine>;
  wordsContainer: HTMLDivElement | null;
  editingRomanWordIndex: number | null;
}) => {
  const scrollToIndexAtom = useMemo(
    () =>
      atom((get) => {
        const line = get(lineAtom);
        const selectedWords = get(selectedWordsAtom);
        if (selectedWords.size === 0) return Number.NaN;
        let scrollToIndex = Number.NaN;
        let i = 0;
        for (const word of line.words) {
          if (selectedWords.has(word.id)) {
            scrollToIndex = i;
            break;
          }
          i++;
        }
        return scrollToIndex;
      }),
    [lineAtom]
  );
  const scrollToIndex = useAtomValue(scrollToIndexAtom);

  useEffect(() => {
    const targetIndex = !Number.isNaN(scrollToIndex) ? scrollToIndex : editingRomanWordIndex;
    if (targetIndex === null || Number.isNaN(targetIndex)) return;
    if (!wordsContainer) return;
    const wordEl = wordsContainer.children[targetIndex] as HTMLElement;
    if (!wordEl) return;
    wordsContainer.scrollTo({
      left: wordEl.offsetLeft - wordsContainer.clientWidth / 2,
      behavior: 'auto',
    });
  }, [scrollToIndex, editingRomanWordIndex, wordsContainer]);

  useEffect(() => {
    if (!wordsContainer) return;
    const handleFocusIn = (evt: FocusEvent) => {
      const target = evt.target as HTMLElement | null;
      if (!target) return;
      const wordGroup = target.closest<HTMLElement>('[data-word-index]');
      if (!wordGroup || !wordsContainer.contains(wordGroup)) return;
      wordsContainer.scrollTo({
        left: wordGroup.offsetLeft - wordsContainer.clientWidth / 2,
        behavior: 'auto',
      });
    };
    wordsContainer.addEventListener('focusin', handleFocusIn);
    return () => {
      wordsContainer.removeEventListener('focusin', handleFocusIn);
    };
  }, [wordsContainer]);

  return null;
};

const SubLineEdit = memo(
  ({
    lineAtom,
    lineIndex,
    type,
  }: {
    lineAtom: Atom<LyricLine>;
    lineIndex: number;
    type: 'translatedLyric' | 'romanLyric';
  }) => {
    const editLyricLines = useSetImmerAtom(lyricLinesAtom);
    const line = useAtomValue(lineAtom);
    const [editing, setEditing] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const { t } = useTranslation();

    const onEnter = useCallback(
      (evt: SyntheticEvent<HTMLInputElement>) => {
        setEditing(false);
        const newValue = evt.currentTarget.value;
        if (newValue !== line[type]) {
          editLyricLines((state: Draft<TTMLLyric>) => {
            const targetLine = state.lyricLines[lineIndex];
            const previousValue = targetLine[type];
            targetLine[type] = newValue;
            const syncByLang = (byLang?: Record<string, string>) => {
              if (!byLang) return;
              const keys = Object.keys(byLang);
              if (keys.length === 1) {
                byLang[keys[0]] = newValue;
                return;
              }
              const matched = Object.entries(byLang).find(([, value]) => {
                const nextValue = value.trim().length > 0 ? value : '';
                return nextValue === previousValue && value.trim().length > 0;
              })?.[0];
              if (matched) {
                byLang[matched] = newValue;
                return;
              }
              if (byLang.und !== undefined) {
                byLang.und = newValue;
              }
            };
            if (type === 'translatedLyric') {
              syncByLang(targetLine.translatedLyricByLang);
            }
            if (type === 'romanLyric') {
              syncByLang(targetLine.romanLyricByLang);
            }
          });
        }
      },
      [editLyricLines, line, lineIndex, type]
    );

    useEffect(() => {
      if (editing) {
        setInputValue(line[type] || '');
      }
    }, [editing, line, type]);

    const label = useMemo(
      () =>
        type === 'translatedLyric'
          ? t('lyricLineView.translatedLabel', '翻译：')
          : t('lyricLineView.romanLabel', '音译：'),
      [type, t]
    );

    return (
      <Flex align="baseline">
        <Text size="2">{label}</Text>
        {editing ? (
          <div
            className={styles.autoSizeInput}
            style={{
              maxWidth: 'calc(100% - 4rem)',
              flexShrink: 1,
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div
              className={styles.autoSizeInputText}
              style={{
                padding: 0,
                maxWidth: '100%',
                overflow: 'hidden',
              }}
            >
              {`${inputValue}  `}
            </div>

            <TextField.Root
              className={styles.autoSizeInputField}
              autoFocus
              size="1"
              value={inputValue}
              onChange={(evt) => setInputValue(evt.currentTarget.value)}
              onBlur={onEnter}
              onKeyDown={(evt) => {
                if (evt.key === 'Enter') onEnter(evt);
              }}
            />
          </div>
        ) : (
          <Button
            size="2"
            color="gray"
            variant="ghost"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(evt) => {
              evt.stopPropagation();
              setEditing(true);
            }}
            style={{
              textAlign: 'left',
              maxWidth: 'calc(100% - 4rem)',
              wordBreak: 'break-all',
            }}
          >
            {line[type] || <Text color="gray">{t('lyricLineView.empty', '无')}</Text>}
          </Button>
        )}
      </Flex>
    );
  }
);

export const LyricLineView: FC<{
  lineAtom: Atom<LyricLine>;
  lineIndex: number;
  playbackHighlightedLineId?: string;
  onPointerDown: (
    e: React.PointerEvent,
    lineId: string,
    index: number,
    allowDrag?: boolean
  ) => void;
}> = memo(({ lineAtom, lineIndex, playbackHighlightedLineId, onPointerDown }) => {
  const { t } = useTranslation();
  const lyricState = useAtomValue(lyricLinesAtom);
  /*
   * `?? []` 每次渲染都会产生**新的数组引用**，会让下面两个 useMemo
   * 每帧都重算（vocalTagMap / vocalTagIds）。用 useMemo 把引用稳定住，
   * 只有 `lyricState.vocalTags` 真的变了才换引用。
   */
  const vocalTags = useMemo(() => lyricState.vocalTags ?? [], [lyricState.vocalTags]);
  const vocalTagMap = useMemo(() => {
    return new Map(vocalTags.map((tag) => [tag.key, tag.value]));
  }, [vocalTags]);
  const vocalTagIds = useMemo(
    () => Array.from(new Set(vocalTags.map((tag) => tag.key).filter(Boolean))),
    [vocalTags]
  );
  const line = useAtomValue(lineAtom);
  const annotationWordMarks = useMemo(
    () => ({
      added: new Set<string>(),
      removed: new Set<string>(),
      focused: new Set<string>(),
      addedGhosts: [] as Array<{
        index: number;
        text: string;
        focused: boolean;
        itemKey: string;
      }>,
    }),
    []
  );
  const isPlaybackHighlighted = playbackHighlightedLineId === line.id;
  const lineSelectedAtom = useMemo(() => {
    const a = atom((get) => get(selectedLinesAtom).has(line.id));
    if (import.meta.env.DEV) {
      a.debugLabel = `lineSelectedAtom-${line.id}`;
    }
    return a;
  }, [line.id]);
  const wordsAtom = useMemo(() => splitAtom(atom((get) => get(lineAtom).words)), [lineAtom]);
  const words = useAtomValue(wordsAtom);
  const lineSelected = useAtomValue(lineSelectedAtom);
  const editLyricLines = useSetImmerAtom(lyricLinesAtom);
  const lyricLines = useAtomValue(lyricLinesAtom);
  const visualizeTimestampUpdate = useAtomValue(visualizeTimestampUpdateAtom);
  const showTimestamps = useAtomValue(showTimestampsAtom);
  const toolMode = useAtomValue(toolModeAtom);
  const isDragging = useAtomValue(isDraggingGlobalAtom);
  const dragSource = useAtomValue(dragSourceAtom);
  const store = useStore();
  const isDragged = isDragging && dragSource === 'main' && lineSelected;
  const wordsContainerRef = useRef<HTMLDivElement>(null);

  // 创建一个仅订阅当前行显示行号的 atom，优化性能
  const displayNumberAtom = useMemo(
    () => atom((get) => get(lineDisplayNumbersAtom)[lineIndex]),
    [lineIndex]
  );
  const displayNumber = useAtomValue(displayNumberAtom);

  const hasError = useMemo(() => {
    if (line.startTime > line.endTime) {
      return true;
    }
    for (const word of line.words) {
      if (word.startTime > word.endTime) {
        return true;
      }
    }
    return false;
  }, [line.startTime, line.endTime, line.words]);

  // 检查是否需要 Agent 警告：如果歌词有 Agent，但该行没有设置 Agent，则显示警告（背景行除外）
  const hasAgentWarning = useMemo(() => {
    // 背景行不需要检查 Agent
    if (line.isBG) {
      return false;
    }
    // 如果歌词没有定义任何 Agent，不需要警告
    if (!lyricLines.agents || lyricLines.agents.length === 0) {
      return false;
    }
    // 如果该行没有设置 Agent，显示警告
    return !line.agent;
  }, [lyricLines.agents, line.agent, line.isBG]);

  const hasRadical = useMemo(() => {
    for (const word of line.words) {
      if (containsRadicalChar(word.word)) {
        return true;
      }
      if (word.ruby) {
        for (const ruby of word.ruby) {
          if (containsRadicalChar(ruby.word)) {
            return true;
          }
        }
      }
    }
    return false;
  }, [line.words]);

  const showWordRomanizationInput = useAtomValue(showWordRomanizationInputAtom);
  const showTranslation = useAtomValue(showLineTranslationAtom);
  const showRomanization = useAtomValue(showLineRomanizationAtom);
  const showEndTimeAsDuration = useAtomValue(showEndTimeAsDurationAtom);
  const editingRomanWordIndexAtom = useMemo(() => atom<number | null>(null), []);
  const editingRomanWordIndex = useAtomValue(editingRomanWordIndexAtom);
  const enablePrediction = useAtomValue(enableAutoRomanizationPredictionAtom);

  const startTimeRef = useRef<HTMLDivElement>(null);
  const endTimeRef = useRef<HTMLButtonElement>(null);
  const [enableInsert, setEnableInsert] = useState(false);
  const [endTimeLinked, setEndTimeLinked] = useState(() => Boolean(line.endTimeLink));
  const originalEndTimeRef = useRef<number | null>(null);
  const originalNextStartTimeRef = useRef<number | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 用于呈现时间戳更新效果
  useEffect(() => {
    if (!visualizeTimestampUpdate) return;
    const animation = startTimeRef.current?.animate(
      [
        {
          backgroundColor: 'var(--green-a8)',
        },
        {
          backgroundColor: 'var(--green-a4)',
        },
      ],
      {
        duration: 500,
      }
    );

    return () => {
      animation?.cancel();
    };
  }, [line.startTime, visualizeTimestampUpdate]);

  useLayoutEffect(() => {
    if (toolMode !== ToolMode.Edit) {
      setEnableInsert(false);
    }
  }, [toolMode]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 用于呈现时间戳更新效果
  useEffect(() => {
    if (!visualizeTimestampUpdate) return;
    const animation = endTimeRef.current?.animate(
      [
        {
          backgroundColor: 'var(--red-a8)',
        },
        {
          backgroundColor: 'var(--red-a4)',
        },
      ],
      {
        duration: 500,
      }
    );

    return () => {
      animation?.cancel();
    };
  }, [line.endTime, visualizeTimestampUpdate]);

  useEffect(() => {
    if (!endTimeLinked) return;
    const nextLine = lyricLines.lyricLines[lineIndex + 1];
    if (!nextLine) {
      editLyricLines((state: Draft<TTMLLyric>) => {
        const targetLine = state.lyricLines[lineIndex];
        if (!targetLine) return;
        if (targetLine.endTimeLink) delete targetLine.endTimeLink;
      });
      return;
    }
    if (nextLine.startTime === line.endTime) return;
    editLyricLines((state: Draft<TTMLLyric>) => {
      const targetLine = state.lyricLines[lineIndex + 1];
      if (!targetLine) return;
      targetLine.startTime = line.endTime;
    });
  }, [endTimeLinked, editLyricLines, line.endTime, lineIndex, lyricLines]);

  useEffect(() => {
    const linked = Boolean(line.endTimeLink);
    if (linked === endTimeLinked) return;
    setEndTimeLinked(linked);
  }, [endTimeLinked, line.endTimeLink]);

  const suggestedRomans = useMemo(() => {
    if (!enablePrediction) {
      return [];
    }

    return predictLineRomanization(line.words, line.romanLyric || '');
  }, [line.romanLyric, line.words, enablePrediction]);

  const onToggleEndTimeLink = useCallback(
    (evt: React.MouseEvent<HTMLButtonElement>) => {
      evt.preventDefault();
      evt.stopPropagation();
      const nextLine = lyricLines.lyricLines[lineIndex + 1];
      if (endTimeLinked) {
        setEndTimeLinked(false);
        originalEndTimeRef.current = null;
        originalNextStartTimeRef.current = null;
        editLyricLines((state: Draft<TTMLLyric>) => {
          const targetLine = state.lyricLines[lineIndex];
          if (!targetLine) return;
          const linkInfo = targetLine.endTimeLink;
          if (!linkInfo) return;
          if (
            typeof linkInfo.originalEndTime !== 'number' ||
            !Number.isFinite(linkInfo.originalEndTime)
          ) {
            delete targetLine.endTimeLink;
            return;
          }
          targetLine.endTime = linkInfo.originalEndTime;
          const nextTarget = state.lyricLines[lineIndex + 1];
          if (nextTarget && Number.isFinite(linkInfo.originalNextStartTime ?? Number.NaN)) {
            nextTarget.startTime = linkInfo.originalNextStartTime ?? nextTarget.startTime;
          }
          delete targetLine.endTimeLink;
        });
        return;
      }
      // const nextLine = lyricLines.lyricLines[lineIndex + 1];
      if (!nextLine) return;
      originalEndTimeRef.current = line.endTime;
      originalNextStartTimeRef.current = nextLine?.startTime ?? null;
      editLyricLines((state: Draft<TTMLLyric>) => {
        const targetLine = state.lyricLines[lineIndex];
        if (!targetLine) return;
        const nextTarget = state.lyricLines[lineIndex + 1];
        if (!nextTarget) return;
        const originalEndTime = targetLine.endTimeLink?.originalEndTime ?? targetLine.endTime;
        const originalNextStartTime =
          targetLine.endTimeLink?.originalNextStartTime ?? nextTarget.startTime ?? null;
        const desiredEndTime = nextTarget.startTime ?? targetLine.endTime;
        targetLine.endTimeLink = {
          originalEndTime,
          originalNextStartTime,
        };
        targetLine.endTime = desiredEndTime;
        nextTarget.startTime = desiredEndTime;
      });
      setEndTimeLinked(true);
    },
    [editLyricLines, endTimeLinked, line.endTime, lineIndex, lyricLines]
  );

  return (
    <>
      <LyricLineScroller
        lineAtom={lineAtom}
        wordsContainer={wordsContainerRef.current}
        editingRomanWordIndex={editingRomanWordIndex}
      />
      {enableInsert && (
        <Button
          mx="2"
          my="1"
          variant="soft"
          size="1"
          style={{
            width: 'calc(100% - var(--space-4))',
          }}
          onClick={() => {
            editLyricLines((state: Draft<TTMLLyric>) => {
              state.lyricLines.splice(lineIndex, 0, newLyricLine());
            });
            // setInsertMode(InsertMode.None);
            setEnableInsert(false);
          }}
        >
          {t('lyricLineView.insertLine', '在此插入新行')}
        </Button>
      )}
      <ContextMenu.Root
        onOpenChange={(opened) => {
          if (opened) {
            if (!store.get(selectedLinesAtom).has(line.id)) {
              store.set(selectedLinesAtom, new Set([line.id]));
            }
          }
        }}
      >
        <ContextMenu.Trigger disabled={toolMode !== ToolMode.Edit}>
          <Flex
            mx="2"
            my="1"
            direction="row"
            className={classNames(
              styles.lyricLine,
              isPlaybackHighlighted && styles.playbackHighlighted,
              lineSelected && styles.selected,
              toolMode === ToolMode.Sync && styles.sync,
              toolMode === ToolMode.Edit && styles.edit,
              line.ignoreSync && styles.ignoreSync,
              hasError && toolMode === ToolMode.Edit && styles.error,
              hasAgentWarning && toolMode === ToolMode.Edit && styles.agentWarning,
              hasRadical && styles.radical
            )}
            align="center"
            gapX="4"
            data-line-id={line.id}
            data-absolute-index={lineIndex}
            data-is-dragged={isDragged}
            onPointerDown={(evt) => {
              const target = evt.target as HTMLElement | null;
              if (
                target?.closest(
                  "button, input, textarea, select, a, .rt-TextFieldRoot, [contenteditable='true']"
                )
              ) {
                return;
              }
              if (toolMode === ToolMode.Edit || toolMode === ToolMode.Sync) {
                onPointerDown(evt, line.id, lineIndex, toolMode === ToolMode.Edit);
              }
            }}
          >
            {isPlaybackHighlighted && (
              <motion.div
                layoutId="lyric-playback-active-line"
                className={styles.playbackActiveOverlay}
                transition={{
                  type: 'tween',
                  duration: 0.16,
                  ease: 'easeOut',
                }}
              />
            )}
            <Flex direction="column" align="center" justify="center" ml="3">
              <Text
                className={classNames(
                  styles.lineNumber,
                  isPlaybackHighlighted && styles.playbackActiveLineNumber,
                  line.ignoreSync && styles.ignored
                )}
                align="center"
                color="gray"
              >
                {displayNumber}
              </Text>
              {line.isBG && <VideoBackgroundEffectFilled color="#4466FF" />}
              {line.isDuet && <TextAlignRightFilled color="#44AA33" />}
            </Flex>
            <div
              className={classNames(
                styles.lyricLineContainer,
                toolMode === ToolMode.Edit && styles.edit,
                toolMode === ToolMode.Sync && styles.sync
              )}
            >
              <div
                className={classNames(
                  styles.lyricWordsContainer,
                  toolMode === ToolMode.Edit && styles.edit,
                  toolMode === ToolMode.Sync && styles.sync,
                  !showTimestamps && styles.hideTimestamps
                )}
                ref={wordsContainerRef}
              >
                {words.map((wordAtom, wi) => {
                  const word = store.get(wordAtom);
                  const ghostsHere = annotationWordMarks.addedGhosts.filter((g) => g.index === wi);
                  return (
                    <Fragment key={`word-${word.id}`}>
                      {ghostsHere.map((ghost) => (
                        <span
                          key={`annotation-add-${ghost.itemKey}-${ghost.index}`}
                          className={classNames(
                            styles.annotationGhostWord,
                            styles.annotationAdded,
                            ghost.focused && styles.annotationFocused
                          )}
                          title={ghost.text}
                        >
                          {ghost.text}
                        </span>
                      ))}
                      {enableInsert && (
                        <IconButton
                          size="1"
                          variant="soft"
                          onClick={(evt) => {
                            evt.preventDefault();
                            evt.stopPropagation();
                            editLyricLines((state: Draft<TTMLLyric>) => {
                              state.lyricLines[lineIndex].words.splice(wi, 0, newLyricWord());
                            });
                          }}
                        >
                          <AddFilled />
                        </IconButton>
                      )}
                      <Flex
                        direction="column"
                        align="stretch"
                        gap="3"
                        data-word-index={wi}
                        className={classNames(
                          styles.wordGroup,
                          annotationWordMarks.added.has(String(wi)) && styles.annotationAdded,
                          annotationWordMarks.removed.has(String(wi)) && styles.annotationRemoved,
                          annotationWordMarks.focused.has(String(wi)) && styles.annotationFocused
                        )}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <LyricWordView
                          wordAtom={wordAtom}
                          wordIndex={wi}
                          line={line}
                          lineIndex={lineIndex}
                        />
                        {toolMode === ToolMode.Edit && showWordRomanizationInput && (
                          <RomanWordView
                            wordAtom={wordAtom}
                            wordIndex={wi}
                            editingIndexAtom={editingRomanWordIndexAtom}
                            suggestedRoman={suggestedRomans[wi]}
                          />
                        )}
                      </Flex>
                    </Fragment>
                  );
                })}
                {annotationWordMarks.addedGhosts
                  .filter((g) => g.index >= words.length)
                  .map((ghost) => (
                    <span
                      key={`annotation-add-tail-${ghost.itemKey}-${ghost.index}`}
                      className={classNames(
                        styles.annotationGhostWord,
                        styles.annotationAdded,
                        ghost.focused && styles.annotationFocused
                      )}
                      title={ghost.text}
                    >
                      {ghost.text}
                    </span>
                  ))}
                {enableInsert && (
                  <IconButton
                    size="1"
                    variant="soft"
                    onClick={(evt) => {
                      evt.preventDefault();
                      evt.stopPropagation();
                      editLyricLines((state: Draft<TTMLLyric>) => {
                        state.lyricLines[lineIndex].words.push(newLyricWord());
                      });
                    }}
                  >
                    <AddFilled />
                  </IconButton>
                )}
                {toolMode === ToolMode.Edit && (
                  <TextField.Root
                    placeholder={t('lyricLineView.insertWord', '插入单词…')}
                    className={classNames(
                      styles.insertWordField,
                      words.length === 0 && styles.empty
                    )}
                    style={{
                      alignSelf: 'center',
                    }}
                    onKeyDown={(evt) => {
                      if (evt.key === 'Enter') {
                        evt.preventDefault();
                        evt.stopPropagation();
                        const { word, enableRuby } = parseRubyShortcut(evt.currentTarget.value);
                        editLyricLines((state: Draft<TTMLLyric>) => {
                          const newWord = newLyricWord();
                          state.lyricLines[lineIndex].words.push({
                            ...newWord,
                            word,
                            ruby: enableRuby
                              ? [
                                  {
                                    word: '',
                                    startTime: newWord.startTime,
                                    endTime: newWord.endTime,
                                  },
                                ]
                              : undefined,
                          });
                        });
                        evt.currentTarget.value = '';
                      }
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                )}
              </div>
              {toolMode === ToolMode.Edit && (
                <>
                  {showTranslation && (
                    <SubLineEdit lineAtom={lineAtom} lineIndex={lineIndex} type="translatedLyric" />
                  )}
                  {showRomanization && (
                    <SubLineEdit lineAtom={lineAtom} lineIndex={lineIndex} type="romanLyric" />
                  )}
                  {vocalTagIds.length > 0 && (
                    <Flex align="center" gap="2" className={styles.vocalTagsRow}>
                      <Text size="2">{t('lyricLineView.vocalTagsLabel', '演唱者：')}</Text>
                      <Flex gap="1" wrap="wrap" className={styles.vocalTagsButtons}>
                        {(() => {
                          const selectedIds = parseLineVocalIds(line.vocal);
                          const selectedSet = new Set(selectedIds);
                          const allSelected =
                            vocalTagIds.length > 0 &&
                            vocalTagIds.every((id) => selectedSet.has(id));
                          const orderedIds = [
                            ...selectedIds.filter((id) => vocalTagIds.includes(id)),
                            ...vocalTagIds.filter((id) => !selectedSet.has(id)),
                          ];
                          return [
                            ...orderedIds.map((id) => {
                              const isActive = selectedSet.has(id);
                              const tagName = vocalTagMap.get(id);
                              return (
                                <Button
                                  key={`line-${lineIndex}-vocal-${id}`}
                                  size="1"
                                  variant={isActive ? 'solid' : 'soft'}
                                  color={isActive ? 'green' : 'gray'}
                                  className={styles.vocalTagButton}
                                  title={tagName || undefined}
                                  onClick={(evt) => {
                                    evt.stopPropagation();
                                    editLyricLines((state: Draft<TTMLLyric>) => {
                                      const targetLine = state.lyricLines[lineIndex];
                                      const currentIds = parseLineVocalIds(targetLine.vocal);
                                      const existingIndex = currentIds.indexOf(id);
                                      if (existingIndex > -1) {
                                        currentIds.splice(existingIndex, 1);
                                      } else {
                                        currentIds.push(id);
                                      }
                                      targetLine.vocal = currentIds;
                                    });
                                  }}
                                >
                                  {tagName || id}
                                </Button>
                              );
                            }),
                            <Button
                              key={`line-${lineIndex}-vocal-all`}
                              size="1"
                              variant={allSelected ? 'solid' : 'soft'}
                              color={allSelected ? 'green' : 'gray'}
                              className={styles.vocalTagButton}
                              onClick={(evt) => {
                                evt.stopPropagation();
                                editLyricLines((state: Draft<TTMLLyric>) => {
                                  const targetLine = state.lyricLines[lineIndex];
                                  targetLine.vocal = allSelected ? [] : [...vocalTagIds];
                                });
                              }}
                            >
                              <Flex align="center" gap="1">
                                <People24Regular />
                                {t('lyricLineView.vocalTagsAll', '全体成员')}
                              </Flex>
                            </Button>,
                          ];
                        })()}
                      </Flex>
                    </Flex>
                  )}
                </>
              )}
            </div>
            {toolMode === ToolMode.Edit && (
              <Flex p="3">
                <IconButton
                  size="1"
                  variant={enableInsert ? 'solid' : 'soft'}
                  onClick={(evt) => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    setEnableInsert((v) => !v);
                  }}
                >
                  <AddFilled />
                </IconButton>
              </Flex>
            )}
            {toolMode === ToolMode.Sync && showTimestamps && (
              <Flex pr="3" gap="1" direction="column" align="stretch">
                <div className={styles.startTime} ref={startTimeRef}>
                  {msToTimestamp(line.startTime)}
                </div>
                <button
                  type="button"
                  className={classNames(styles.endTime, styles.endTimeButton)}
                  ref={endTimeRef}
                  onClick={onToggleEndTimeLink}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                    }}
                  >
                    {endTimeLinked ? (
                      <LinkMultiple20Regular />
                    ) : showEndTimeAsDuration ? (
                      `+${line.endTime - line.startTime}ms`
                    ) : (
                      msToTimestamp(line.endTime)
                    )}
                  </span>
                </button>
              </Flex>
            )}
          </Flex>
        </ContextMenu.Trigger>
        <ContextMenu.Content>
          <LyricLineMenu lineIndex={lineIndex} />
        </ContextMenu.Content>
      </ContextMenu.Root>
      {enableInsert && (
        <Button
          mx="2"
          my="1"
          variant="soft"
          size="1"
          style={{
            width: 'calc(100% - var(--space-4))',
          }}
          onClick={() => {
            editLyricLines((state: Draft<TTMLLyric>) => {
              state.lyricLines.splice(lineIndex + 1, 0, newLyricLine());
            });
            // setInsertMode(InsertMode.None);
            setEnableInsert(false);
          }}
        >
          {t('lyricLineView.insertLine', '在此插入新行')}
        </Button>
      )}
    </>
  );
});
