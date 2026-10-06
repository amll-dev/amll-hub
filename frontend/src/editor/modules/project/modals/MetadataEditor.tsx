import {
  Add16Regular,
  AlbumRegular,
  Delete16Regular,
  GlobeSearch20Regular,
  Info16Regular,
  MusicNote1Regular,
  NumberSymbol16Regular,
  Open16Regular,
  Person16Regular,
  Sparkle20Regular,
} from '@fluentui/react-icons';
import {
  Button,
  Dialog,
  Flex,
  Heading,
  IconButton,
  Spinner,
  Text,
  TextField,
} from '@radix-ui/themes';
import { AnimatePresence, motion } from 'framer-motion';
import { useAtom, useAtomValue } from 'jotai';
import { useImmerAtom } from 'jotai-immer';
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getMeatdataSuggestion,
  type MetaSuggestionResult,
} from '$/modules/project/logic/meatdata-suggestion';
import { metadataEditorDialogAtom } from '$/states/dialogs.ts';
import { resolvedThemeAtom } from '@/atoms/theme';
import { lyricLinesAtom } from '$/states/main.ts';
import type { TTMLLyric, TTMLMetadata } from '$/types/ttml';
import { readBrandAccentStyle } from './metadata-dialog-theme';
import styles from './MetadataEditor.module.css';
import { AppleMusicIcon, GithubIcon, NeteaseIcon, QQMusicIcon, SpotifyIcon } from './PlatformIcons';

interface SelectOption {
  label: string;
  value: string;
  icon: ReactNode;
  isLinkable?: true;
  urlFormatter?: (value: string) => string | null;
  suggestion?: true;
  validation?: {
    verifier: (value: string) => boolean;
    message: string;
    /** red for true, orange for false */
    severe?: boolean;
  };
}

interface MetadataItemEditorProps {
  entry: TTMLMetadata | null;
  option: SelectOption;
  setLyricLines: (args: (prev: TTMLLyric) => void) => void;
  requestNeteaseMeta: (id: string) => Promise<void>;
}

const contentTransition = {
  duration: 0.25,
  ease: [0.4, 0, 0.2, 1],
} as const;

const contentVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
} as const;

const splitDroppedValues = (text: string) =>
  text
    .split(/[\n,;/，；、|\\]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');

interface MetadataValueEditorRowProps {
  value: string;
  valueIndex: number;
  values: string[];
  option: SelectOption;
  validation?: SelectOption['validation'];
  entryAutoSuggested?: boolean;
  inputRef: (el: HTMLInputElement | null) => void;
  isDragOver: boolean;
  setDragInputIndex: (value: number | null) => void;
  setIsDraggingCategory: (value: boolean) => void;
  updateValue: (index: number, value: string) => void;
  addValue: () => void;
  removeValue: (index: number) => void;
  setFocusIndex: (value: number) => void;
  applySuggestionValues: (suggestions: string[]) => void;
  requestNeteaseMeta: (id: string) => Promise<void>;
}

const MetadataValueEditorRow = memo(
  ({
    value,
    valueIndex,
    values,
    option,
    validation,
    entryAutoSuggested,
    inputRef,
    isDragOver,
    setDragInputIndex,
    setIsDraggingCategory,
    updateValue,
    addValue,
    removeValue,
    setFocusIndex,
    applySuggestionValues,
    requestNeteaseMeta,
  }: MetadataValueEditorRowProps) => {
    const { t } = useTranslation();
    const [suggestions, setSuggestions] = useState<MetaSuggestionResult[]>([]);
    const [isFocused, setIsFocused] = useState(false);
    const [isFetchingMeta, setIsFetchingMeta] = useState(false);

    useEffect(() => {
      let active = true;
      if (!option.suggestion || entryAutoSuggested) {
        setSuggestions([]);
        return () => {
          active = false;
        };
      }

      const currentValue = value.trim();
      if (!currentValue) {
        setSuggestions([]);
        return () => {
          active = false;
        };
      }

      getMeatdataSuggestion(currentValue)
        .then((results) => {
          if (!active) return;
          if (results.length === 1) {
            const matchedValue = results[0]?.matchedValue;
            if (
              matchedValue &&
              currentValue.toLowerCase() === matchedValue.toLowerCase() &&
              currentValue !== matchedValue
            ) {
              updateValue(valueIndex, matchedValue);
            }
          }
          setSuggestions(results);
        })
        .catch(() => {
          if (!active) return;
          setSuggestions([]);
        });

      return () => {
        active = false;
      };
    }, [entryAutoSuggested, option.suggestion, updateValue, value, valueIndex]);

    const itemHasError = validation ? value.trim() !== '' && !validation.verifier(value) : false;
    const isDuplicate = value.trim() !== '' && values.filter((item) => item === value).length > 1;
    const hasAnyError = itemHasError || isDuplicate;
    const url = option.urlFormatter?.(value);
    const isValid = validation ? validation.verifier(value) : true;
    const isButtonEnabled = !!url && isValid;
    const hasSuggestion = suggestions.length > 0;
    const canFetchNeteaseMeta = option.value === 'ncmMusicId' && !isFocused && value.trim() !== '';

    return (
      <Flex gap="2" align="center" className={styles.valueRow}>
        <TextField.Root
          data-metadata-input="true"
          ref={inputRef}
          value={value}
          className={`${styles.metadataInput} ${isDragOver ? styles.dragOverInput : ''}`}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onChange={(e) => updateValue(valueIndex, e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addValue();
            } else if (e.key === 'Backspace' && e.currentTarget.value === '') {
              if (e.repeat) return;

              e.preventDefault();
              removeValue(valueIndex);
              setFocusIndex(valueIndex > 0 ? valueIndex - 1 : 0);
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragInputIndex(valueIndex);
          }}
          onDragLeave={() => setDragInputIndex(null)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragInputIndex(null);
            setIsDraggingCategory(false);
            const text = e.dataTransfer.getData('text');
            if (text) updateValue(valueIndex, text);
          }}
          variant={hasAnyError ? 'soft' : 'surface'}
          color={
            itemHasError ? (validation?.severe ? 'red' : 'orange') : isDuplicate ? 'red' : undefined
          }
        />
        {hasSuggestion && suggestions.length === 1 && suggestions[0]?.matchedValue !== value && (
          <IconButton
            variant="soft"
            onClick={() => {
              applySuggestionValues(suggestions[0]?.values ?? []);
              setSuggestions([]);
            }}
            title={t('metadataDialog.applySuggestion', '应用建议')}
          >
            <Sparkle20Regular />
          </IconButton>
        )}
        {hasSuggestion && suggestions.length > 1 && (
          <Dialog.Root>
            <Dialog.Trigger>
              <IconButton variant="soft" title={t('metadataDialog.pickSuggestion', '选择匹配项')}>
                <Sparkle20Regular />
              </IconButton>
            </Dialog.Trigger>
            <Dialog.Content>
              <Dialog.Title>{t('metadataDialog.pickSuggestion', '选择匹配项')}</Dialog.Title>
              <Flex direction="column" gap="2">
                {suggestions.map((suggestion) => (
                  <Dialog.Close key={suggestion.title}>
                    <Button
                      variant="soft"
                      onClick={() => {
                        applySuggestionValues(suggestion.values);
                        setSuggestions([]);
                      }}
                    >
                      {suggestion.title}
                    </Button>
                  </Dialog.Close>
                ))}
              </Flex>
            </Dialog.Content>
          </Dialog.Root>
        )}
        {canFetchNeteaseMeta && (
          <IconButton
            variant="soft"
            disabled={isFetchingMeta}
            onClick={async () => {
              if (isFetchingMeta) return;
              const trimmed = value.trim();
              if (!trimmed) return;
              setIsFetchingMeta(true);
              try {
                await requestNeteaseMeta(trimmed);
              } finally {
                setIsFetchingMeta(false);
              }
            }}
            title={t('metadataDialog.fetchNeteaseMeta', '从网易云获取元数据')}
          >
            {isFetchingMeta ? <Spinner size="1" /> : <GlobeSearch20Regular />}
          </IconButton>
        )}
        {option.isLinkable && (
          <IconButton
            disabled={!isButtonEnabled}
            asChild={isButtonEnabled}
            variant="soft"
            title={t('metadataDialog.openLink', '打开链接')}
          >
            {isButtonEnabled ? (
              <a href={url || ''} target="_blank" rel="noopener noreferrer">
                <Open16Regular />
              </a>
            ) : (
              <Open16Regular />
            )}
          </IconButton>
        )}
        <IconButton variant="soft" onClick={() => removeValue(valueIndex)}>
          <Delete16Regular />
        </IconButton>
      </Flex>
    );
  }
);

const MetadataItemEditor = memo(
  ({ entry, option, setLyricLines, requestNeteaseMeta }: MetadataItemEditorProps) => {
    const { t } = useTranslation();
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
    const [focusIndex, setFocusIndex] = useState<number | null>(null);
    const [isDraggingCategory, setIsDraggingCategory] = useState(false);
    const [dragInputIndex, setDragInputIndex] = useState<number | null>(null);
    /*
     * `?? []` 每次渲染都产生新数组引用，会让下游依赖它的 useMemo
     * 每帧重算。用 useMemo 稳定引用，仅在 entry?.value 变化时更新。
     */
    const values = useMemo(() => entry?.value ?? [], [entry?.value]);
    const validation = option.validation;

    useEffect(() => {
      if (focusIndex === null) return;

      const targetInput = inputRefs.current[focusIndex];
      if (targetInput) {
        targetInput.focus();
        const len = targetInput.value.length;
        targetInput.setSelectionRange(len, len);
      }
      setFocusIndex(null);
    }, [focusIndex]);

    const editEntry = useCallback(
      (editor: (metadata: TTMLMetadata) => void) => {
        setLyricLines((prev) => {
          let metadata = prev.metadata.find((item) => item.key === option.value);
          if (!metadata) {
            metadata = { key: option.value, value: [] };
            prev.metadata.push(metadata);
          }
          editor(metadata);
        });
      },
      [option.value, setLyricLines]
    );

    const updateValue = useCallback(
      (index: number, value: string) => {
        editEntry((metadata) => {
          metadata.value[index] = value;
          metadata.autoSuggested = false;
        });
      },
      [editEntry]
    );

    const addValue = useCallback(
      (value = '') => {
        editEntry((metadata) => {
          metadata.value.push(value);
        });
        setFocusIndex(values.length);
      },
      [editEntry, values.length]
    );

    const removeValue = useCallback(
      (index: number) => {
        setLyricLines((prev) => {
          const metadataIndex = prev.metadata.findIndex((item) => item.key === option.value);
          const entry = prev.metadata[metadataIndex];
          if (metadataIndex === -1 || !entry) return;

          entry.value.splice(index, 1);
          if (entry.value.length === 0) {
            prev.metadata.splice(metadataIndex, 1);
          }
        });
      },
      [option.value, setLyricLines]
    );

    const appendDroppedValues = useCallback(
      (text: string) => {
        const parts = splitDroppedValues(text);
        if (parts.length === 0) return;

        editEntry((metadata) => {
          const existingSet = new Set<string>();
          const emptyIndices: number[] = [];

          metadata.value.forEach((val, i) => {
            if (val.trim() === '') {
              emptyIndices.push(i);
            } else {
              existingSet.add(val);
            }
          });

          for (const part of parts) {
            if (existingSet.has(part)) continue;

            if (emptyIndices.length > 0) {
              const slotIndex = emptyIndices.shift();
              if (slotIndex !== undefined) metadata.value[slotIndex] = part;
            } else {
              metadata.value.push(part);
            }
            existingSet.add(part);
          }
          metadata.autoSuggested = false;
        });
      },
      [editEntry]
    );

    const applySuggestionValues = useCallback(
      (suggestions: string[]) => {
        const normalized = suggestions.map((item) => item.trim()).filter((item) => item !== '');
        if (normalized.length === 0) return;

        editEntry((metadata) => {
          const existingSet = new Set<string>();
          const emptyIndices: number[] = [];
          metadata.value.forEach((val, i) => {
            if (val.trim() === '') {
              emptyIndices.push(i);
            } else {
              existingSet.add(val);
            }
          });

          for (const suggestion of normalized) {
            if (existingSet.has(suggestion)) continue;
            if (emptyIndices.length > 0) {
              const slotIndex = emptyIndices.shift();
              if (slotIndex === undefined) {
                metadata.value.push(suggestion);
              } else {
                metadata.value[slotIndex] = suggestion;
              }
            } else {
              metadata.value.push(suggestion);
            }
            existingSet.add(suggestion);
          }
          metadata.autoSuggested = true;
        });
      },
      [editEntry]
    );

    const rowHasError = validation
      ? values.some((val) => val.trim() !== '' && !validation.verifier(val))
      : false;
    const rowHasDuplicate = useMemo(() => {
      const filledValues = values.filter((v) => v.trim() !== '');
      return new Set(filledValues).size !== filledValues.length;
    }, [values]);

    return (
      <div
        className={`${styles.editorPanel} ${isDraggingCategory ? styles.dragOverCategory : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingCategory(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDraggingCategory(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDraggingCategory(false);
          appendDroppedValues(e.dataTransfer.getData('text'));
        }}
      >
        <div className={styles.valueList}>
          {values.length === 0 && (
            <div className={styles.emptyState}>
              <Text color="gray">{t('metadataDialog.emptyItem', '此项尚未添加任何条目')}</Text>
            </div>
          )}
          {values.map((value, index) => (
            <MetadataValueEditorRow
              key={`${option.value}-${index}`}
              value={value}
              valueIndex={index}
              values={values}
              option={option}
              validation={validation}
              entryAutoSuggested={entry?.autoSuggested}
              inputRef={(el) => {
                inputRefs.current[index] = el;
              }}
              isDragOver={dragInputIndex === index}
              setDragInputIndex={setDragInputIndex}
              setIsDraggingCategory={setIsDraggingCategory}
              updateValue={updateValue}
              addValue={addValue}
              removeValue={removeValue}
              setFocusIndex={setFocusIndex}
              applySuggestionValues={applySuggestionValues}
              requestNeteaseMeta={requestNeteaseMeta}
            />
          ))}
        </div>

        {validation && rowHasError && (
          <Text color={validation.severe ? 'red' : 'orange'} size="1" wrap="wrap">
            {validation.message}
          </Text>
        )}
        {rowHasDuplicate && (
          <Text color="red" size="1" wrap="wrap">
            {t('metadataDialog.duplicateMsg', '存在重复的元数据值')}
          </Text>
        )}
        <Button variant="soft" onClick={() => addValue()}>
          <Add16Regular />
          {t('metadataDialog.addValue', '添加')}
        </Button>
      </div>
    );
  }
);

export const MetadataEditor = () => {
  const [metadataEditorDialog, setMetadataEditorDialog] = useAtom(metadataEditorDialogAtom);
  const [customKey, setCustomKey] = useState('');
  const [lyricLines, setLyricLines] = useImmerAtom(lyricLinesAtom);

  // 弹窗 Portal 到 body，不在 Theme 作用域内，色阶要自己内联下发。
  // 色值从 CSS 变量读（editor-theme.css 是唯一来源），不硬编码。
  const resolvedTheme = useAtomValue(resolvedThemeAtom);
  const accentStyle = useMemo(
    () => readBrandAccentStyle(),
    // CSS 变量变化不触发 React 重渲染，靠主题值作为重算信号。
    // readBrandAccentStyle() 内部不读 resolvedTheme，所以这里「用不到」
    // 它是故意的 —— eslint-disable 是必要的，不是遗漏。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 主题值仅作为重算信号
    [resolvedTheme]
  );

  const { t } = useTranslation();
  /**
   * 从网易云 ID 拉取歌曲资料并填进元数据。
   *
   * 审核页不搬网易云模块（tool 那边是「登录网易云后搜索并导入歌曲资料」，
   * 涉及 OAuth 与 cookie 持久化）。审核页的元数据来自投稿本身，
   * 运营方/作者该填的字段在下方表单里直接改，不需要外部查询源。
   *
   * 保留这个空实现（而不是删掉 prop）是为了让 `MetadataValueEditorRow`
   * 的 props 形状与上游保持一致 —— 那里还有「粘贴 ncm ID → 查询」按钮，
   * 点击后什么也不会发生，符合「审核页不提供该能力」的预期。
   */
  const requestNeteaseMeta = useCallback(async (_id: string) => {
    // 审核页不提供网易云资料查询
  }, []);

  const builtinOptions: SelectOption[] = useMemo(() => {
    const numeric = (value: string) => /^\d+$/.test(value);
    const alphanumeric = (value: string) => /^[a-zA-Z0-9]+$/.test(value);

    const getPlatformUrl = (key: string, value: string) => {
      if (!value || !value.trim()) return null;

      switch (key) {
        case 'ncmMusicId':
          return `https://music.163.com/#/song?id=${value}`;
        case 'qqMusicId':
          return `https://y.qq.com/n/ryqq/songDetail/${value}`;
        case 'spotifyId':
          return `https://open.spotify.com/track/${value}`;
        case 'appleMusicId':
          return `https://music.apple.com/song/${value}`;
        case 'ttmlAuthorGithubLogin':
          return `https://github.com/${value}`;
        case 'isrc':
          return `https://isrcsearch.ifpi.org/?tab=%22code%22&isrcCode=%22${value}%22`;
        default:
          return null;
      }
    };
    return [
      // 歌词所匹配的歌曲名
      {
        label: t('metadataDialog.builtinOptions.musicName', '歌曲名称'),
        value: 'musicName',
        icon: <MusicNote1Regular />,
      },
      // 歌词所匹配的歌手名
      {
        label: t('metadataDialog.builtinOptions.artists', '歌曲的艺术家'),
        value: 'artists',
        icon: <Person16Regular />,
        suggestion: true,
        validation: {
          verifier: (value: string) => !/^.+[,;&，；、].+$/.test(value),
          message: t(
            'metadataDialog.builtinOptions.artistsInvalidMsg',
            '如果有多个艺术家，请多次添加该键值，避免使用分隔符'
          ),
        },
      },
      // 歌词所匹配的词曲作者
      {
        label: t('metadataDialog.builtinOptions.songwriter', '词曲作者'),
        value: 'songwriter',
        icon: <Person16Regular />,
        validation: {
          verifier: (value: string) => !/^.+[,;&，；、].+$/.test(value),
          message: t(
            'metadataDialog.builtinOptions.songwriterInvalidMsg',
            '如果有多个词曲作者，请多次添加该键值，避免使用分隔符'
          ),
        },
      },
      // 歌词所匹配的专辑名
      {
        label: t('metadataDialog.builtinOptions.album', '歌曲的专辑名'),
        value: 'album',
        icon: <AlbumRegular />,
      },
      // 歌词所匹配的网易云音乐 ID
      {
        label: t('metadataDialog.builtinOptions.ncmMusicId', '网易云音乐 ID'),
        value: 'ncmMusicId',
        icon: <NeteaseIcon />,
        isLinkable: true,
        urlFormatter: (val) => getPlatformUrl('ncmMusicId', val),
        validation: {
          verifier: numeric,
          message: t(
            'metadataDialog.builtinOptions.ncmMusicIdInvalidMsg',
            '网易云音乐 ID 应为纯数字'
          ),
          severe: true,
        },
      },
      // 歌词所匹配的 QQ 音乐 ID
      {
        label: t('metadataDialog.builtinOptions.qqMusicId', 'QQ 音乐 ID'),
        value: 'qqMusicId',
        icon: <QQMusicIcon />,
        isLinkable: true,
        urlFormatter: (val) => getPlatformUrl('qqMusicId', val),
        validation: {
          verifier: alphanumeric,
          message: t(
            'metadataDialog.builtinOptions.qqMusicIdInvalidMsg',
            'QQ 音乐 ID 应为字母或数字'
          ),
          severe: true,
        },
      },
      // 歌词所匹配的 Spotify 音乐 ID
      {
        label: t('metadataDialog.builtinOptions.spotifyId', 'Spotify 音乐 ID'),
        value: 'spotifyId',
        icon: <SpotifyIcon />,
        isLinkable: true,
        urlFormatter: (val) => getPlatformUrl('spotifyId', val),
        validation: {
          verifier: alphanumeric,
          message: t(
            'metadataDialog.builtinOptions.spotifyIdInvalidMsg',
            'Spotify ID 应为字母或数字'
          ),
          severe: true,
        },
      },
      // 歌词所匹配的 Apple Music 音乐 ID
      {
        label: t('metadataDialog.builtinOptions.appleMusicId', 'Apple Music 音乐 ID'),
        value: 'appleMusicId',
        icon: <AppleMusicIcon />,
        isLinkable: true,
        urlFormatter: (val) => getPlatformUrl('appleMusicId', val),
        validation: {
          verifier: numeric,
          message: t(
            'metadataDialog.builtinOptions.appleMusicIdInvalidMsg',
            'Apple Music ID 应为纯数字'
          ),
          severe: true,
        },
      },
      // 歌词所匹配的 ISRC 编码
      {
        label: t('metadataDialog.builtinOptions.isrc', '歌曲的 ISRC 号码'),
        value: 'isrc',
        icon: <NumberSymbol16Regular />,
        isLinkable: true,
        urlFormatter: (val) => getPlatformUrl('isrc', val),
        validation: {
          verifier: (value: string) => /^[A-Z]{2}-?[A-Z0-9]{3}-?\d{2}-?\d{5}$/.test(value),
          message: t(
            'metadataDialog.builtinOptions.isrcInvalidMsg',
            'ISRC 编码格式应为 CC-XXX-YY-NNNNN'
          ),
          severe: true,
        },
      },
      // 逐词歌词作者 GitHub ID，例如 39523898
      {
        label: t('metadataDialog.builtinOptions.ttmlAuthorGithub', '歌词作者 GitHub ID'),
        value: 'ttmlAuthorGithub',
        icon: <GithubIcon />,
        validation: {
          verifier: numeric,
          message: t(
            'metadataDialog.builtinOptions.ttmlAuthorGithubInvalidMsg',
            'GitHub ID 应为纯数字'
          ),
          severe: true,
        },
      },
      // 逐词歌词作者 GitHub 用户名，例如 Steve-xmh
      {
        label: t('metadataDialog.builtinOptions.ttmlAuthorGithubLogin', '歌词作者 GitHub 用户名'),
        value: 'ttmlAuthorGithubLogin',
        icon: <GithubIcon />,
        isLinkable: true,
        urlFormatter: (val) => getPlatformUrl('ttmlAuthorGithubLogin', val),
        validation: {
          verifier: (value: string) =>
            /^(?!.*--)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(value),
          message: t(
            'metadataDialog.builtinOptions.ttmlAuthorGithubLoginInvalidMsg',
            'GitHub username should be alphanumeric or hyphens, up to 39 characters'
          ),
          severe: true,
        },
      },
    ];
  }, [t]);

  const customOptions: SelectOption[] = useMemo(
    () =>
      lyricLines.metadata
        .filter((metadata) => !builtinOptions.some((option) => option.value === metadata.key))
        .map((metadata) => ({
          label: metadata.key,
          value: metadata.key,
          icon: <Info16Regular />,
        })),
    [builtinOptions, lyricLines.metadata]
  );
  const navOptions = useMemo(
    () => [...builtinOptions, ...customOptions],
    [builtinOptions, customOptions]
  );
  const [activeKey, setActiveKey] = useState(() => builtinOptions[0]?.value ?? '');
  const activeOption = navOptions.find((option) => option.value === activeKey) ?? navOptions[0];
  const activeEntry =
    lyricLines.metadata.find((metadata) => metadata.key === activeOption?.value) ?? null;

  useEffect(() => {
    if (activeOption) return;
    setActiveKey(builtinOptions[0]?.value ?? '');
  }, [activeOption, builtinOptions]);

  const addCustomKey = useCallback(() => {
    const nextKey = customKey.trim();
    if (!nextKey) return;

    setLyricLines((prev) => {
      if (!prev.metadata.some((metadata) => metadata.key === nextKey)) {
        prev.metadata.push({ key: nextKey, value: [] });
      }
    });
    setActiveKey(nextKey);
    setCustomKey('');
  }, [customKey, setLyricLines]);

  const clearAllMetadata = useCallback(() => {
    setLyricLines((prev) => {
      prev.metadata = [];
    });
    setActiveKey(builtinOptions[0]?.value ?? '');
  }, [builtinOptions, setLyricLines]);

  return (
    <Dialog.Root
      open={metadataEditorDialog}
      onOpenChange={(open) => {
        setMetadataEditorDialog(open);
        if (!open) {
          // 弹窗关闭时清理 trim 后为空的元数据
          setLyricLines((prev) => {
            // 清理每个元数据条目中的空值
            prev.metadata = prev.metadata
              .map((entry) => ({
                ...entry,
                value: entry.value.filter((v) => v.trim() !== ''),
              }))
              .filter((entry) => entry.value.length > 0);
          });
        }
      }}
    >
      <Dialog.Content
        className={styles.dialogContent}
        /*
         * 主题色用**内联 style**下发，不用 CSS 类。
         *
         * 原因：Radix 的 `Dialog.Content` 内部又套了一层
         * `<Theme asChild>`，它在自己所在的元素上渲染出
         * `data-accent-color="indigo"`（Theme 的默认值），
         * 而 Radix 的色阶正是用这个属性选择器声明的：
         *
         *   [data-accent-color='indigo'] { --accent-9: … }  ← 0,1,0
         *
         * 浮层在 body 子树里，跟工作台那套 `.editor-radix-theme`
         * 覆写不在一条继承链上，CSS 类很难稳定压过它 ——
         * 这就是「弹窗里按钮/复选框颜色和外面不一样」的原因。
         *
         * 内联 style 优先级高于任何非 `!important` 声明，
         * 直接写在 Content 元素上必然生效，也不用去猜层叠顺序。
         *
         * 色值与 `components/review/editor-theme.css` 保持一致
         * （站点品牌红 #e0303f），深色模式的提亮档在下面按需覆盖。
         */
        style={accentStyle}
      >
        <Dialog.Title className={styles.srOnly}>
          {t('metadataDialog.title', '元数据编辑器')}
        </Dialog.Title>

        <aside className={styles.sidebar}>
          <Text as="div" weight="bold" size="2" className={styles.sidebarTitle}>
            {t('metadataDialog.title', '元数据编辑器')}
          </Text>
          <nav className={styles.navList}>
            {navOptions.map((option) => {
              const selected = activeOption?.value === option.value;
              const entry = lyricLines.metadata.find((metadata) => metadata.key === option.value);
              const valueCount = entry?.value.filter((value) => value.trim() !== '').length ?? 0;

              return (
                <button
                  key={option.value}
                  type="button"
                  className={styles.navItem}
                  data-active={selected || undefined}
                  onClick={() => setActiveKey(option.value)}
                >
                  <span className={styles.navIcon}>{option.icon}</span>
                  <span className={styles.navItemText}>{option.label}</span>
                  {valueCount > 0 && <span className={styles.navBadge}>{valueCount}</span>}
                </button>
              );
            })}
          </nav>
          <div className={styles.customKeyForm}>
            <TextField.Root
              placeholder={t('metadataDialog.customKey', '自定义键名')}
              value={customKey}
              onChange={(e) => setCustomKey(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustomKey();
                }
              }}
            />
            <IconButton variant="soft" onClick={addCustomKey}>
              <Add16Regular />
            </IconButton>
          </div>
        </aside>

        <section className={styles.mainPane}>
          <header className={styles.header}>
            <div className={styles.titleBlock}>
              <Heading size="7" className={styles.pageTitle}>
                {activeOption?.label}
              </Heading>
              {activeOption && (
                <Text size="2" color="gray" className={styles.titleMeta}>
                  {activeOption.value}
                </Text>
              )}
            </div>
          </header>

          <div className={styles.scrollContent}>
            <AnimatePresence mode="wait" initial={false}>
              {activeOption && (
                <motion.div
                  key={activeOption.value}
                  className={styles.contentTransition}
                  variants={contentVariants}
                  initial="initial"
                  animate="animate"
                  transition={contentTransition}
                >
                  <MetadataItemEditor
                    entry={activeEntry}
                    option={activeOption}
                    setLyricLines={setLyricLines}
                    requestNeteaseMeta={requestNeteaseMeta}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Flex
            gap="2"
            direction={{
              sm: 'row',
              initial: 'column',
            }}
            className={styles.dialogFooter}
          >
            <Button
              style={{ flex: '1 0 auto' }}
              color="red"
              variant="solid"
              onClick={clearAllMetadata}
            >
              <Delete16Regular />
              {t('metadataDialog.clear', '清空')}
            </Button>
            <Button asChild variant="soft">
              <a
                target="_blank"
                rel="noreferrer"
                href="https://github.com/amll-dev/amll-ttml-tool/wiki/%E6%AD%8C%E8%AF%8D%E5%85%83%E6%95%B0%E6%8D%AE"
              >
                <Info16Regular />
                {t('metadataDialog.info', '了解详情')}
              </a>
            </Button>
          </Flex>
        </section>
      </Dialog.Content>
    </Dialog.Root>
  );
};
