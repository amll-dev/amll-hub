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

import type { Draft } from 'immer';
import { atom, useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { useSetImmerAtom } from 'jotai-immer';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Radio, RadioGroup } from '@/components/ui/radio-group';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
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
  /** 时间字段固定按「结束时间」展示，不再提供「持续时间」切换 */
  const showDurationInput = useAtomValue(showEndTimeAsDurationAtom);
  const itemAtom = useMemo(
    () => (isWordField ? selectedWordsAtom : selectedLinesAtom),
    [isWordField]
  );

  const editLyricLines = useSetImmerAtom(lyricLinesAtom);
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
                  const word = line.words[wordIndex]!;
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
        setFieldPlaceholder('多个值...');
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
      setFieldPlaceholder('多个值...');
      return;
    }
    setFieldInput(currentValue);
    setFieldPlaceholder('');
  }, [currentValue, durationValue, fieldName, showDurationInput]);

  const invalid = durationInputInvalid || hasError;

  return (
    <>
      <span className="flex h-7 w-16 items-center whitespace-nowrap text-xs">{label}</span>
      <Input
        ref={inputRef}
        aria-invalid={invalid}
        className={cn('h-7 text-xs', invalid && 'border-error bg-error/10')}
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

  const isDisabled = isDisabledBase;
  const checkboxId = useId();

  return (
    <>
      <label htmlFor={checkboxId} className="whitespace-nowrap text-xs">
        {label}
      </label>
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
  const name = useId();
  return (
    <RadioGroup className="gap-3">
      <label className="flex items-center gap-2 whitespace-nowrap text-xs">
        <Radio
          name={name}
          value={LayoutMode.Simple}
          checked={layoutMode === LayoutMode.Simple}
          onChange={() => setLayoutMode(LayoutMode.Simple)}
        />
        {simpleModeLabel}
      </label>
      <label className="flex items-center gap-2 whitespace-nowrap text-xs">
        <Radio
          name={name}
          value={LayoutMode.Advance}
          checked={layoutMode === LayoutMode.Advance}
          onChange={() => setLayoutMode(LayoutMode.Advance)}
        />
        {advanceModeLabel}
      </label>
    </RadioGroup>
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
      <label className="whitespace-nowrap text-xs" id={songPartLabelId}>
        Song Part
      </label>
      <div className="flex items-center gap-1">
        <Select
          value={displayValue}
          onChange={(e) => {
            if (e.target.value === '__add_custom__') {
              setIsAddingCustom(true);
              return;
            }
            handleSongPartChange(e.target.value);
          }}
          disabled={selectedLines.size === 0}
          className="h-7 min-w-[6em] text-xs"
          aria-labelledby={songPartLabelId}
          title={
            selectedLines.size === 0
              ? 'No selection'
              : currentSongPart === undefined
                ? 'Multiple values...'
                : 'None'
          }
        >
          <option value={NONE_VALUE}>None</option>
          {SONG_PART_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          <option value="__add_custom__">＋ 自定义…</option>
        </Select>
        {isAddingCustom && (
          <>
            <Input
              className="h-7 w-[120px] px-2 text-xs"
              placeholder="Custom part"
              value={customPart}
              autoFocus
              onChange={(e) => setCustomPart(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleAddCustomPart();
                }
              }}
            />
            <Button
              variant="secondary"
              className="h-7 px-2"
              onClick={handleAddCustomPart}
              title="确认添加"
            >
              <Plus className="size-4" />
            </Button>
          </>
        )}
      </div>
    </>
  );
};

const AgentField: FC = () => {
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
      <label className="whitespace-nowrap text-xs" id={agentLabelId}>
        Agent
      </label>
      <Select
        value={displayValue}
        onChange={(e) => handleAgentChange(e.target.value)}
        disabled={isAgentSelectDisabled}
        className="h-7 min-w-[6em] text-xs"
        aria-labelledby={agentLabelId}
        title={
          !hasAgents
            ? 'No agents'
            : selectedLines.size === 0
              ? 'No selection'
              : hasSelectedBGLine
                ? 'BG line selected'
                : 'None'
        }
      >
        {agentOptions.map((option) =>
          option.type === 'separator' ? (
            <option key={option.value} disabled>
              ──────
            </option>
          ) : (
            <option
              key={option.value}
              value={option.value}
              title={option.names.join(', ') || option.value}
            >
              {option.label}
            </option>
          )
        )}
      </Select>
    </>
  );
};

const AuxiliaryDisplayField: FC = () => {
  const [showTranslation, setShowTranslation] = useAtom(showLineTranslationAtom);
  const [showRomanization, setShowRomanization] = useAtom(showLineRomanizationAtom);
  const [showWordRomanizationInput, setShowWordRomanizationInput] = useAtom(
    showWordRomanizationInputAtom
  );

  const idTranslation = useId();
  const idRomanization = useId();
  const idPerWord = useId();

  return (
    <div className="grid flex-1 grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1">
      <label htmlFor={idTranslation} className="whitespace-nowrap text-xs">
        显示翻译行
      </label>
      <Checkbox
        id={idTranslation}
        checked={showTranslation}
        onCheckedChange={(c) => setShowTranslation(Boolean(c))}
      />
      <label htmlFor={idRomanization} className="whitespace-nowrap text-xs">
        显示音译行
      </label>
      <Checkbox
        id={idRomanization}
        checked={showRomanization}
        onCheckedChange={(c) => setShowRomanization(Boolean(c))}
      />
      <label htmlFor={idPerWord} className="whitespace-nowrap text-xs">
        显示逐字音译
      </label>
      <Checkbox
        id={idPerWord}
        checked={showWordRomanizationInput}
        onCheckedChange={(c) => setShowWordRomanizationInput(Boolean(c))}
      />
    </div>
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

  return (
    <RibbonFrame ref={ref}>
      <RibbonSection label="新建">
        <div className="grid flex-1 grid-cols-1 items-center gap-1">
          <Button
            variant="secondary"
            className="h-7 px-2 text-xs"
            onClick={() =>
              editLyricLines((draft: Draft<TTMLLyric>) => {
                draft.lyricLines.push(newLyricLine());
              })
            }
          >
            歌词行
          </Button>
        </div>
      </RibbonSection>
      <RibbonSection label="行时间戳">
        <div className="grid flex-1 grid-cols-[4rem_1fr] items-center gap-x-2 gap-y-1">
          <EditField
            label="起始时间"
            fieldName="startTime"
            parser={parseTimespan}
            formatter={msToTimestamp}
          />
          <EditField
            label="结束时间"
            fieldName="endTime"
            parser={parseTimespan}
            formatter={msToTimestamp}
          />
        </div>
      </RibbonSection>
      <RibbonSection label="行属性">
        <div className="grid flex-1 grid-cols-[auto_auto] items-center gap-x-4 gap-y-1">
          <CheckboxField
            label="背景歌词"
            defaultValue={false}
            isWordField={false}
            fieldName="isBG"
          />
          <CheckboxField
            label="对唱歌词"
            isWordField={false}
            fieldName="isDuet"
            defaultValue={false}
          />
          <CheckboxField
            label="忽略打轴"
            isWordField={false}
            fieldName="ignoreSync"
            defaultValue={false}
          />
        </div>
      </RibbonSection>
      <RibbonSection label="词时间戳">
        <div className="grid flex-1 grid-cols-[4rem_1fr] items-center gap-x-2 gap-y-1">
          <EditField
            label="起始时间"
            fieldName="startTime"
            isWordField
            parser={parseTimespan}
            formatter={msToTimestamp}
          />
          <EditField
            label="结束时间"
            fieldName="endTime"
            isWordField
            parser={parseTimespan}
            formatter={msToTimestamp}
          />
          <EditField
            label="空拍数量"
            fieldName="emptyBeat"
            isWordField
            parser={(v) => {
              const parsed = Number.parseInt(v, 10);
              return Number.isNaN(parsed) ? 0 : parsed;
            }}
            formatter={String}
          />
        </div>
      </RibbonSection>
      <RibbonSection label="单词属性">
        <div className="grid flex-1 grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
          <EditField
            label="单词内容"
            fieldName="word"
            isWordField
            parser={(v) => v}
            formatter={(v) => v}
          />
          <EditField
            label="单词音译"
            fieldName="romanWord"
            isWordField
            parser={(v) => v}
            formatter={(v) => v || ''}
          />
          <CheckboxField label="不雅用语" isWordField fieldName="obscene" defaultValue={false} />
        </div>
      </RibbonSection>
      <RibbonSection label="次要内容">
        <div className="grid flex-1 grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
          <EditField
            label="翻译歌词"
            fieldName="translatedLyric"
            parser={(v) => v}
            formatter={(v) => v}
            textFieldStyle={{ width: '20em' }}
          />
          <EditField
            label="音译歌词"
            fieldName="romanLyric"
            parser={(v) => v}
            formatter={(v) => v}
            textFieldStyle={{ width: '20em' }}
          />
        </div>
      </RibbonSection>
      <RibbonSection label="多语言">
        <I18nEditor />
      </RibbonSection>
      <RibbonSection label="布局模式">
        <EditModeField simpleModeLabel="简单模式" advanceModeLabel="高级模式" />
      </RibbonSection>
      <RibbonSection label="辅助行显示">
        <AuxiliaryDisplayField />
      </RibbonSection>
      <RibbonSection label="AM 标记">
        <div className="grid flex-1 grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
          <SongPartField />
          <AgentField />
        </div>
      </RibbonSection>
      <RibbonSection label="视图">
        <div className="grid flex-1 grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
          <label htmlFor={idOutline} className="select-none whitespace-nowrap text-xs">
            大纲
          </label>
          <Checkbox
            id={idOutline}
            checked={isOutlineOpen}
            onCheckedChange={(checked) => {
              toggleTab({ tabId: 'outline', open: Boolean(checked) });
            }}
          />
          <label htmlFor={idBpm} className="select-none whitespace-nowrap text-xs">
            BPM
          </label>
          <Checkbox
            id={idBpm}
            checked={isBpmOpen}
            onCheckedChange={(checked) => {
              toggleTab({ tabId: 'bpm', open: Boolean(checked) });
            }}
          />
        </div>
      </RibbonSection>
    </RibbonFrame>
  );
});

export default EditModeRibbonBar;
