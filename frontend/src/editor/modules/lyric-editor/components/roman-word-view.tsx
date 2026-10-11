import { type Atom, useAtom, useAtomValue, type WritableAtom } from 'jotai';
import { useSetImmerAtom } from 'jotai-immer';
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { lyricLinesAtom } from '$/states/main';
import type { LyricWord } from '$/types/ttml';
import { applyGeneratedRuby } from '$/modules/lyric-editor/utils/ruby-generator';

interface RomanWordViewProps {
  wordAtom: Atom<LyricWord>;
  wordIndex: number;
  editingIndexAtom: WritableAtom<number | null, [number | null], void>;
  suggestedRoman?: string;
}

export const RomanWordView = ({
  wordAtom,
  wordIndex,
  editingIndexAtom,
  suggestedRoman,
}: RomanWordViewProps) => {
  const word = useAtomValue(wordAtom);
  const [editingIndex, setEditingIndex] = useAtom(editingIndexAtom);
  const editLyricLines = useSetImmerAtom(lyricLinesAtom);
  const [inputValue, setInputValue] = useState(word.romanWord);
  const inputRef = useRef<HTMLInputElement>(null);

  const isEditing = editingIndex === wordIndex;

  const saveAndStopEditing = useCallback(
    (newValue: string) => {
      if (newValue !== word.romanWord) {
        editLyricLines((draft) => {
          for (const line of draft.lyricLines) {
            const targetWord = line.words.find((w) => w.id === word.id);
            if (targetWord) {
              targetWord.romanWord = newValue;
              // Only sync generated ruby when this word has ruby editing enabled.
              if (targetWord.ruby !== undefined) {
                applyGeneratedRuby(targetWord);
              }
              break;
            }
          }
        });
      }
      setEditingIndex(null);
    },
    [word.id, word.romanWord, editLyricLines, setEditingIndex]
  );

  useEffect(() => {
    if (isEditing) {
      setInputValue(word.romanWord || suggestedRoman || '');
    }
  }, [isEditing, word.romanWord, suggestedRoman]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value;
    switch (e.key) {
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        saveAndStopEditing(value);
        setEditingIndex(wordIndex + 1);
        break;
      case 'Escape':
        e.preventDefault();
        setEditingIndex(null);
        break;
      case 'Backspace':
        if (value === '') {
          e.preventDefault();
          saveAndStopEditing('');
          setEditingIndex(wordIndex - 1);
        }
        break;
      default:
        break;
    }
  };

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        className={cn(
          'inline-block h-auto w-auto px-2 py-1 text-left text-xs',
          word.romanWarning && 'border-warning bg-warning/10'
        )}
        value={inputValue}
        onChange={(e) => setInputValue(e.currentTarget.value)}
        onBlur={(e) => saveAndStopEditing(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
    );
  }

  return (
    <Button
      variant="secondary"
      className={cn(
        'inline-block h-auto w-auto px-2 py-1 text-left text-xs font-normal',
        !word.romanWord && 'italic text-ink-3',
        word.romanWarning && 'border border-warning bg-warning/10'
      )}
      onClick={(e) => {
        e.stopPropagation();
        setEditingIndex(wordIndex);
      }}
    >
      {word.romanWord || ''}
    </Button>
  );
};
