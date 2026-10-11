import type { Draft } from 'immer';
import { type Atom, useAtomValue, useStore } from 'jotai';
import { useSetImmerAtom } from 'jotai-immer';
import { Languages, Plus } from 'lucide-react';
import { type ComponentPropsWithoutRef, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { recalculateWordTime } from '$/modules/segmentation/utils/segmentation.ts';
import { useSegmentationConfig } from '$/modules/segmentation/utils/useSegmentationConfig.ts';
import { lyricLinesAtom } from '$/states/main.ts';
import type { LyricWord, TTMLLyric } from '$/types/ttml.ts';
import styles from '../components/index.module.css';

const AutoSizeTextField = ({
  value,
  className,
  style,
  placeholder,
  inputRef,
  ...rest
}: ComponentPropsWithoutRef<'input'> & {
  inputRef?: React.Ref<HTMLInputElement>;
}) => {
  const valueString = value === undefined || value === null ? '' : String(value);
  const mirrorText =
    valueString.length > 0
      ? valueString
      : typeof placeholder === 'string' && placeholder.length > 0
        ? placeholder
        : '    ';
  return (
    <span className={cn(styles.autoSizeInput, className)} style={style}>
      <span className={styles.autoSizeInputText}>{mirrorText}</span>
      <Input
        className={styles.autoSizeInputField}
        value={value}
        placeholder={placeholder}
        ref={inputRef}
        {...rest}
      />
    </span>
  );
};

export const RubyEditor = ({
  wordAtom,
  forceShow,
  showIcon,
  className,
}: {
  wordAtom: Atom<LyricWord>;
  forceShow?: boolean;
  showIcon?: boolean;
  className?: string;
}) => {
  const word = useAtomValue(wordAtom);
  const editLyricLines = useSetImmerAtom(lyricLinesAtom);
  const store = useStore();
  const rubyWords = word.ruby ?? [];
  const { config: segmentationConfig } = useSegmentationConfig();
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const addRubyWord = useCallback(() => {
    const currentWord = store.get(wordAtom);
    const nextIndex = currentWord.ruby?.length ?? 0;
    editLyricLines((state: Draft<TTMLLyric>) => {
      for (const line of state.lyricLines) {
        for (const word of line.words) {
          if (word.id !== currentWord.id) continue;
          if (!word.ruby) word.ruby = [];
          word.ruby.push({
            word: '',
            startTime: word.startTime,
            endTime: word.endTime,
          });
          break;
        }
      }
    });
    requestAnimationFrame(() => {
      inputRefs.current[nextIndex]?.focus();
    });
  }, [editLyricLines, store, wordAtom]);

  const updateRubyWord = useCallback(
    (index: number, value: string) => {
      const currentWord = store.get(wordAtom);
      editLyricLines((state: Draft<TTMLLyric>) => {
        for (const line of state.lyricLines) {
          for (const word of line.words) {
            if (word.id !== currentWord.id) continue;
            if (!word.ruby || !word.ruby[index]) return;
            word.ruby[index].word = value;
            break;
          }
        }
      });
    },
    [editLyricLines, store, wordAtom]
  );

  const removeRubyWord = useCallback(
    (index: number) => {
      const currentWord = store.get(wordAtom);
      editLyricLines((state: Draft<TTMLLyric>) => {
        for (const line of state.lyricLines) {
          for (const word of line.words) {
            if (word.id !== currentWord.id) continue;
            if (!word.ruby || !word.ruby[index]) return;
            word.ruby.splice(index, 1);
            break;
          }
        }
      });
    },
    [editLyricLines, store, wordAtom]
  );

  const mergeRubyWithPrevious = useCallback(
    (index: number) => {
      const currentWord = store.get(wordAtom);
      const prevText = currentWord.ruby?.[index - 1]?.word ?? '';
      const currentText = currentWord.ruby?.[index]?.word ?? '';
      const mergedText = `${prevText}${currentText}`;

      editLyricLines((state: Draft<TTMLLyric>) => {
        for (const line of state.lyricLines) {
          for (const word of line.words) {
            if (word.id !== currentWord.id) continue;
            if (!word.ruby || !word.ruby[index] || !word.ruby[index - 1]) return;
            const prevRuby = word.ruby[index - 1]!;
            const currentRuby = word.ruby[index]!;
            prevRuby.word = mergedText;
            prevRuby.startTime = Math.min(prevRuby.startTime, currentRuby.startTime);
            prevRuby.endTime = Math.max(prevRuby.endTime, currentRuby.endTime);
            word.ruby.splice(index, 1);
            break;
          }
        }
      });

      requestAnimationFrame(() => {
        const target = inputRefs.current[index - 1];
        if (target) {
          target.focus();
          target.setSelectionRange(mergedText.length, mergedText.length);
        }
      });
    },
    [editLyricLines, store, wordAtom]
  );

  const applyRubyToAllSameWords = useCallback(() => {
    const currentWord = store.get(wordAtom);
    const rubySegments = currentWord.ruby?.map((ruby) => ruby.word) ?? [];
    if (rubySegments.length === 0) return;

    editLyricLines((state: Draft<TTMLLyric>) => {
      for (const line of state.lyricLines) {
        for (const word of line.words) {
          if (word.word !== currentWord.word) continue;
          const recalculated = recalculateWordTime(word, rubySegments, segmentationConfig);
          word.ruby = recalculated.map((segment) => ({
            word: segment.word,
            startTime: segment.startTime,
            endTime: segment.endTime,
          }));
        }
      }
    });
  }, [editLyricLines, segmentationConfig, store, wordAtom]);

  if (!forceShow && rubyWords.length === 0) return null;

  return (
    <span className={cn(styles.rubyEditor, className)}>
      {showIcon && (
        <Button
          variant="secondary"
          size="icon"
          className="size-7 shrink-0"
          onClick={applyRubyToAllSameWords}
          title="应用到所有相同单词"
        >
          <Languages className="size-4" />
        </Button>
      )}
      {rubyWords.map((rubyWord, index) => (
        <AutoSizeTextField
          key={`${word.id}-ruby-${index}`}
          inputRef={(el) => {
            inputRefs.current[index] = el;
          }}
          value={rubyWord.word}
          onChange={(evt) => updateRubyWord(index, evt.currentTarget.value)}
          onKeyDown={(evt) => {
            if (evt.key !== 'Backspace') return;
            const selectionStart = evt.currentTarget.selectionStart ?? 0;
            const selectionEnd = evt.currentTarget.selectionEnd ?? 0;
            const isAtStart = selectionStart === 0 && selectionEnd === 0;
            if (isAtStart && index > 0) {
              evt.preventDefault();
              mergeRubyWithPrevious(index);
              return;
            }
            if (evt.currentTarget.value !== '') return;
            evt.preventDefault();
            removeRubyWord(index);
            if (index > 0) {
              requestAnimationFrame(() => {
                inputRefs.current[index - 1]?.focus();
              });
            }
          }}
        />
      ))}
      <Button
        variant="secondary"
        size="icon"
        className="size-7 shrink-0"
        onClick={addRubyWord}
        title="添加注音"
      >
        <Plus className="size-4" />
      </Button>
    </span>
  );
};
