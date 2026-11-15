import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { autoSaveProject } from '$/modules/project/autosave/autosave';
import {
  autosaveEnabledAtom,
  autosaveIntervalAtom,
  autosaveLimitAtom,
} from '$/modules/settings/states';
import {
  isDirtyAtom,
  lastSavedTimeAtom,
  lyricLinesAtom,
  projectIdAtom,
  SaveStatus,
  saveStatusAtom,
} from '$/states/main';
import { projectLogger } from '../logger';

/** 两次写盘之间的最小间隔。历史版本间隔仍由 autosaveIntervalAtom 单独控制。 */
const SAVE_TICK_MS = 3000;

export const AutosaveManager = () => {
  const lyricLines = useAtomValue(lyricLinesAtom);
  const isDirty = useAtomValue(isDirtyAtom);
  const enabled = useAtomValue(autosaveEnabledAtom);
  const limit = useAtomValue(autosaveLimitAtom);
  const intervalMinutes = useAtomValue(autosaveIntervalAtom);
  const projectId = useAtomValue(projectIdAtom);

  const setSaveStatus = useSetAtom(saveStatusAtom);
  const setLastSavedTime = useSetAtom(lastSavedTimeAtom);

  // 定时器只在 isDirty / enabled 变化时重启，绝不随 lyricLines 变化重置。
  // 否则就是尾部防抖：只要编辑间隔小于 3 秒，latestState 永远不会被写入。
  const latestRef = useRef({ lyricLines, projectId, limit, intervalMinutes });
  const savedLinesRef = useRef<typeof lyricLines | null>(null);

  useEffect(() => {
    latestRef.current = { lyricLines, projectId, limit, intervalMinutes };
    if (
      enabled &&
      isDirty &&
      lyricLines.lyricLines.length > 0 &&
      lyricLines !== savedLinesRef.current
    ) {
      setSaveStatus(SaveStatus.Pending);
    }
  });

  useEffect(() => {
    if (!enabled) return;
    if (!isDirty) {
      setSaveStatus(SaveStatus.Saved);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const schedule = () => {
      if (cancelled) return;
      timer = window.setTimeout(tick, SAVE_TICK_MS);
    };

    const tick = async () => {
      if (cancelled) return;
      const current = latestRef.current;
      const lines = current.lyricLines;

      // 空歌词或内容没变就跳过这一拍，但继续轮询，后续编辑仍能落盘。
      if (lines.lyricLines.length === 0 || lines === savedLinesRef.current) {
        schedule();
        return;
      }

      setSaveStatus(SaveStatus.Saving);
      projectLogger.info('Auto-saving project...', current.projectId);
      try {
        await autoSaveProject(
          current.projectId,
          lines,
          current.limit,
          current.intervalMinutes * 60 * 1000
        );
        savedLinesRef.current = lines;
        setSaveStatus(SaveStatus.Saved);
        setLastSavedTime(Date.now());
      } catch (err) {
        projectLogger.error('Failed to autosave project', err);
        setSaveStatus(SaveStatus.Pending);
      }
      // 保存失败不推进 savedLinesRef，下一拍会重试。
      schedule();
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [isDirty, enabled, setSaveStatus, setLastSavedTime]);

  return null;
};
