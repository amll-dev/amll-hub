import { Theme } from '@radix-ui/themes';
import { AnimatePresence, motion } from 'framer-motion';
import { useAtomValue, useSetAtom } from 'jotai';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import RibbonBar from '@/editor/components/RibbonBar';
import Sidebar from '@/editor/components/Sidebar/index.tsx';
import SuspensePlaceHolder from '@/editor/components/SuspensePlaceHolder';
import { DragGhostRenderer } from '@/editor/modules/lyric-drag/DragGhostRenderer.tsx';
import { SyncKeyBinding } from '@/editor/modules/lyric-editor/components/sync-keybinding.tsx';
import { TouchSyncPanel } from '@/editor/modules/lyric-editor/components/TouchSyncPanel/index.tsx';
import { AutosaveManager } from '@/editor/modules/project/autosave/AutosaveManager.tsx';
import { showTouchSyncPanelAtom } from '@/editor/modules/settings/states/sync.ts';
import { ToolMode, toolModeAtom } from '@/editor/states/main.ts';
import { MetadataEditor } from '@/editor/modules/project/modals/MetadataEditor.tsx';
import { useMediaSession } from '@/editor/modules/audio/hooks/useMediaSession.ts';
import { useAudioFeedback } from '@/editor/modules/audio/hooks/useAudioFeedback.ts';
import { resolvedThemeAtom } from '@/atoms/theme';
import '@/editor/i18n';
import '@radix-ui/themes/styles.css';
import './editor-theme.css';

const LyricLinesView = lazy(() => import('@/editor/modules/lyric-editor/components'));
const AudioControls = lazy(() => import('@/editor/modules/audio/components/index.tsx'));

export function EditorWorkbench() {
  const toolMode = useAtomValue(toolModeAtom);
  const showTouchSyncPanel = useAtomValue(showTouchSyncPanelAtom);
  const setToolMode = useSetAtom(toolModeAtom);

  // 媒体控制中心
  useMediaSession();
  // 播放时的视觉/触觉反馈
  useAudioFeedback();
  useEffect(() => {
    if (toolMode === ToolMode.Preview) {
      setToolMode(ToolMode.Edit);
    }
  }, [setToolMode, toolMode]);

  useEffect(() => {
    document.body.classList.add('editor-body');
    return () => document.body.classList.remove('editor-body');
  }, []);

  return (
    <EditorTheme>
      <AutosaveManager />
      {toolMode === ToolMode.Sync && <SyncKeyBinding />}
      <div
        className="flex h-full flex-col overflow-hidden"
        style={{ background: 'var(--color-panel)' }}
      >
        <RibbonBar />

        <div className="mt-2 flex min-h-0 flex-1 flex-row overflow-hidden">
          <Sidebar />

          <div className="min-w-0 flex-1 overflow-hidden">
            <AnimatePresence mode="wait">
              <SuspensePlaceHolder key="edit">
                <motion.div
                  layout="position"
                  style={{ height: '100%', maxHeight: '100%', overflowY: 'hidden' }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <LyricLinesView key="edit" />
                </motion.div>
              </SuspensePlaceHolder>
            </AnimatePresence>
          </div>
        </div>

        {showTouchSyncPanel && toolMode === ToolMode.Sync && <TouchSyncPanel />}

        <AnimatePresence initial={false}>
          <motion.div
            key="audio-controls"
            style={{ flexShrink: 0, overflow: 'hidden' }}
            initial={{ height: 0, opacity: 0, y: 20 }}
            animate={{ height: 'auto', opacity: 1, y: 0 }}
            exit={{ height: 0, opacity: 0, y: 20 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            data-audio-controls
          >
            <Suspense fallback={null}>
              <AudioControls />
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </div>

      <DragGhostRenderer />
      <MetadataEditor />
    </EditorTheme>
  );
}

/**
 * 编辑器的 Radix Theme 根。
 *
 * 导出让 `LyricEditorPage` 能把它提到页面顶层，从而把顶栏也包进来 ——
 * 否则顶栏右侧的 `EditorMenuBar`（Radix `DropdownMenu`）在 Theme 外，
 * 样式会和工具栏里的其他 Radix 组件不一致。
 */
export function EditorTheme({ children }: { children: ReactNode }) {
  const resolvedTheme = useAtomValue(resolvedThemeAtom);
  const isDark = resolvedTheme === 'dark';

  return (
    <Theme
      className="editor-radix-theme"
      appearance={isDark ? 'dark' : 'light'}
      panelBackground="solid"
      accentColor={isDark ? 'jade' : 'green'}
      grayColor="slate"
      radius="medium"
      scaling="100%"
    >
      {children}
    </Theme>
  );
}
