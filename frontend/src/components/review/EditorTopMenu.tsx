import { atom, useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { useSetImmerAtom } from 'jotai-immer';
import { type ComponentProps, useCallback } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { segmentLyricLines } from '$/modules/segmentation/utils/segmentation';
import { useSegmentationConfig } from '$/modules/segmentation/utils/useSegmentationConfig';
import {
  advancedSegmentationDialogAtom,
  confirmDialogAtom,
  reduceStutterDialogAtom,
  timeShiftDialogAtom,
} from '$/states/dialogs.ts';
import {
  keyRedoAtom,
  keySelectAllAtom,
  keySelectInvertedAtom,
  keyUndoAtom,
  keyUnselectAllAtom,
} from '$/states/keybindings.ts';
import {
  lyricLinesAtom,
  redoLyricLinesAtom,
  selectedLinesAtom,
  undoableLyricLinesAtom,
  undoLyricLinesAtom,
} from '$/states/main.ts';
import { formatKeyBindings } from '$/utils/keybindings.ts';
const canUndoAtom = atom((get) => get(undoableLyricLinesAtom).canUndo);
const canRedoAtom = atom((get) => get(undoableLyricLinesAtom).canRedo);

/** 触发器按钮的统一样式 */
const triggerClass =
  'rounded px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink';

/** 菜单项：在右侧展示快捷键 */
function MenuItem({
  shortcut,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuItem> & { shortcut?: string }) {
  return (
    <DropdownMenuItem {...props}>
      {children}
      {shortcut ? (
        <span className="ml-auto pl-4 font-mono text-xs text-ink-3">{shortcut}</span>
      ) : null}
    </DropdownMenuItem>
  );
}

function EditMenu() {
  const store = useStore();
  const setUndo = useSetAtom(undoLyricLinesAtom);
  const setRedo = useSetAtom(redoLyricLinesAtom);

  const [undoKey] = useAtom(keyUndoAtom);
  const [redoKey] = useAtom(keyRedoAtom);
  const [selectAllKey] = useAtom(keySelectAllAtom);
  const [unselectAllKey] = useAtom(keyUnselectAllAtom);
  const [invertKey] = useAtom(keySelectInvertedAtom);

  const undoDisabled = !useAtomValue(canUndoAtom);
  const redoDisabled = !useAtomValue(canRedoAtom);

  const onSelectAll = useCallback(() => {
    const lines = store.get(lyricLinesAtom).lyricLines;
    store.set(selectedLinesAtom, new Set(lines.map((l) => l.id)));
  }, [store]);

  const onUnselectAll = useCallback(() => {
    store.set(selectedLinesAtom, new Set());
  }, [store]);

  const onInvert = useCallback(() => {
    const selected = store.get(selectedLinesAtom);
    const lines = store.get(lyricLinesAtom).lyricLines;
    store.set(
      selectedLinesAtom,
      new Set(lines.filter((l) => !selected.has(l.id)).map((l) => l.id))
    );
  }, [store]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={triggerClass}>
          编辑
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <MenuItem
          onSelect={() => setUndo()}
          shortcut={formatKeyBindings(undoKey)}
          disabled={undoDisabled}
        >
          撤销
        </MenuItem>
        <MenuItem
          onSelect={() => setRedo()}
          shortcut={formatKeyBindings(redoKey)}
          disabled={redoDisabled}
        >
          重做
        </MenuItem>
        <DropdownMenuSeparator />
        <MenuItem onSelect={onSelectAll} shortcut={formatKeyBindings(selectAllKey)}>
          选中所有歌词行
        </MenuItem>
        <MenuItem onSelect={onUnselectAll} shortcut={formatKeyBindings(unselectAllKey)}>
          取消选中所有歌词行
        </MenuItem>
        <MenuItem onSelect={onInvert} shortcut={formatKeyBindings(invertKey)}>
          反选所有歌词行
        </MenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* 工具 */

function ToolMenu() {
  const editLyricLines = useSetImmerAtom(lyricLinesAtom);
  const { config: segmentationConfig } = useSegmentationConfig();
  const [, setConfirmDialog] = useAtom(confirmDialogAtom);
  const setTimeShiftDialog = useSetAtom(timeShiftDialogAtom);
  const setAdvancedSegmentation = useSetAtom(advancedSegmentationDialogAtom);
  const setReduceStutter = useSetAtom(reduceStutterDialogAtom);
  const onAutoSegment = useCallback(() => {
    editLyricLines((draft) => {
      draft.lyricLines = segmentLyricLines(draft.lyricLines, segmentationConfig);
    });
  }, [editLyricLines, segmentationConfig]);

  const onSyncLineTimestamps = useCallback(() => {
    const action = () => {
      editLyricLines((draft) => {
        for (let i = 0; i < draft.lyricLines.length; i++) {
          const line = draft.lyricLines[i];
          if (!line || line.words.length === 0) continue;

          const firstWord = line.words[0];
          const lastWord = line.words[line.words.length - 1];
          if (!firstWord || !lastWord) continue;

          let startTime = firstWord.startTime;
          let endTime = lastWord.endTime;

          const nextLine = draft.lyricLines[i + 1];
          if (nextLine?.isBG && nextLine.words.length > 0) {
            const nextLineStart = nextLine.words[0]?.startTime;
            const nextLineEnd = nextLine.words[nextLine.words.length - 1]?.endTime;
            if (nextLineStart !== undefined && nextLineEnd !== undefined) {
              startTime = Math.min(startTime, nextLineStart);
              endTime = Math.max(endTime, nextLineEnd);
            }
          }

          line.startTime = startTime;
          line.endTime = endTime;
        }
      });
    };

    setConfirmDialog({
      open: true,
      title: '确认同步行时间戳',
      description:
        '此操作将根据每行单词的时间戳自动同步所有行的起始和结束时间为第一个和最后一个音节的开始和结束时间。确定要继续吗？',
      onConfirm: action,
    });
  }, [editLyricLines, setConfirmDialog]);

  const onReduceStutter = useCallback(() => {
    setReduceStutter({ open: true });
  }, [setReduceStutter]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={triggerClass}>
          工具
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>分词</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={onAutoSegment}>自动分词</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setAdvancedSegmentation(true)}>
              高级分词...
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>时间戳</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={onSyncLineTimestamps}>同步行时间戳</DropdownMenuItem>
            <DropdownMenuItem onSelect={onReduceStutter}>消减卡顿</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTimeShiftDialog(true)}>
              平移时间...
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* 组合 */
export function EditorMenuBar() {
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-l border-border pl-2">
      <EditMenu />
      <ToolMenu />
    </div>
  );
}
