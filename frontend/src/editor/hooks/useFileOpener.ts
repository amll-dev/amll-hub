/**
 * @description 处理打开文件的逻辑
 */

import {
  type LyricLine,
  parseEslrc,
  parseLys,
  parseQrc,
  parseYrc,
} from '@applemusic-like-lyrics/lyric';
import { openDB } from 'idb';
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { uid } from 'uid';
import { audioEngine } from '$/modules/audio/audio-engine';
import { getProjectList } from '$/modules/project/autosave/autosave';
import { applyDefaultTtmlAuthorMetadata } from '$/modules/project/logic/default-metadata';
import { getSuggestedTtmlFileName } from '$/modules/project/logic/metadata-filename';
import { isProjectMatch } from '$/modules/project/logic/project-match';
import {
  defaultTtmlAuthorGithubAtom,
  defaultTtmlAuthorGithubLoginAtom,
} from '$/modules/settings/states';
import { parseTTMLLyric } from '$/modules/ttml-processor';
import { useTtmlErrorHandler } from '$/modules/ttml-processor/useTtmlErrorHandler';
import { confirmDialogAtom } from '$/states/dialogs.ts';
import {
  fileUpdateSessionAtom,
  isDirtyAtom,
  lyricLinesAtom,
  newLyricLinesAtom,
  projectIdAtom,
  saveFileNameAtom,
  sourceFileContentAtom,
} from '$/states/main.ts';
import { pushNotificationAtom } from '$/states/notifications';
import type { TTMLLyric, TTMLMetadata } from '$/types/ttml';
import { createLogger } from '$/utils/logger';
import { parseLrc } from '$/utils/parse-lrc';

const fileOpenerLogger = createLogger('FileOpener');

const LYRIC_PARSERS: Record<string, (text: string) => LyricLine[]> = {
  lrc: parseLrc,
  eslrc: parseEslrc,
  qrc: parseQrc,
  yrc: parseYrc,
  lys: parseLys,
};

const AUDIO_EXTENSIONS = new Set([
  'flac',
  'wav',
  'm4a',
  'alac',
  'ape',
  'mac',
  'wv',
  'tta',
  'tak',
  'aiff',
  'aif',
  'aifc',
  'mp3',
  'aac',
  'mp4',
  'ogg',
  'oga',
  'opus',
  'wma',
  'asf',
  'mpc',
  'mpp',
  'mp+',
  'dsf',
  'ac3',
  'eac3',
  'dts',
  'dtshd',
  'thd',
  'mlp',
  'mka',
  'amr',
  'rm',
  'ra',
  'au',
  'snd',
  'caf',
  'w64',
  'iff',
  '8svx',
]);

const AUDIO_CACHE_DB = 'amll-audio-cache';
const AUDIO_CACHE_STORE = 'audio-files';
const AUDIO_CACHE_KEY = 'last-audio';

type AudioCacheRecord = {
  key: string;
  file: Blob;
  name: string;
  type: string;
  updatedAt: number;
};

const audioCacheDbPromise = openDB(AUDIO_CACHE_DB, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(AUDIO_CACHE_STORE)) {
      db.createObjectStore(AUDIO_CACHE_STORE, { keyPath: 'key' });
    }
  },
});

const readAudioCache = async () => {
  try {
    const db = await audioCacheDbPromise;
    return (await db.get(AUDIO_CACHE_STORE, AUDIO_CACHE_KEY)) as AudioCacheRecord | undefined;
  } catch {
    return undefined;
  }
};

const writeAudioCache = async (file: File) => {
  try {
    const db = await audioCacheDbPromise;
    const payload: AudioCacheRecord = {
      key: AUDIO_CACHE_KEY,
      file,
      name: file.name,
      type: file.type,
      updatedAt: Date.now(),
    };
    await db.put(AUDIO_CACHE_STORE, payload);
  } catch {
    /* 写入音频缓存失败不阻塞打开：仅影响下次回访的加载速度 */
  }
};

const mergeExtractedMetadata = (
  currentMetadata: TTMLMetadata[],
  extractedMetadata: TTMLMetadata[]
) => {
  let changed = false;
  for (const extracted of extractedMetadata) {
    const values = extracted.value.map((value) => value.trim()).filter((value) => value !== '');
    if (values.length === 0) continue;

    const current = currentMetadata.find((item) => item.key === extracted.key);
    if (!current) {
      currentMetadata.push({ key: extracted.key, value: values });
      changed = true;
      continue;
    }

    if (current.value.some((value) => value.trim() !== '')) continue;
    current.value = values;
    changed = true;
  }
  return changed;
};

export const useFileOpener = () => {
  const setNewLyricLines = useSetAtom(newLyricLinesAtom);
  const setLyricLines = useSetAtom(lyricLinesAtom);
  const setProjectId = useSetAtom(projectIdAtom);
  const setSaveFileName = useSetAtom(saveFileNameAtom);
  const setSourceFileContent = useSetAtom(sourceFileContentAtom);
  const setConfirmDialog = useSetAtom(confirmDialogAtom);
  const isDirty = useAtomValue(isDirtyAtom);
  const fileUpdateSession = useAtomValue(fileUpdateSessionAtom);
  const defaultTtmlAuthorGithub = useAtomValue(defaultTtmlAuthorGithubAtom);
  const defaultTtmlAuthorGithubLogin = useAtomValue(defaultTtmlAuthorGithubLoginAtom);
  const handleTtmlError = useTtmlErrorHandler();
  const { t } = useTranslation();
  const setPushNotification = useSetAtom(pushNotificationAtom);

  const normalizeLyricLines = useCallback((lyricLines: LyricLine[]): TTMLLyric => {
    return {
      lyricLines: lyricLines.map((line) => ({
        ...line,
        words: line.words.map((word) => ({
          ...word,
          id: uid(),
          obscene: false,
          emptyBeat: 0,
          romanWord: word.romanWord || '',
        })),
        translatedLyric: line.translatedLyric || '',
        romanLyric: line.romanLyric || '',
        isBG: line.isBG || false,
        isDuet: line.isDuet || false,
        ignoreSync: false,
        id: uid(),
      })),
      metadata: [],
      agents: [],
    };
  }, []);

  const mergeAudioMetadata = useCallback(
    (metadata: TTMLMetadata[]) => {
      setLyricLines((prev) => {
        const nextMetadata = prev.metadata.map((item) => ({
          ...item,
          value: [...item.value],
        }));
        const metadataChanged = mergeExtractedMetadata(nextMetadata, metadata);
        const defaultChanged = applyDefaultTtmlAuthorMetadata(nextMetadata, {
          githubId: defaultTtmlAuthorGithub,
          githubLogin: defaultTtmlAuthorGithubLogin,
        });

        if (!metadataChanged && !defaultChanged) return prev;
        return { ...prev, metadata: nextMetadata };
      });
    },
    [defaultTtmlAuthorGithub, defaultTtmlAuthorGithubLogin, setLyricLines]
  );

  const loadAudioFile = useCallback(
    async (file: File, options?: { cache?: boolean; extractMetadata?: boolean }) => {
      try {
        const metadata = await audioEngine.loadMusic(file);
        if (options?.extractMetadata !== false) {
          mergeAudioMetadata(metadata);
        }
      } catch (e) {
        fileOpenerLogger.error(`Failed to load audio or extract metadata: ${file.name}`, e);
      }

      if (options?.cache) {
        await writeAudioCache(file);
      }
    },
    [mergeAudioMetadata]
  );

  const performOpenFile = useCallback(
    async (file: File, forceExt?: string) => {
      const rawExt = file.name.split('.').pop()?.toLowerCase() || '';
      const ext = forceExt ? forceExt.toLowerCase() : rawExt;

      try {
        if (AUDIO_EXTENSIONS.has(ext)) {
          await loadAudioFile(file, { cache: true });
          return;
        }

        let lyricData: TTMLLyric | null = null;
        const text = await file.text();
        setSourceFileContent(text);

        if (ext === 'ttml') {
          const result = parseTTMLLyric(text);

          if (result.success) {
            lyricData = result.data;
          } else {
            handleTtmlError(result.error, `Error when parsing TTML: ${file.name}`, text);

            return;
          }
        } else if (ext in LYRIC_PARSERS) {
          const parser = LYRIC_PARSERS[ext];
          const rawLines = parser(text);
          lyricData = normalizeLyricLines(rawLines);
        } else {
          setPushNotification({
            title: t('error.unsupportedFileFormat', '不支持的文件格式: {ext}', {
              ext,
            }),
            level: 'error',
            source: 'useFileOpener',
          });
          return;
        }

        if (!lyricData) return;

        applyDefaultTtmlAuthorMetadata(lyricData.metadata, {
          githubId: defaultTtmlAuthorGithub,
          githubLogin: defaultTtmlAuthorGithubLogin,
        });

        let resolvedProjectId = uid();

        try {
          if (lyricData.metadata.length > 0) {
            const projects = await getProjectList();
            const matchedProject = projects.find((p) => isProjectMatch(p, lyricData as TTMLLyric));

            if (matchedProject) {
              fileOpenerLogger.debug(
                `匹配到了已有项目: ${matchedProject.name} (${matchedProject.id})`
              );
              resolvedProjectId = matchedProject.id;
            } else {
              fileOpenerLogger.debug('未匹配已有项目');
            }
          }
        } catch (e) {
          fileOpenerLogger.error('解析项目数据时失败', e);
        }

        setProjectId(resolvedProjectId);
        setNewLyricLines(lyricData);
        const suggestedFile = getSuggestedTtmlFileName(lyricData.metadata);
        const nextFileName = ext === 'ttml' ? file.name : (suggestedFile?.fileName ?? file.name);
        setSaveFileName(nextFileName);
      } catch (e) {
        fileOpenerLogger.error(`Failed to open file: ${file.name}`, e);
        setPushNotification({
          title: t('error.openFileFailed', '打开文件失败'),
          level: 'error',
          source: 'useFileOpener',
        });
      }
    },
    [
      setNewLyricLines,
      setProjectId,
      setSaveFileName,
      setSourceFileContent,
      loadAudioFile,
      normalizeLyricLines,
      defaultTtmlAuthorGithub,
      defaultTtmlAuthorGithubLogin,
      t,
      setPushNotification,
      handleTtmlError,
    ]
  );

  const openFile = useCallback(
    /**
     * 打开文件
     * @param file
     * @param forceExt 可选参数，用于强制指定解析方式，不传入则从文件后缀名推断
     */
    (file: File, forceExt?: string) => {
      const run = () => performOpenFile(file, forceExt);

      const rawExt = file.name.split('.').pop()?.toLowerCase() || '';
      const finalExt = forceExt ? forceExt.toLowerCase() : rawExt;

      if (AUDIO_EXTENSIONS.has(finalExt)) {
        run();
        return;
      }

      if (fileUpdateSession) {
        setConfirmDialog({
          open: true,
          title: '确认进入编辑',
          description: `当前处于 PR #${fileUpdateSession.prNumber} 更新会话。是否继续打开文件并进入编辑？`,
          onConfirm: run,
        });
        return;
      }

      if (isDirty) {
        setConfirmDialog({
          open: true,
          title: t('confirmDialog.openFile.title', '确认打开文件'),
          description: t(
            'confirmDialog.openFile.description',
            '当前文件有未保存的更改。如果继续，这些更改将会丢失。确定要打开新文件吗？'
          ),
          onConfirm: run,
        });
      } else {
        run();
      }
    },
    [fileUpdateSession, isDirty, performOpenFile, setConfirmDialog, t]
  );

  const openCachedAudio = useCallback(async () => {
    try {
      const record = await readAudioCache();
      if (!record?.file) {
        setPushNotification({
          title: t('audioPanel.cachedAudioMissing', '未找到缓存音频'),
          level: 'warning',
          source: 'useFileOpener',
        });
        return;
      }
      const name = record.name || 'cached-audio';
      const type = record.type || record.file.type || 'audio/*';
      const file = new File([record.file], name, { type });
      await loadAudioFile(file, { extractMetadata: false });
      setPushNotification({
        title: t('audioPanel.cachedAudioLoaded', '已从缓存加载音频'),
        level: 'success',
        source: 'useFileOpener',
      });
    } catch (error) {
      fileOpenerLogger.error('Failed to load cached audio', error);
      setPushNotification({
        title: t('audioPanel.cachedAudioFailed', '读取缓存音频失败'),
        level: 'error',
        source: 'useFileOpener',
      });
    }
  }, [loadAudioFile, setPushNotification, t]);

  const loadTtmlContent = useCallback(
    async (ttml: string, options?: { projectId?: string; fileName?: string }) => {
      const result = parseTTMLLyric(ttml);
      if (!result.success) {
        handleTtmlError(result.error, 'Error when parsing TTML from submission');
        return false;
      }

      setSourceFileContent(ttml);
      setNewLyricLines(result.data);
      if (options?.projectId) {
        setProjectId(options.projectId);
      }
      if (options?.fileName) {
        setSaveFileName(options.fileName);
      }
      setLyricLines((prev) => {
        const nextMetadata = prev.metadata.map((item) => ({
          ...item,
          value: [...item.value],
        }));
        applyDefaultTtmlAuthorMetadata(nextMetadata, {
          githubId: defaultTtmlAuthorGithub,
          githubLogin: defaultTtmlAuthorGithubLogin,
        });
        return { ...prev, metadata: nextMetadata };
      });
      return true;
    },
    [
      defaultTtmlAuthorGithub,
      defaultTtmlAuthorGithubLogin,
      handleTtmlError,
      setLyricLines,
      setNewLyricLines,
      setProjectId,
      setSaveFileName,
      setSourceFileContent,
    ]
  );

  return { openFile, openCachedAudio, loadTtmlContent };
};
