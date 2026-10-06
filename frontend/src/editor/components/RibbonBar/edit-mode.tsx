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

import { Add16Regular } from '@fluentui/react-icons';
import {
  Button,
  Checkbox,
  Flex,
  Grid,
  IconButton,
  RadioGroup,
  Select,
  Text,
  TextField,
  Tooltip,
} from '@radix-ui/themes';
import type { Draft } from 'immer';
import { atom, useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { useSetImmerAtom } from 'jotai-immer';
import {
  type FC,
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { I18nEditor } from '$/modules/lyric-editor/tools/i18nEditor.tsx';
import {
  LayoutMode,
  layoutModeAtom,
  showLineRomanizationAtom,
  showLineTranslationAtom,
  showWordRomanizationInputAtom,
} from '$/modules/settings/states';
import { recalculateDuetStates } from '$/modules/ttml-processor';
import {
  editingTimeFieldAtom,
  lyricLinesAtom,
  requestFocusAtom,
  selectedLinesAtom,
  selectedWordsAtom,
  showEndTimeAsDurationAtom,
} from '$/states/main.ts';
import { openSidebarTabsAtom, toggleTabAtom } from '$/states/sidebar.ts';
import {
  type LyricLine,
  type LyricWord,
  newLyricLine,
  type TTMLAgent,
  type TTMLLyric,
} from '$/types/ttml';
import { formatDurationMs, msToTimestamp, parseTimespan } from '@/lib/format';
import { RibbonFrame, RibbonSection } from './common';

const MULTIPLE_VALUES = Symbol('multiple-values');

function EditField<
  L extends (Word extends true ? LyricWord : LyricLine),
  F extends keyof L,
  Word extends boolean | undefined = undefined,
>({
  label,
  isWordField,
  fieldName,
  formatter,
  parser,
  textFieldStyle,
}: {
  label: string;
  isWordField?: Word;
  fieldName: F;
  formatter: (v: L[F]) => string;
  parser: (v: string) => L[F];
  textFieldStyle?: React.CSSProperties;
}) {
  const [fieldInput, setFieldInput] = useState<string | undefined>(undefined);
  const [fieldPlaceholder, setFieldPlaceholder] = useState<string>('');
  const [durationInputInvalid, setDurationInputInvalid] = useState(false);
  const [showDurationInput, setShowDurationInput] = useAtom(showEndTimeAsDurationAtom);
  const itemAtom = useMemo(
    () => (isWordField ? selectedWordsAtom : selectedLinesAtom),
    [isWordField]
  );

  const editLyricLines = useSetImmerAtom(lyricLinesAtom);
  const { t } = useTranslation();
  const setEditingTimeField = useSetAtom(editingTimeFieldAtom);

  const [requestFocus, setRequestFocus] = useAtom(requestFocusAtom);
  const inputRef = useRef<HTMLInputElement>(null);
  const durationInvalidTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (requestFocus === fieldName && !isWordField && inputRef.current) {
      inputRef.current.focus();
      setRequestFocus(null);
    }
  }, [requestFocus, fieldName, isWordField, setRequestFocus]);
  useEffect(
    () => () => {
      if (durationInvalidTimerRef.current !== null) {
        window.clearTimeout(durationInvalidTimerRef.current);
      }
    },
    []
  );

  const hasErrorAtom = useMemo(
    () =>
      atom((get) => {
        if (fieldName !== 'startTime' && fieldName !== 'endTime') {
          return false;
        }

        const selectedItems = get(itemAtom);
        if (selectedItems.size === 0) return false;

        const lyricLines = get(lyricLinesAtom);

        if (isWordField) {
          const selectedWords = selectedItems;
          for (const line of lyricLines.lyricLines) {
            for (const word of line.words) {
              if (selectedWords.has(word.id)) {
                if (word.startTime > word.endTime) {
                  return true;
                }
              }
            }
          }
        } else {
          const selectedLines = selectedItems;
          for (const line of lyricLines.lyricLines) {
            if (selectedLines.has(line.id)) {
              if (line.startTime > line.endTime) {
                return true;
              }
            }
          }
        }
        return false;
      }),
    [fieldName, isWordField, itemAtom]
  );
  const hasError = useAtomValue(hasErrorAtom);

  const currentValueAtom = useMemo(
    () =>
      atom((get) => {
        const selectedItems = get(itemAtom);
        const lyricLines = get(lyricLinesAtom);
        if (selectedItems.size === 0) return undefined;

        if (isWordField) {
          const selectedWords = selectedItems as Set<string>;
          const values = new Set();
          for (const line of lyricLines.lyricLines) {
            for (const word of line.words) {
              if (selectedWords.has(word.id)) {
                values.add(word[fieldName as keyof LyricWord]);
              }
            }
          }
          if (values.size === 1) return formatter(values.values().next().value as L[F]);
          return MULTIPLE_VALUES;
        }
        const selectedLines = selectedItems as Set<string>;
        const values = new Set();
        for (const line of lyricLines.lyricLines) {
          if (selectedLines.has(line.id)) {
            values.add(line[fieldName as keyof LyricLine]);
          }
        }
        if (values.size === 1) return formatter(values.values().next().value as L[F]);
        return MULTIPLE_VALUES;
      }),
    [fieldName, formatter, isWordField, itemAtom]
  );
  const currentValue = useAtomValue(currentValueAtom);
  const store = useStore();
  const durationValueAtom = useMemo(
    () =>
      atom((get) => {
        if (fieldName !== 'endTime') return undefined;
        const selectedItems = get(itemAtom);
        const lyricLines = get(lyricLinesAtom);
        if (selectedItems.size === 0) return undefined;
        const durations = new Set<number>();
        if (isWordField) {
          const selectedWords = selectedItems as Set<string>;
          for (const line of lyricLines.lyricLines) {
            for (const word of line.words) {
              if (selectedWords.has(word.id)) {
                durations.add(word.endTime - word.startTime);
              }
            }
          }
        } else {
          const selectedLines = selectedItems as Set<string>;
          for (const line of lyricLines.lyricLines) {
            if (selectedLines.has(line.id)) {
              durations.add(line.endTime - line.startTime);
            }
          }
        }
        if (durations.size === 1) return durations.values().next().value;
        return MULTIPLE_VALUES;
      }),
    [fieldName, isWordField, itemAtom]
  );
  const durationValue = useAtomValue(durationValueAtom);
  const compareValue = useMemo(() => {
    if (fieldName === 'endTime' && showDurationInput) {
      if (durationValue === MULTIPLE_VALUES) return '';
      if (typeof durationValue === 'number') return formatDurationMs(durationValue);
      return '';
    }
    if (typeof currentValue === 'string') return currentValue;
    return '';
  }, [currentValue, durationValue, fieldName, showDurationInput]);
  const flashInvalidDurationInput = useCallback(() => {
    setFieldInput('');
    setDurationInputInvalid(true);
    if (durationInvalidTimerRef.current !== null) {
      window.clearTimeout(durationInvalidTimerRef.current);
    }
    durationInvalidTimerRef.current = window.setTimeout(() => {
      setDurationInputInvalid(false);
    }, 300);
    inputRef.current?.animate(
      [
        { backgroundColor: 'var(--red-a5)' },
        { backgroundColor: 'var(--red-a3)' },
        { backgroundColor: 'transparent' },
      ],
      { duration: 300 }
    );
  }, []);

  const onInputFinished = useCallback(
    (rawValue: string) => {
      try {
        const selectedItems = store.get(itemAtom);
        const trimmedValue = rawValue.trim();
        const isTimeDelta =
          (fieldName === 'startTime' || fieldName === 'endTime') &&
          (trimmedValue.startsWith('+') || trimmedValue.startsWith('-'));
        if ((fieldName === 'endTime' && showDurationInput) || isTimeDelta) {
          const isDurationInput = fieldName === 'endTime' && showDurationInput && !isTimeDelta;
          const parsedValue = Number(trimmedValue);
          if (!Number.isFinite(parsedValue)) {
            flashInvalidDurationInput();
            return;
          }
          if (isDurationInput && parsedValue <= 0) {
            flashInvalidDurationInput();
            return;
          }
          editLyricLines((state: Draft<TTMLLyric>) => {
            for (const line of state.lyricLines) {
              if (isWordField) {
                const updates = new Map<string, { startTime?: number; endTime?: number }>();

                const mergeWordUpdate = (
                  wordId: string,
                  update: { startTime?: number; endTime?: number }
                ) => {
                  const current = updates.get(wordId) ?? {};
                  updates.set(wordId, { ...current, ...update });
                };

                for (let wordIndex = 0; wordIndex < line.words.length; wordIndex++) {
                  const word = line.words[wordIndex];
                  if (!selectedItems.has(word.id)) continue;
                  if (isTimeDelta && fieldName === 'startTime') {
                    const previousWord = line.words[wordIndex - 1];
                    const previousEndTime = previousWord?.endTime;
                    const originalStartTime = word.startTime;
                    const newStartTimeRaw = word.startTime + parsedValue;
                    const newStartTime = Math.min(word.endTime, Math.max(0, newStartTimeRaw));
                    mergeWordUpdate(word.id, { startTime: newStartTime });
                    if (previousWord && originalStartTime === previousEndTime) {
                      mergeWordUpdate(previousWord.id, {
                        endTime: newStartTime,
                        startTime: Math.min(previousWord.startTime, newStartTime),
                      });
                    }
                    continue;
                  }
                  const nextWord = line.words[wordIndex + 1];
                  const nextStartTime = nextWord?.startTime;
                  const originalEndTime = word.endTime;
                  const newEndTimeRaw = isTimeDelta
                    ? word.endTime + parsedValue
                    : word.startTime + parsedValue;
                  const newEndTime = Math.max(word.startTime, newEndTimeRaw);
                  mergeWordUpdate(word.id, { endTime: newEndTime });
                  if (isTimeDelta && nextWord && originalEndTime === nextStartTime) {
                    const nextUpdate: {
                      startTime: number;
                      endTime?: number;
                    } = {
                      startTime: newEndTime,
                    };
                    if (!selectedItems.has(nextWord.id)) {
                      nextUpdate.endTime = Math.max(nextWord.endTime, newEndTime);
                    }
                    mergeWordUpdate(nextWord.id, nextUpdate);
                  }
                }
                for (const word of line.words) {
                  const update = updates.get(word.id);
                  if (!update) continue;
                  if (update.startTime !== undefined) {
                    word.startTime = update.startTime;
                  }
                  if (update.endTime !== undefined) {
                    word.endTime = update.endTime;
                  }
                  if (word.endTime < word.startTime) {
                    word.endTime = word.startTime;
                  }
                }
              } else if (selectedItems.has(line.id)) {
                if (isTimeDelta && fieldName === 'startTime') {
                  const newStartTimeRaw = line.startTime + parsedValue;
                  line.startTime = Math.min(line.endTime, Math.max(0, newStartTimeRaw));
                } else {
                  const newEndTimeRaw = isTimeDelta
                    ? line.endTime + parsedValue
                    : line.startTime + parsedValue;
                  line.endTime = Math.max(line.startTime, newEndTimeRaw);
                }
              }
            }
            return state;
          });
          return;
        }
        const value = parser(rawValue);
        editLyricLines((state: Draft<TTMLLyric>) => {
          for (const line of state.lyricLines) {
            if (isWordField) {
              for (const word of line.words) {
                if (selectedItems.has(word.id)) {
                  (word as L)[fieldName] = value;
                }
              }
            } else {
              if (selectedItems.has(line.id)) {
                (line as L)[fieldName] = value;
              }
            }
          }
          return state;
        });
      } catch {
        if (compareValue) setFieldInput(compareValue);
      }
    },
    [
      itemAtom,
      store,
      editLyricLines,
      compareValue,
      fieldName,
      isWordField,
      parser,
      showDurationInput,
      flashInvalidDurationInput,
    ]
  );

  useLayoutEffect(() => {
    if (fieldName === 'endTime' && showDurationInput) {
      if (durationValue === MULTIPLE_VALUES) {
        setFieldInput('');
        setFieldPlaceholder(t('ribbonBar.editMode.multipleValues', '多个值...'));
        return;
      }
      if (typeof durationValue === 'number') {
        setFieldInput(formatDurationMs(durationValue));
        setFieldPlaceholder('');
        return;
      }
      setFieldInput(undefined);
      setFieldPlaceholder('');
      return;
    }
    if (currentValue === MULTIPLE_VALUES) {
      setFieldInput('');
      setFieldPlaceholder(t('ribbonBar.editMode.multipleValues', '多个值...'));
      return;
    }
    setFieldInput(currentValue);
    setFieldPlaceholder('');
  }, [currentValue, durationValue, fieldName, showDurationInput, t]);

  return (
    <>
      {fieldName === 'endTime' ? (
        <Button
          size="1"
          variant="ghost"
          onClick={() => setShowDurationInput((v) => !v)}
          style={{ justifyContent: 'flex-start' }}
        >
          {showDurationInput ? t('ribbonBar.editMode.duration', '持续时间') : label}
        </Button>
      ) : (
        <Text wrap="nowrap" size="1">
          {label}
        </Text>
      )}
      <TextField.Root
        ref={inputRef}
        size="1"
        color={durationInputInvalid || hasError ? 'red' : undefined}
        variant={durationInputInvalid || hasError ? 'soft' : undefined}
        style={{ width: '8em', ...textFieldStyle }}
        value={fieldInput ?? ''}
        placeholder={fieldPlaceholder}
        disabled={fieldInput === undefined}
        onChange={(evt) => setFieldInput(evt.currentTarget.value)}
        onKeyDown={(evt) => {
          if (evt.key !== 'Enter') return;
          onInputFinished(evt.currentTarget.value);
        }}
        onFocus={() => {
          if (!isWordField && (fieldName === 'startTime' || fieldName === 'endTime')) {
            setEditingTimeField({
              isWord: false,
              field: fieldName as 'startTime' | 'endTime',
            });
          }
        }}
        onBlur={(evt) => {
          setEditingTimeField(null);

          if (evt.currentTarget.value === compareValue) return;
          onInputFinished(evt.currentTarget.value);
        }}
      />
    </>
  );
}

function CheckboxField<
  L extends (Word extends true ? LyricWord : LyricLine),
  F extends keyof L,
  V extends (L[F] extends boolean ? boolean : never),
  Word extends boolean | undefined = undefined,
>({
  label,
  isWordField,
  fieldName,
  defaultValue,
}: {
  label: string;
  isWordField: Word;
  fieldName: F;
  defaultValue: V;
}) {
  const itemAtom = useMemo(
    () => (isWordField ? selectedWordsAtom : selectedLinesAtom),
    [isWordField]
  );

  const editLyricLines = useSetImmerAtom(lyricLinesAtom);
  const store = useStore();

  const currentValueAtom = useMemo(
    () =>
      atom((get) => {
        const selectedItems = get(itemAtom);
        const lyricLines = get(lyricLinesAtom);
        if (selectedItems.size) {
          if (isWordField) {
            const selectedWords = selectedItems as Set<string>;
            const values = new Set();
            for (const line of lyricLines.lyricLines) {
              for (const word of line.words) {
                if (selectedWords.has(word.id)) {
                  values.add(word[fieldName as keyof LyricWord]);
                }
              }
            }
            if (values.size === 1) return values.values().next().value as L[F];
            return MULTIPLE_VALUES;
          }
          const selectedLines = selectedItems as Set<string>;
          const values = new Set();
          for (const line of lyricLines.lyricLines) {
            if (selectedLines.has(line.id)) {
              values.add(line[fieldName as keyof LyricLine]);
            }
          }
          if (values.size === 1) return values.values().next().value as L[F];
          return MULTIPLE_VALUES;
        }
        return undefined;
      }),
    [itemAtom, fieldName, isWordField]
  );
  const currentValue = useAtomValue(currentValueAtom);
  const isDisabledAtom = useMemo(() => atom((get) => get(itemAtom).size === 0), [itemAtom]);
  const isDisabledBase = useAtomValue(isDisabledAtom);

  // 对于 isDuet 字段，检查选中的行是否设置了 agent
  const hasAgentAtom = useMemo(
    () =>
      atom((get) => {
        if (fieldName !== 'isDuet' || isWordField) return false;
        const selectedItems = get(itemAtom);
        const lyricLines = get(lyricLinesAtom);
        if (selectedItems.size === 0) return false;
        const selectedLines = selectedItems as Set<string>;
        for (const line of lyricLines.lyricLines) {
          if (selectedLines.has(line.id)) {
            // 如果任何一个选中的行设置了 agent，则禁用 checkbox
            if (line.agent) {
              return true;
            }
          }
        }
        return false;
      }),
    [fieldName, isWordField, itemAtom]
  );
  const hasAgent = useAtomValue(hasAgentAtom);

  const isDisabled = isDisabledBase || hasAgent;
  const checkboxId = useId();

  return (
    <>
      <Text wrap="nowrap" size="1">
        <label htmlFor={checkboxId}>{label}</label>
      </Text>
      <Checkbox
        disabled={isDisabled}
        id={checkboxId}
        checked={
          currentValue
            ? currentValue === MULTIPLE_VALUES
              ? 'indeterminate'
              : (currentValue as boolean)
            : defaultValue
        }
        onCheckedChange={(value) => {
          if (value === 'indeterminate') return;
          editLyricLines((state: Draft<TTMLLyric>) => {
            const selectedItems = store.get(itemAtom);
            for (const line of state.lyricLines) {
              if (isWordField) {
                for (const word of line.words) {
                  if (selectedItems.has(word.id)) {
                    (word as L)[fieldName] = value as L[F];
                  }
                }
              } else {
                if (selectedItems.has(line.id)) {
                  (line as L)[fieldName] = value as L[F];
                }
              }
            }
            return state;
          });
        }}
      />
    </>
  );
}

function EditModeField({ simpleModeLabel = '简单模式', advanceModeLabel = '高级模式' }) {
  const [layoutMode, setLayoutMode] = useAtom(layoutModeAtom);
  return (
    <RadioGroup.Root
      value={layoutMode}
      onValueChange={(v) => setLayoutMode(v as LayoutMode)}
      size="1"
    >
      <Flex gapY="3" direction="column">
        <Text wrap="nowrap" size="1">
          <RadioGroup.Item value={LayoutMode.Simple}>{simpleModeLabel}</RadioGroup.Item>
        </Text>
        <Text wrap="nowrap" size="1">
          <RadioGroup.Item value={LayoutMode.Advance}>{advanceModeLabel}</RadioGroup.Item>
        </Text>
      </Flex>
    </RadioGroup.Root>
  );
}

const SONG_PART_OPTIONS = [
  { value: 'Verse', label: 'Verse' },
  { value: 'Chorus', label: 'Chorus' },
  { value: 'PreChorus', label: 'PreChorus' },
  { value: 'Bridge', label: 'Bridge' },
  { value: 'Intro', label: 'Intro' },
  { value: 'Outro', label: 'Outro' },
  { value: 'Refrain', label: 'Refrain' },
  { value: 'Instrumental', label: 'Instrumental' },
  { value: 'Hook', label: 'Hook' },
  { value: 'Reprise', label: 'Reprise' },
  { value: 'Transition', label: 'Transition' },
  { value: 'FalseChorus', label: 'FalseChorus' },
];

const NONE_VALUE = '__none__';

const SongPartField: FC = () => {
  const { t } = useTranslation();
  const selectedLines = useAtomValue(selectedLinesAtom);
  const lyricLines = useAtomValue(lyricLinesAtom);
  const editLyricLines = useSetImmerAtom(lyricLinesAtom);
  const [customPart, setCustomPart] = useState('');
  const [isAddingCustom, setIsAddingCustom] = useState(false);

  // 获取当前选中行的 songPart 值
  const currentSongPart = useMemo(() => {
    if (selectedLines.size === 0) return undefined;
    const values = new Set<string | undefined>();
    for (const line of lyricLines.lyricLines) {
      if (selectedLines.has(line.id)) {
        values.add(line.songPart);
      }
    }
    if (values.size === 1) {
      const value = values.values().next().value;
      return value ?? NONE_VALUE;
    }
    return undefined; // 多个值
  }, [selectedLines, lyricLines]);

  const handleSongPartChange = useCallback(
    (value: string) => {
      editLyricLines((state: Draft<TTMLLyric>) => {
        for (const line of state.lyricLines) {
          if (selectedLines.has(line.id)) {
            line.songPart = value === NONE_VALUE ? undefined : value;
          }
        }
        return state;
      });
    },
    [editLyricLines, selectedLines]
  );

  const handleAddCustomPart = useCallback(() => {
    if (customPart.trim()) {
      handleSongPartChange(customPart.trim());
      setCustomPart('');
      setIsAddingCustom(false);
    }
  }, [customPart, handleSongPartChange]);

  const displayValue = currentSongPart === undefined ? NONE_VALUE : currentSongPart;
  const songPartLabelId = useId();

  return (
    <>
      <Text size="1" id={songPartLabelId}>
        {t('ribbonBar.editMode.songPart', 'Song Part')}
      </Text>
      <Select.Root value={displayValue} onValueChange={handleSongPartChange} size="1">
        <Select.Trigger
          placeholder={
            selectedLines.size === 0
              ? t('ribbonBar.editMode.noSelection', 'No selection')
              : currentSongPart === undefined
                ? t('ribbonBar.editMode.multipleValues', 'Multiple values...')
                : t('ribbonBar.editMode.none', 'None')
          }
          disabled={selectedLines.size === 0}
          style={{ minWidth: '6em' }}
          aria-labelledby={songPartLabelId}
        />
        <Select.Content>
          <Select.Item value={NONE_VALUE}>{t('ribbonBar.editMode.none', 'None')}</Select.Item>
          {SONG_PART_OPTIONS.map((option) => (
            <Select.Item key={option.value} value={option.value}>
              {option.label}
            </Select.Item>
          ))}
          <Select.Separator />
          {isAddingCustom ? (
            <Flex gap="2" p="2" align="center">
              <TextField.Root
                size="1"
                placeholder={t('ribbonBar.editMode.customPartPlaceholder', 'Custom part')}
                value={customPart}
                onChange={(e) => setCustomPart(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleAddCustomPart();
                  }
                }}
                style={{ width: '120px' }}
              />
              <IconButton size="1" variant="soft" onClick={handleAddCustomPart}>
                <Add16Regular />
              </IconButton>
            </Flex>
          ) : (
            <Select.Item
              value="__add_custom__"
              onClick={(e) => {
                e.preventDefault();
                setIsAddingCustom(true);
              }}
            >
              <Flex gap="2" align="center">
                <Add16Regular />
                {t('ribbonBar.editMode.addCustomPart', 'Add custom')}
              </Flex>
            </Select.Item>
          )}
        </Select.Content>
      </Select.Root>
    </>
  );
};

const AgentField: FC = () => {
  const { t } = useTranslation();
  const selectedLines = useAtomValue(selectedLinesAtom);
  const lyricLines = useAtomValue(lyricLinesAtom);
  const editLyricLines = useSetImmerAtom(lyricLinesAtom);
  const agentLabelId = useId();

  // 按类型分类 agent，保持原有顺序
  const groupedAgents = useMemo(() => {
    const person: TTMLAgent[] = [];
    const group: TTMLAgent[] = [];
    const other: TTMLAgent[] = [];

    // 兼容旧数据：如果 agents 不存在，使用空数组
    const agents = lyricLines.agents ?? [];

    for (const agent of agents) {
      if (agent.type === 'person') person.push(agent);
      else if (agent.type === 'group') group.push(agent);
      else other.push(agent);
    }

    return { person, group, other };
  }, [lyricLines.agents]);

  // 检查选中的行是否包含背景行
  const hasSelectedBGLine = useMemo(() => {
    for (const line of lyricLines.lyricLines) {
      if (selectedLines.has(line.id) && line.isBG) {
        return true;
      }
    }
    return false;
  }, [selectedLines, lyricLines]);

  // 获取当前选中行的 agent 值（只检查非背景行）
  const currentAgent = useMemo(() => {
    if (selectedLines.size === 0) return undefined;
    const values = new Set<string | undefined>();
    for (const line of lyricLines.lyricLines) {
      if (selectedLines.has(line.id) && !line.isBG) {
        // 从行的 agent 字段获取值（背景行不参与）
        values.add(line.agent);
      }
    }
    if (values.size === 1) {
      const value = values.values().next().value;
      return value ?? NONE_VALUE;
    }
    return undefined;
  }, [selectedLines, lyricLines]);

  const handleAgentChange = useCallback(
    (value: string) => {
      editLyricLines((state: Draft<TTMLLyric>) => {
        // 首先更新选中行的 agent（跳过背景行）
        for (const line of state.lyricLines) {
          if (selectedLines.has(line.id) && !line.isBG) {
            line.agent = value === NONE_VALUE ? undefined : value;
          }
        }
        recalculateDuetStates(state);

        return state;
      });
    },
    [editLyricLines, selectedLines]
  );

  const displayValue = currentAgent === undefined ? NONE_VALUE : currentAgent;

  // 构建下拉选项（只显示 id，names 用于 Tooltip）
  const agentOptions = useMemo(() => {
    const options: {
      value: string;
      label: string;
      type: string;
      names: string[];
    }[] = [];

    // Person 类型
    for (const agent of groupedAgents.person) {
      options.push({
        value: agent.id,
        label: agent.id,
        type: 'person',
        names: agent.names,
      });
    }

    // Group 类型（添加分隔线标记）
    if (groupedAgents.group.length > 0) {
      if (options.length > 0) {
        options.push({
          value: '__sep_group__',
          label: '',
          type: 'separator',
          names: [],
        });
      }
      for (const agent of groupedAgents.group) {
        options.push({
          value: agent.id,
          label: agent.id,
          type: 'group',
          names: agent.names,
        });
      }
    }

    // Other 类型（添加分隔线标记）
    if (groupedAgents.other.length > 0) {
      if (options.length > 0) {
        options.push({
          value: '__sep_other__',
          label: '',
          type: 'separator',
          names: [],
        });
      }
      for (const agent of groupedAgents.other) {
        options.push({
          value: agent.id,
          label: agent.id,
          type: 'other',
          names: agent.names,
        });
      }
    }

    return options;
  }, [groupedAgents]);

  // 如果没有 agent，显示禁用状态的下拉框
  const agentsList = lyricLines.agents ?? [];
  const hasAgents = agentsList.length > 0;

  const isAgentSelectDisabled = selectedLines.size === 0 || !hasAgents || hasSelectedBGLine;

  return (
    <>
      <Text size="1" id={agentLabelId}>
        {t('ribbonBar.editMode.agent', 'Agent')}
      </Text>
      <Select.Root
        value={displayValue}
        onValueChange={handleAgentChange}
        size="1"
        disabled={isAgentSelectDisabled}
      >
        <Select.Trigger
          placeholder={
            !hasAgents
              ? t('ribbonBar.editMode.noAgents', 'No agents')
              : selectedLines.size === 0
                ? t('ribbonBar.editMode.noSelection', 'No selection')
                : hasSelectedBGLine
                  ? t('ribbonBar.editMode.bgLineDisabled', 'BG line selected')
                  : t('ribbonBar.editMode.none', 'None')
          }
          aria-labelledby={agentLabelId}
        />
        <Select.Content>
          {agentOptions.map((option) =>
            option.type === 'separator' ? (
              <Select.Separator key={option.value} />
            ) : (
              <Tooltip
                key={option.value}
                content={option.names.join(', ') || option.value}
                side="left"
                align="center"
              >
                <Select.Item value={option.value}>{option.label}</Select.Item>
              </Tooltip>
            )
          )}
        </Select.Content>
      </Select.Root>
    </>
  );
};

const AuxiliaryDisplayField: FC = () => {
  const [showTranslation, setShowTranslation] = useAtom(showLineTranslationAtom);
  const [showRomanization, setShowRomanization] = useAtom(showLineRomanizationAtom);
  const [showWordRomanizationInput, setShowWordRomanizationInput] = useAtom(
    showWordRomanizationInputAtom
  );
  const { t } = useTranslation();

  const idTranslation = useId();
  const idRomanization = useId();
  const idPerWord = useId();

  return (
    <Grid columns="1fr auto" gapX="4" gapY="1" flexGrow="1" align="center">
      <Text size="1" asChild>
        <label htmlFor={idTranslation}>
          {t('ribbonBar.editMode.showTranslation', '显示翻译行')}
        </label>
      </Text>
      <Checkbox
        id={idTranslation}
        checked={showTranslation}
        onCheckedChange={(c) => setShowTranslation(Boolean(c))}
      />
      <Text size="1" asChild>
        <label htmlFor={idRomanization}>
          {t('ribbonBar.editMode.showRomanization', '显示音译行')}
        </label>
      </Text>
      <Checkbox
        id={idRomanization}
        checked={showRomanization}
        onCheckedChange={(c) => setShowRomanization(Boolean(c))}
      />
      <Text size="1" asChild>
        <label htmlFor={idPerWord}>
          {t('ribbonBar.editMode.showWordRomanizationInput', '显示逐字音译')}
        </label>
      </Text>
      <Checkbox
        id={idPerWord}
        checked={showWordRomanizationInput}
        onCheckedChange={(c) => setShowWordRomanizationInput(Boolean(c))}
      />
    </Grid>
  );
};

export const EditModeRibbonBar: FC = forwardRef<HTMLDivElement>((_props, ref) => {
  const openTabs = useAtomValue(openSidebarTabsAtom);
  const toggleTab = useSetAtom(toggleTabAtom);
  const isOutlineOpen = openTabs.includes('outline');
  const isBpmOpen = openTabs.includes('bpm');
  const idOutline = useId();
  const idBpm = useId();

  const editLyricLines = useSetImmerAtom(lyricLinesAtom);
  const { t } = useTranslation();

  return (
    <RibbonFrame ref={ref}>
      <RibbonSection label={t('ribbonBar.editMode.new', '新建')}>
        <Grid columns="1" gap="1" gapY="1" flexGrow="1" align="center">
          <Button
            size="1"
            variant="soft"
            onClick={() =>
              editLyricLines((draft: Draft<TTMLLyric>) => {
                draft.lyricLines.push(newLyricLine());
              })
            }
          >
            {t('ribbonBar.editMode.lyricLine', '歌词行')}
          </Button>
        </Grid>
      </RibbonSection>
      <RibbonSection label={t('ribbonBar.editMode.lineTiming', '行时间戳')}>
        <Grid columns="0fr 1fr" gap="2" gapY="1" flexGrow="1" align="center">
          <EditField
            label={t('ribbonBar.editMode.startTime', '起始时间')}
            fieldName="startTime"
            parser={parseTimespan}
            formatter={msToTimestamp}
          />
          <EditField
            label={t('ribbonBar.editMode.endTime', '结束时间')}
            fieldName="endTime"
            parser={parseTimespan}
            formatter={msToTimestamp}
          />
        </Grid>
      </RibbonSection>
      <RibbonSection label={t('ribbonBar.editMode.lineProperties', '行属性')}>
        <Grid columns="0fr 0fr" gap="4" gapY="1" flexGrow="1" align="center">
          <CheckboxField
            label={t('ribbonBar.editMode.bgLyric', '背景歌词')}
            defaultValue={false}
            isWordField={false}
            fieldName="isBG"
          />
          <CheckboxField
            label={t('ribbonBar.editMode.duetLyric', '对唱歌词')}
            isWordField={false}
            fieldName="isDuet"
            defaultValue={false}
          />
          <CheckboxField
            label={t('ribbonBar.editMode.ignoreSync', '忽略打轴')}
            isWordField={false}
            fieldName="ignoreSync"
            defaultValue={false}
          />
        </Grid>
      </RibbonSection>
      <RibbonSection label={t('ribbonBar.editMode.wordTiming', '词时间戳')}>
        <Grid columns="0fr 1fr" gap="2" gapY="1" flexGrow="1" align="center">
          <EditField
            label={t('ribbonBar.editMode.startTime', '起始时间')}
            fieldName="startTime"
            isWordField
            parser={parseTimespan}
            formatter={msToTimestamp}
          />
          <EditField
            label={t('ribbonBar.editMode.endTime', '结束时间')}
            fieldName="endTime"
            isWordField
            parser={parseTimespan}
            formatter={msToTimestamp}
          />
          <EditField
            label={t('ribbonBar.editMode.emptyBeatCount', '空拍数量')}
            fieldName="emptyBeat"
            isWordField
            parser={(v) => {
              const parsed = Number.parseInt(v, 10);
              return Number.isNaN(parsed) ? 0 : parsed;
            }}
            formatter={String}
          />
        </Grid>
      </RibbonSection>
      <RibbonSection label={t('ribbonBar.editMode.wordProperties', '单词属性')}>
        <Grid columns="0fr 1fr" gap="2" gapY="1" flexGrow="1" align="center">
          <EditField
            label={t('ribbonBar.editMode.wordContent', '单词内容')}
            fieldName="word"
            isWordField
            parser={(v) => v}
            formatter={(v) => v}
          />
          <EditField
            label={t('ribbonBar.editMode.romanWord', '单词音译')}
            fieldName="romanWord"
            isWordField
            parser={(v) => v}
            formatter={(v) => v || ''}
          />
          <CheckboxField
            label={t('ribbonBar.editMode.obscene', '不雅用语')}
            isWordField
            fieldName="obscene"
            defaultValue={false}
          />
        </Grid>
      </RibbonSection>
      <RibbonSection label={t('ribbonBar.editMode.secondaryContent', '次要内容')}>
        <Grid columns="0fr 1fr" gap="2" gapY="1" flexGrow="1" align="center">
          <EditField
            label={t('ribbonBar.editMode.translatedLyric', '翻译歌词')}
            fieldName="translatedLyric"
            parser={(v) => v}
            formatter={(v) => v}
            textFieldStyle={{ width: '20em' }}
          />
          <EditField
            label={t('ribbonBar.editMode.romanLyric', '音译歌词')}
            fieldName="romanLyric"
            parser={(v) => v}
            formatter={(v) => v}
            textFieldStyle={{ width: '20em' }}
          />
        </Grid>
      </RibbonSection>
      <RibbonSection label={t('ribbonBar.editMode.multilingual', '多语言')}>
        <I18nEditor />
      </RibbonSection>
      <RibbonSection label={t('ribbonBar.editMode.layoutMode', '布局模式')}>
        <EditModeField
          simpleModeLabel={t('settings.common.layoutModeOptions.simple', '简单模式')}
          advanceModeLabel={t('settings.common.layoutModeOptions.advance', '高级模式')}
        />
      </RibbonSection>
      <RibbonSection label={t('ribbonBar.editMode.auxiliaryLineDisplay', '辅助行显示')}>
        <AuxiliaryDisplayField />
      </RibbonSection>
      <RibbonSection label={t('ribbonBar.editMode.amllTags', 'AM 标记')}>
        <Grid columns="auto 1fr" gap="2" gapY="1" flexGrow="1" align="center">
          <SongPartField />
          <AgentField />
        </Grid>
      </RibbonSection>
      <RibbonSection label={t('ribbonBar.editMode.views', '视图')}>
        <Grid columns="1fr auto" gapX="3" gapY="1" flexGrow="1" align="center">
          <Text size="1" asChild>
            <label
              htmlFor={idOutline}
              style={{
                userSelect: 'none',
              }}
            >
              {t('ribbonBar.editMode.showOutline', '大纲')}
            </label>
          </Text>
          <Checkbox
            id={idOutline}
            checked={isOutlineOpen}
            onCheckedChange={(checked) => {
              toggleTab({ tabId: 'outline', open: Boolean(checked) });
            }}
          />
          <Text size="1" asChild>
            <label
              htmlFor={idBpm}
              style={{
                userSelect: 'none',
              }}
            >
              {t('ribbonBar.editMode.showBpmPanel', 'BPM')}
            </label>
          </Text>
          <Checkbox
            id={idBpm}
            checked={isBpmOpen}
            onCheckedChange={(checked) => {
              toggleTab({ tabId: 'bpm', open: Boolean(checked) });
            }}
          />
        </Grid>
      </RibbonSection>
    </RibbonFrame>
  );
});

export default EditModeRibbonBar;
