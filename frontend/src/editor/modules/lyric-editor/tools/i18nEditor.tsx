import { useAtomValue, useSetAtom } from 'jotai';
import { useSetImmerAtom } from 'jotai-immer';
import { Plus } from 'lucide-react';
import { type FC, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { addLanguageDialogAtom } from '$/states/dialogs';
import { lyricLinesAtom } from '$/states/main.ts';

export const I18nEditor: FC = () => {
  const lyricLines = useAtomValue(lyricLinesAtom);
  const editLyricLines = useSetImmerAtom(lyricLinesAtom);
  const setAddLanguageDialog = useSetAtom(addLanguageDialogAtom);
  const placeholder = '请选择语言';

  /** 只有一个 und 条目时，说明这行没有指定语言，退回 und 处理。 */
  const isOnlyUndEntry = (entries: [string, string][]) =>
    entries.length === 1 && entries[0]?.[0] === 'und';

  const translationLanguages = useMemo(() => {
    const languages = new Set<string>();
    let hasUndFallback = false;
    for (const line of lyricLines.lyricLines) {
      if (!line.translatedLyricByLang) continue;
      const entries = Object.entries(line.translatedLyricByLang);
      if (isOnlyUndEntry(entries)) {
        hasUndFallback = true;
        continue;
      }
      for (const [lang, value] of entries) {
        if (value.trim().length > 0) {
          languages.add(lang);
        }
      }
    }
    if (languages.size === 0 && hasUndFallback) {
      languages.add('und');
    }
    return Array.from(languages);
  }, [lyricLines]);

  const romanizationLanguages = useMemo(() => {
    const languages = new Set<string>();
    let hasUndFallback = false;
    for (const line of lyricLines.lyricLines) {
      if (!line.romanLyricByLang) continue;
      const entries = Object.entries(line.romanLyricByLang);
      if (isOnlyUndEntry(entries)) {
        hasUndFallback = true;
        continue;
      }
      for (const [lang, value] of entries) {
        if (value.trim().length > 0) {
          languages.add(lang);
        }
      }
    }
    if (languages.size === 0 && hasUndFallback) {
      languages.add('und');
    }
    return Array.from(languages);
  }, [lyricLines]);

  const wordRomanizationLanguages = useMemo(() => {
    const languages = new Set<string>();
    let hasUndFallback = false;
    for (const line of lyricLines.lyricLines) {
      if (line.wordRomanizationLang === 'und') {
        hasUndFallback = true;
      }
      if (!line.wordRomanizationByLang) continue;
      for (const [lang, words] of Object.entries(line.wordRomanizationByLang)) {
        if (words.length > 0) {
          languages.add(lang);
        }
      }
    }
    if (languages.size === 0 && hasUndFallback) {
      languages.add('und');
    }
    return Array.from(languages);
  }, [lyricLines]);

  const currentTranslationLang = useMemo(() => {
    let matchedLang: string | undefined;
    for (const line of lyricLines.lyricLines) {
      const byLang = line.translatedLyricByLang;
      if (!byLang) continue;
      const keys = Object.keys(byLang);
      if (keys.length === 1 && keys[0] === 'und') {
        if (matchedLang && matchedLang !== 'und') return undefined;
        matchedLang = 'und';
        continue;
      }
      const matched = Object.entries(byLang).find(([, value]) => {
        const nextValue = value.trim().length > 0 ? value : '';
        return nextValue === line.translatedLyric && value.trim().length > 0;
      })?.[0];
      if (!matched) return undefined;
      if (matchedLang && matchedLang !== matched) return undefined;
      matchedLang = matched;
    }
    return matchedLang;
  }, [lyricLines]);

  const currentRomanizationLang = useMemo(() => {
    let matchedLang: string | undefined;
    for (const line of lyricLines.lyricLines) {
      const byLang = line.romanLyricByLang;
      if (!byLang) continue;
      const keys = Object.keys(byLang);
      if (keys.length === 1 && keys[0] === 'und') {
        if (matchedLang && matchedLang !== 'und') return undefined;
        matchedLang = 'und';
        continue;
      }
      const matched = Object.entries(byLang).find(([, value]) => {
        const nextValue = value.trim().length > 0 ? value : '';
        return nextValue === line.romanLyric && value.trim().length > 0;
      })?.[0];
      if (!matched) return undefined;
      if (matchedLang && matchedLang !== matched) return undefined;
      matchedLang = matched;
    }
    return matchedLang;
  }, [lyricLines]);

  const currentWordRomanizationLang = useMemo(() => {
    let matchedLang: string | undefined;
    for (const line of lyricLines.lyricLines) {
      if (line.wordRomanizationLang === 'und') {
        if (matchedLang && matchedLang !== 'und') return undefined;
        matchedLang = 'und';
        continue;
      }
      const byLang = line.wordRomanizationByLang;
      if (!byLang) continue;
      let lineMatched: string | undefined;
      for (const [lang, romans] of Object.entries(byLang)) {
        if (romans.length === 0) continue;
        let matches = true;
        for (const word of line.words) {
          if (word.word.trim().length === 0) continue;
          const match = romans.find(
            (r) => r.startTime === word.startTime && r.endTime === word.endTime
          );
          const roman = match?.text ?? '';
          if (roman.trim().length === 0) continue;
          if (word.romanWord !== roman) {
            matches = false;
            break;
          }
        }
        if (matches) {
          lineMatched = lang;
          break;
        }
      }
      if (!lineMatched) return undefined;
      if (matchedLang && matchedLang !== lineMatched) return undefined;
      matchedLang = lineMatched;
    }
    return matchedLang;
  }, [lyricLines]);

  const applyTranslationLang = useCallback(
    function applyTranslationLangInner(lang: string) {
      if (lang === 'und') {
        setAddLanguageDialog({
          open: true,
          target: 'translation',
          onSubmit: (nextLang) => {
            editLyricLines((state) => {
              for (const line of state.lyricLines) {
                const byLang = line.translatedLyricByLang;
                if (!byLang || !byLang.und) continue;
                byLang[nextLang] = byLang.und;
                delete byLang.und;
              }
            });
            applyTranslationLangInner(nextLang);
          },
        });
        return;
      }
      editLyricLines((state) => {
        for (const line of state.lyricLines) {
          line.translatedLyric = line.translatedLyricByLang?.[lang] ?? '';
        }
      });
    },
    [editLyricLines, setAddLanguageDialog]
  );

  const applyRomanizationLang = useCallback(
    function applyRomanizationLangInner(lang: string) {
      if (lang === 'und') {
        setAddLanguageDialog({
          open: true,
          target: 'romanization',
          onSubmit: (nextLang) => {
            editLyricLines((state) => {
              for (const line of state.lyricLines) {
                const byLang = line.romanLyricByLang;
                if (!byLang || !byLang.und) continue;
                byLang[nextLang] = byLang.und;
                delete byLang.und;
              }
            });
            applyRomanizationLangInner(nextLang);
          },
        });
        return;
      }
      editLyricLines((state) => {
        for (const line of state.lyricLines) {
          line.romanLyric = line.romanLyricByLang?.[lang] ?? '';
        }
      });
    },
    [editLyricLines, setAddLanguageDialog]
  );

  const applyWordRomanizationLang = useCallback(
    function applyWordRomanizationLangInner(lang: string) {
      if (lang === 'und') {
        editLyricLines((state) => {
          for (const line of state.lyricLines) {
            if (
              line.words.some((word) => word.romanWord.trim().length > 0) ||
              line.wordRomanizationLang === 'und'
            ) {
              line.wordRomanizationLang = 'und';
            }
            if (line.wordRomanizationByLang?.und) {
              delete line.wordRomanizationByLang.und;
            }
          }
        });
        return;
      }
      editLyricLines((state) => {
        for (const line of state.lyricLines) {
          const romanWords = line.wordRomanizationByLang?.[lang] ?? [];
          if (romanWords.length === 0) {
            for (const word of line.words) {
              word.romanWord = '';
            }
            continue;
          }
          for (const word of line.words) {
            if (word.word.trim().length === 0) {
              word.romanWord = '';
              continue;
            }
            const match = romanWords.find(
              (r) => r.startTime === word.startTime && r.endTime === word.endTime
            );
            word.romanWord = match?.text ?? '';
          }
          line.wordRomanizationLang = lang;
        }
      });
    },
    [editLyricLines]
  );

  const openAddTranslationDialog = useCallback(() => {
    setAddLanguageDialog({
      open: true,
      target: 'translation',
      onSubmit: (lang) => {
        editLyricLines((state) => {
          for (const line of state.lyricLines) {
            line.translatedLyricByLang ??= {};
            line.translatedLyricByLang[lang] = line.translatedLyric ?? '';
            line.translatedLyric = line.translatedLyricByLang[lang] ?? '';
          }
        });
        applyTranslationLang(lang);
      },
    });
  }, [applyTranslationLang, editLyricLines, setAddLanguageDialog]);

  const openAddRomanizationDialog = useCallback(() => {
    setAddLanguageDialog({
      open: true,
      target: 'romanization',
      onSubmit: (lang) => {
        editLyricLines((state) => {
          for (const line of state.lyricLines) {
            line.romanLyricByLang ??= {};
            line.romanLyricByLang[lang] = line.romanLyric ?? '';
            line.romanLyric = line.romanLyricByLang[lang] ?? '';
          }
        });
        applyRomanizationLang(lang);
      },
    });
  }, [applyRomanizationLang, editLyricLines, setAddLanguageDialog]);

  const openAddWordRomanizationDialog = useCallback(() => {
    setAddLanguageDialog({
      open: true,
      target: 'word-romanization',
      onSubmit: (lang) => {
        editLyricLines((state) => {
          for (const line of state.lyricLines) {
            line.wordRomanizationByLang ??= {};
            const romanWords = line.words
              .filter((word) => word.romanWord.trim().length > 0)
              .map((word) => ({
                startTime: word.startTime,
                endTime: word.endTime,
                text: word.romanWord,
              }));
            line.wordRomanizationByLang[lang] = romanWords;
            line.wordRomanizationLang = lang;
          }
        });
        applyWordRomanizationLang(lang);
      },
    });
  }, [applyWordRomanizationLang, editLyricLines, setAddLanguageDialog]);

  return (
    <div className="grid flex-1 grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1">
      <span className="whitespace-nowrap text-xs">翻译</span>
      <Select
        value={currentTranslationLang ?? ''}
        onChange={(e) => applyTranslationLang(e.target.value)}
        disabled={translationLanguages.length === 0}
        className="h-7 text-xs"
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {translationLanguages.map((lang) => (
          <option key={lang} value={lang}>
            {lang}
          </option>
        ))}
      </Select>
      <Button
        variant="secondary"
        size="icon"
        className="size-7 shrink-0"
        onClick={openAddTranslationDialog}
        aria-label="新增翻译语言"
      >
        <Plus className="size-4" />
      </Button>
      <span className="whitespace-nowrap text-xs">音译</span>
      <Select
        value={currentRomanizationLang ?? ''}
        onChange={(e) => applyRomanizationLang(e.target.value)}
        disabled={romanizationLanguages.length === 0}
        className="h-7 text-xs"
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {romanizationLanguages.map((lang) => (
          <option key={lang} value={lang}>
            {lang}
          </option>
        ))}
      </Select>
      <Button
        variant="secondary"
        size="icon"
        className="size-7 shrink-0"
        onClick={openAddRomanizationDialog}
        aria-label="新增音译语言"
      >
        <Plus className="size-4" />
      </Button>
      <span className="whitespace-nowrap text-xs">逐字音译</span>
      <Select
        value={currentWordRomanizationLang ?? ''}
        onChange={(e) => applyWordRomanizationLang(e.target.value)}
        disabled={wordRomanizationLanguages.length === 0}
        className="h-7 text-xs"
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {wordRomanizationLanguages.map((lang) => (
          <option key={lang} value={lang}>
            {lang}
          </option>
        ))}
      </Select>
      <Button
        variant="secondary"
        size="icon"
        className="size-7 shrink-0"
        onClick={openAddWordRomanizationDialog}
        aria-label="新增逐字音译语言"
      >
        <Plus className="size-4" />
      </Button>
    </div>
  );
};
