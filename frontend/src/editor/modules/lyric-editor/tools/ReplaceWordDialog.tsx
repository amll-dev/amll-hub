import { useAtom, useAtomValue } from 'jotai';
import { useSetImmerAtom } from 'jotai-immer';
import { memo, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { replaceWordDialogAtom } from '$/states/dialogs';
import { editingWordStateAtom, lyricLinesAtom } from '$/states/main';

export const ReplaceWordDialog = memo(() => {
  const [isOpen, setIsOpen] = useAtom(replaceWordDialogAtom);
  const editingState = useAtomValue(editingWordStateAtom);
  const editLyricLines = useSetImmerAtom(lyricLinesAtom);

  const [replacementText, setReplacementText] = useState('');
  const [applyToAll, setApplyToAll] = useState(false);
  const [ignoreCase, setIgnoreCase] = useState(true);

  useEffect(() => {
    if (isOpen) {
      setReplacementText(editingState.word);
      setApplyToAll(false);
      setIgnoreCase(true);
    }
  }, [isOpen, editingState.word]);

  const handleConfirm = () => {
    const targetWord = editingState.word;
    const newWord = replacementText;

    if (targetWord === newWord) {
      setIsOpen(false);
      return;
    }

    editLyricLines((state) => {
      if (applyToAll) {
        const targetLower = targetWord.toLowerCase();
        for (const line of state.lyricLines) {
          for (const word of line.words) {
            const isMatch = ignoreCase
              ? word.word.toLowerCase() === targetLower
              : word.word === targetWord;

            if (isMatch) {
              word.word = newWord;
            }
          }
        }
      } else {
        const line = state.lyricLines[editingState.lineIndex];
        if (line) {
          const word = line.words[editingState.wordIndex];
          if (word && word.word === targetWord) {
            word.word = newWord;
          }
        }
      }
    });
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-[400px]">
        <DialogTitle>替换单词</DialogTitle>
        <DialogDescription>新的单词内容:</DialogDescription>

        <div className="flex flex-col gap-3">
          <Input
            value={replacementText}
            onChange={(e) => setReplacementText(e.target.value)}
            placeholder="新单词"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirm();
            }}
            autoFocus
          />

          <div className="flex flex-col gap-2">
            <Label className="font-normal">
              <Checkbox checked={applyToAll} onCheckedChange={(c) => setApplyToAll(Boolean(c))} />
              将替换应用于所有相同的单词
            </Label>

            <Label
              className="font-normal"
              style={{
                opacity: applyToAll ? 1 : 0.5,
                pointerEvents: applyToAll ? 'auto' : 'none',
              }}
            >
              <Checkbox
                checked={ignoreCase}
                onCheckedChange={(c) => setIgnoreCase(Boolean(c))}
                disabled={!applyToAll}
              />
              忽略大小写
            </Label>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">取消</Button>
          </DialogClose>
          <Button onClick={handleConfirm}>确认</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
