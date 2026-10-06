import { removeNotificationAtom, upsertNotificationAtom } from '$/states/notifications';
import { globalStore } from '$/states/store';
import type { DownloadProgress } from './download';

const AUDIO_DOWNLOAD_NOTIFICATION_ID = 'audio-download-progress';

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const fractionDigits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
};

const formatDownloadProgressDescription = (progress: DownloadProgress) => {
  const loaded = formatBytes(progress.loadedBytes);
  if (progress.totalBytes) {
    const total = formatBytes(progress.totalBytes);
    const percent = Math.round(progress.percent ?? 0);
    return `${percent}% (${loaded} / ${total})`;
  }
  return `已下载 ${loaded}`;
};

export const upsertAudioDownloadProgressNotification = (
  fileName: string,
  progress: DownloadProgress
) => {
  globalStore.set(upsertNotificationAtom, {
    id: AUDIO_DOWNLOAD_NOTIFICATION_ID,
    title: `正在下载音频：${fileName}`,
    description: formatDownloadProgressDescription(progress),
    level: 'info',
    source: 'audio',
    pinned: true,
    progress: {
      value: progress.percent,
    },
  });
};

export const removeAudioDownloadProgressNotification = () => {
  globalStore.set(removeNotificationAtom, AUDIO_DOWNLOAD_NOTIFICATION_ID);
};
