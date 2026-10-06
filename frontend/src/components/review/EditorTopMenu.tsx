import { DropdownMenu } from '@radix-ui/themes';
import { atom, useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { useSetImmerAtom } from 'jotai-immer';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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

function EditMenu() {
  const { t } = useTranslation();
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
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <button type="button" className={triggerClass}>
          {t('topBar.menu.edit', '编辑')}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item
          onSelect={() => setUndo()}
          shortcut={formatKeyBindings(undoKey)}
          disabled={undoDisabled}
        >
          {t('topBar.menu.undo', '撤销')}
        </DropdownMenu.Item>
        <DropdownMenu.Item
          onSelect={() => setRedo()}
          shortcut={formatKeyBindings(redoKey)}
          disabled={redoDisabled}
        >
          {t('topBar.menu.redo', '重做')}
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item onSelect={onSelectAll} shortcut={formatKeyBindings(selectAllKey)}>
          {t('topBar.menu.selectAllLines', '选中所有歌词行')}
        </DropdownMenu.Item>
        <DropdownMenu.Item onSelect={onUnselectAll} shortcut={formatKeyBindings(unselectAllKey)}>
          {t('topBar.menu.unselectAllLines', '取消选中所有歌词行')}
        </DropdownMenu.Item>
        <DropdownMenu.Item onSelect={onInvert} shortcut={formatKeyBindings(invertKey)}>
          {t('topBar.menu.invertSelectAllLines', '反选所有歌词行')}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

/* 工具 */

function ToolMenu() {
  const { t } = useTranslation();
  const store = useStore();
  const editLyricLines = useSetImmerAtom(lyricLinesAtom);
  const { config: segmentationConfig } = useSegmentationConfig();
  const [, setConfirmDialog] = useAtom(confirmDialogAtom);
  const setTimeShiftDialog = useSetAtom(timeShiftDialogAtom);
  const setAdvancedSegmentation = useSetAtom(advancedSegmentationDialogAtom);
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
          if (line.words.length === 0) continue;

          let startTime = line.words[0].startTime;
          let endTime = line.words[line.words.length - 1].endTime;

          if (i + 1 < draft.lyricLines.length) {
            const nextLine = draft.lyricLines[i + 1];
            if (nextLine.isBG && nextLine.words.length > 0) {
              const nextLineStart = nextLine.words[0].startTime;
              const nextLineEnd = nextLine.words[nextLine.words.length - 1].endTime;
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
      title: t('confirmDialog.syncLineTimestamps.title', '确认同步行时间戳'),
      description: t(
        'confirmDialog.syncLineTimestamps.description',
        '此操作将根据每行单词的时间戳自动同步所有行的起始和结束时间为第一个和最后一个音节的开始和结束时间。确定要继续吗？'
      ),
      onConfirm: action,
    });
  }, [editLyricLines, setConfirmDialog, t]);

  const onReduceStutter = useCallback(() => {
    store.set(reduceStutterDialogAtom, { open: true });
  }, [store]);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <button type="button" className={triggerClass}>
          {t('topBar.menu.tool', '工具')}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger>
            {t('topBar.menu.segmentationTools', '分词')}
          </DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent>
            <DropdownMenu.Item onSelect={onAutoSegment}>
              {t('topBar.menu.autoSegment', '自动分词')}
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => setAdvancedSegmentation(true)}>
              {t('topBar.menu.advancedSegment', '高级分词...')}
            </DropdownMenu.Item>
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger>
            {t('topBar.menu.timestampTools.index', '时间戳')}
          </DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent>
            <DropdownMenu.Item onSelect={onSyncLineTimestamps}>
              {t('topBar.menu.timestampTools.syncLineTimestamps', '同步行时间戳')}
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={onReduceStutter}>
              {t('topBar.menu.timestampTools.reduceStutter', '消减卡顿')}
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => setTimeShiftDialog(true)}>
              {t('topBar.menu.timeShift', '平移时间...')}
            </DropdownMenu.Item>
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
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
