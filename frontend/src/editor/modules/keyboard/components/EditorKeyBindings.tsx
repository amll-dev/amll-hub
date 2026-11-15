import { useSetAtom, useStore } from 'jotai';
import { useSetImmerAtom } from 'jotai-immer';
import { type ChangeEvent, useCallback, useRef } from 'react';
import { uid } from 'uid';
import { useFileOpener } from '$/hooks/useFileOpener.ts';
import {
  cmdDeleteSelection,
  cmdNewFile,
  cmdOpenAudio,
  cmdOpenFile,
  cmdRedo,
  cmdSaveFile,
  cmdSelectAll,
  cmdSelectInverted,
  cmdSwitchEditMode,
  cmdSwitchSyncMode,
  cmdUndo,
  cmdUnselectAll,
} from '$/modules/keyboard/commands';
import { useCommand } from '$/modules/keyboard/hooks';
import { confirmDialogAtom } from '$/states/dialogs.ts';
import {
  isDirtyAtom,
  lyricLinesAtom,
  newLyricLinesAtom,
  projectIdAtom,
  redoLyricLinesAtom,
  saveFileNameAtom,
  selectedLinesAtom,
  selectedWordsAtom,
  sourceFileContentAtom,
  ToolMode,
  toolModeAtom,
  undoLyricLinesAtom,
} from '$/states/main.ts';

const LYRIC_ACCEPT = '.ttml,.lrc,.eslrc,.qrc,.yrc,.lys';
const AUDIO_ACCEPT = 'audio/*,.flac,.ape,.wav,.m4a,.mp3,.ogg,.opus,.aac,.dsf';

/**
 * 编辑器常驻快捷键接线。
 *
 * commands.ts 的 registerCommand 只是把命令登记进 Map，真正挂全局 keydown 监听
 * 的是 useCommand。缺了这一层：菜单上印着 Ctrl+Z / Ctrl+A 却按了没反应，
 * Ctrl+S 还会因为没有回调命中而直接弹浏览器的「网页另存为」。
 *
 * 未接线的命令及原因：
 * - switchPreviewMode：EditorWorkbench 会把 Preview 强制回退到 Edit，接了也是假动作。
 * - selectWordsOfMatchedSelection：尚无对应的编辑器动作可复用。
 * - syncNextAlt：与已接线的 syncNext 同义，替代键位留给打轴模块统一处理。
 */
export const EditorKeyBindings = ({ textOnly = false }: { textOnly?: boolean }) => {
  const store = useStore();
  const editLyricLines = useSetImmerAtom(lyricLinesAtom);
  const setToolMode = useSetAtom(toolModeAtom);
  const { openFile } = useFileOpener();
  const lyricInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const onUndo = useCallback(() => {
    store.set(undoLyricLinesAtom);
  }, [store]);

  const onRedo = useCallback(() => {
    store.set(redoLyricLinesAtom);
  }, [store]);

  const onSelectAll = useCallback(() => {
    const lines = store.get(lyricLinesAtom).lyricLines;
    store.set(selectedLinesAtom, new Set(lines.map((line) => line.id)));
  }, [store]);

  const onUnselectAll = useCallback(() => {
    store.set(selectedLinesAtom, new Set());
    store.set(selectedWordsAtom, new Set());
  }, [store]);

  const onSelectInverted = useCallback(() => {
    const selected = store.get(selectedLinesAtom);
    const lines = store.get(lyricLinesAtom).lyricLines;
    store.set(
      selectedLinesAtom,
      new Set(lines.filter((line) => !selected.has(line.id)).map((line) => line.id))
    );
  }, [store]);

  const onDeleteSelection = useCallback(() => {
    const selectedLines = store.get(selectedLinesAtom);
    const selectedWords = store.get(selectedWordsAtom);
    if (selectedLines.size === 0 && selectedWords.size === 0) return;

    editLyricLines((state) => {
      if (selectedWords.size > 0) {
        for (const line of state.lyricLines) {
          line.words = line.words.filter((word) => !selectedWords.has(word.id));
        }
      } else {
        state.lyricLines = state.lyricLines.filter((line) => !selectedLines.has(line.id));
      }
    });
    store.set(selectedLinesAtom, new Set());
    store.set(selectedWordsAtom, new Set());
  }, [store, editLyricLines]);

  const onSwitchEditMode = useCallback(() => {
    setToolMode(ToolMode.Edit);
  }, [setToolMode]);

  const onSwitchSyncMode = useCallback(() => {
    // 无参考音频时 EditorWorkbench 会强制回退，这里不制造一次无意义的闪切。
    if (!textOnly) setToolMode(ToolMode.Sync);
  }, [textOnly, setToolMode]);

  const onSaveFile = useCallback(() => {
    // 顶栏的「提交审核结果 / 提交修改」按钮；禁用中时 click() 自然不会生效。
    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
  }, []);

  const resetProject = useCallback(() => {
    store.set(newLyricLinesAtom, { lyricLines: [], metadata: [], agents: [] });
    // 换了项目身份，否则后续自动保存会覆盖掉旧项目的最新状态。
    store.set(projectIdAtom, uid());
    store.set(saveFileNameAtom, 'lyric.ttml');
    store.set(sourceFileContentAtom, null);
  }, [store]);

  const onNewFile = useCallback(() => {
    if (!store.get(isDirtyAtom)) {
      resetProject();
      return;
    }
    store.set(confirmDialogAtom, {
      open: true,
      title: '确认新建文件',
      description: '当前文件有未保存的更改。新建后会清空编辑器内容，确定要继续吗？',
      onConfirm: resetProject,
    });
  }, [store, resetProject]);

  const onOpenFile = useCallback(() => lyricInputRef.current?.click(), []);
  const onOpenAudio = useCallback(() => {
    if (!textOnly) audioInputRef.current?.click();
  }, [textOnly]);

  const onFilePicked = useCallback(
    (evt: ChangeEvent<HTMLInputElement>) => {
      const input = evt.currentTarget;
      const file = input.files?.[0];
      // 允许连续选同一个文件；并把焦点还回去，否则全局快捷键会被 isEditing()
      // 判定成输入态而全部失效。
      input.value = '';
      input.blur();
      if (file) openFile(file);
    },
    [openFile]
  );

  useCommand(cmdUndo, onUndo);
  useCommand(cmdRedo, onRedo);
  useCommand(cmdSelectAll, onSelectAll);
  useCommand(cmdUnselectAll, onUnselectAll);
  useCommand(cmdSelectInverted, onSelectInverted);
  useCommand(cmdDeleteSelection, onDeleteSelection);
  useCommand(cmdSwitchEditMode, onSwitchEditMode);
  useCommand(cmdSwitchSyncMode, onSwitchSyncMode);
  useCommand(cmdSaveFile, onSaveFile);
  useCommand(cmdNewFile, onNewFile);
  useCommand(cmdOpenFile, onOpenFile);
  useCommand(cmdOpenAudio, onOpenAudio);

  return (
    <>
      <input
        ref={lyricInputRef}
        type="file"
        className="hidden"
        accept={LYRIC_ACCEPT}
        onChange={onFilePicked}
        aria-hidden="true"
        tabIndex={-1}
      />
      <input
        ref={audioInputRef}
        type="file"
        className="hidden"
        accept={AUDIO_ACCEPT}
        onChange={onFilePicked}
        aria-hidden="true"
        tabIndex={-1}
      />
    </>
  );
};
