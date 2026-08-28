// browser-id3-writer v4 是 UMD/CJS 默认导出（module.exports = ID3Writer），
// 用默认导入；v6+ 改为命名导出 { ID3Writer }，若升级需改这里
import ID3Writer from 'browser-id3-writer';
import JSZip from 'jszip';
import { api } from '@/lib/api';

interface DownloadMeta {
  title: string;
  artists: string;
  album?: string;
  coverUrl?: string;
}

/** 批量下载的列表项 */
export interface BatchDownloadItem {
  songId: string;
  name: string;
  artists: string;
  coverUrl?: string;
}

/** 批量下载进度回调 */
export interface BatchProgress {
  done: number;
  total: number;
  failed: number;
  currentName?: string;
}

/**
 * 下载音乐并写入 ID3v2.3 元数据
 */
export async function downloadMusicWithMeta(audioUrl: string, meta: DownloadMeta): Promise<void> {
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) {
    throw new Error(`下载失败：HTTP ${audioRes.status}`);
  }
  const audioBuffer = await audioRes.arrayBuffer();
  const contentType = audioRes.headers.get('content-type') ?? '';
  const isMp3 = isMp3Content(audioUrl, contentType);

  const coverBuffer = await fetchCover(meta.coverUrl);
  const ext = isMp3 ? 'mp3' : guessExt(audioUrl, contentType);
  const filename = `${sanitizeFileName(meta.title)} - ${sanitizeFileName(meta.artists)}.${ext}`;

  const blob = buildAudioBlob(audioBuffer, meta, coverBuffer, isMp3, contentType);
  triggerDownload(blob, filename);
}

/**
 * 批量下载：并发解析+下载所有歌曲，写入元数据后打包为 ZIP。
 * @param items 歌曲列表
 * @param onProgress 进度回调
 * @param options.quality 音质（默认 exhigh）
 * @param options.concurrency 并发数（默认 4）
 * @param options.zipName ZIP 文件名（默认 "songs"）
 */
export async function downloadAllAsZip(
  items: BatchDownloadItem[],
  onProgress: (p: BatchProgress) => void,
  options: {
    quality?: string;
    concurrency?: number;
    zipName?: string;
  } = {}
): Promise<void> {
  const { quality = 'exhigh', concurrency = 4, zipName = 'songs' } = options;
  if (items.length === 0) return;

  const zip = new JSZip();
  const usedNames = new Set<string>();
  let done = 0;
  let failed = 0;
  const total = items.length;

  const processItem = async (item: BatchDownloadItem) => {
    try {
      const info = await api.parseNcmMusic(item.songId, quality);
      if (!info.url) {
        failed++;
        done++;
        onProgress({ done, total, failed, currentName: item.name });
        return;
      }
      const audioRes = await fetch(info.url);
      if (!audioRes.ok) {
        failed++;
        done++;
        onProgress({ done, total, failed, currentName: item.name });
        return;
      }
      const audioBuffer = await audioRes.arrayBuffer();
      const contentType = audioRes.headers.get('content-type') ?? '';
      const isMp3 = isMp3Content(info.url, contentType);

      const coverBuffer = await fetchCover(item.coverUrl ?? info.cover);
      const meta: DownloadMeta = {
        title: info.name ?? item.name,
        artists: info.artists ?? item.artists,
        coverUrl: item.coverUrl,
      };
      const blob = buildAudioBlob(audioBuffer, meta, coverBuffer, isMp3, contentType);

      // 文件名
      const ext = isMp3 ? 'mp3' : guessExt(info.url, contentType);
      const base = `${sanitizeFileName(meta.title)} - ${sanitizeFileName(meta.artists)}`;
      let filename = `${base}.${ext}`;
      if (usedNames.has(filename)) {
        filename = `${base} (${done}).${ext}`;
      }
      usedNames.add(filename);
      zip.file(filename, blob);
    } catch {
      failed++;
    }
    done++;
    onProgress({ done, total, failed, currentName: item.name });
  };

  // 并发池：最多 concurrency 个任务同时运行
  const queue = items.slice();
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      await processItem(item);
    }
  });
  await Promise.all(workers);

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `${sanitizeFileName(zipName)}.zip`);
}

/**
 * 下载远程文件到本地：fetch → blob → 触发浏览器下载。
 * 请求失败或 HTTP 非 2xx 时抛出 Error（含状态码），由调用方负责提示用户。
 */
export async function downloadBlobFile(url: string, fileName: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const blob = await res.blob();
  triggerDownload(blob, fileName);
}

/** 下载文本内容为文件 */
export function downloadText(content: string, fileName: string, mime = 'text/plain'): void {
  triggerDownload(new Blob([content], { type: `${mime};charset=utf-8` }), fileName);
}

// ===== 内部工具函数 =====

/** 判断是否为 MP3 格式 */
function isMp3Content(url: string, contentType: string): boolean {
  return (
    contentType.includes('audio/mpeg') ||
    contentType.includes('audio/mp3') ||
    /\.mp3(\?|$)/i.test(url)
  );
}

/** 获取封面 ArrayBuffer */
async function fetchCover(coverUrl?: string): Promise<ArrayBuffer | null> {
  if (!coverUrl) return null;
  try {
    const res = await fetch(coverUrl);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

/** 构建音频 Blob */
function buildAudioBlob(
  audioBuffer: ArrayBuffer,
  meta: DownloadMeta,
  coverBuffer: ArrayBuffer | null,
  isMp3: boolean,
  contentType: string
): Blob {
  if (!isMp3) {
    return new Blob([audioBuffer], {
      type: contentType || 'audio/octet-stream',
    });
  }
  const writer = new ID3Writer(audioBuffer);
  writer.setFrame('TIT2', meta.title);
  if (meta.artists) {
    writer.setFrame(
      'TPE1',
      meta.artists
        .split(/[/,、]/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }
  if (meta.album) {
    writer.setFrame('TALB', meta.album);
  }
  if (coverBuffer) {
    writer.setFrame('APIC', {
      type: 3, // 封面（front cover）
      data: coverBuffer,
      description: 'Cover',
    });
  }
  writer.addTag();
  return writer.getBlob();
}

/** 清理文件名中的非法字符（\p{Cc} 覆盖全部 Unicode 控制字符） */
export function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_').trim() || '未知';
}

/** 从 URL 或 content-type 推测文件扩展名 */
function guessExt(url: string, contentType: string): string {
  const ext = /\.(\w+)(?:\?|$)/i.exec(url.split('?')[0] ?? url)?.[1];
  if (ext) return ext.toLowerCase();
  if (contentType.includes('flac')) return 'flac';
  if (contentType.includes('m4a') || contentType.includes('mp4')) return 'm4a';
  if (contentType.includes('ogg')) return 'ogg';
  if (contentType.includes('wav')) return 'wav';
  return 'mp3';
}

/** 创建 <a> 标签触发下载 */
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
