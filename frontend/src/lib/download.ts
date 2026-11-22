// browser-id3-writer v4 是 UMD/CJS 默认导出（module.exports = ID3Writer），
// 用默认导入；v6+ 改为命名导出 { ID3Writer }，若升级需改这里
import ID3Writer from 'browser-id3-writer';
import JSZip from 'jszip';
import { api } from '@/lib/api';
import { triggerDownload } from '@/lib/blob-download';

interface DownloadMeta {
  title: string;
  artists: string;
  album?: string;
  coverUrl?: string;
}

/**
 * 单次下载的兜底超时。fetch 没有默认超时：CDN 慢响应或连接不关时，
 * 批量下载的 worker 会被永久占住，进度条停在某个数字且不报错。
 */
const DOWNLOAD_TIMEOUT_MS = 120_000;
/** 封面是小文件，超时给短一点 */
const COVER_TIMEOUT_MS = 30_000;

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
  const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!audioRes.ok) {
    throw new Error(`下载失败：HTTP ${audioRes.status}`);
  }
  const audioBuffer = await audioRes.arrayBuffer();
  const contentType = audioRes.headers.get('content-type') ?? '';
  // 以文件头嗅探为准：CDN 常把 flac 标成 audio/mpeg 或不带扩展名
  const ext = resolveAudioExt(audioBuffer, audioUrl, contentType);
  const isMp3 = ext === 'mp3';

  const coverBuffer = await fetchCover(meta.coverUrl);
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
    /** 自定义解析器 */
    resolver?: (
      songId: string,
      quality: string
    ) => Promise<{ url?: string; name?: string; artists?: string; cover?: string }>;
  } = {}
): Promise<void> {
  const {
    quality = 'exhigh',
    concurrency = 4,
    zipName = 'songs',
    resolver = (songId, q) => api.parseNcmMusic(songId, q),
  } = options;
  if (items.length === 0) return;

  const zip = new JSZip();
  const usedNames = new Set<string>();
  let done = 0;
  let failed = 0;
  const total = items.length;

  const processItem = async (item: BatchDownloadItem) => {
    try {
      const info = await resolver(item.songId, quality);
      if (!info.url) {
        failed++;
        done++;
        onProgress({ done, total, failed, currentName: item.name });
        return;
      }
      const audioRes = await fetch(info.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!audioRes.ok) {
        failed++;
        done++;
        onProgress({ done, total, failed, currentName: item.name });
        return;
      }
      const audioBuffer = await audioRes.arrayBuffer();
      const contentType = audioRes.headers.get('content-type') ?? '';
      const ext = resolveAudioExt(audioBuffer, info.url, contentType);
      const isMp3 = ext === 'mp3';

      const coverBuffer = await fetchCover(item.coverUrl ?? info.cover);
      const meta: DownloadMeta = {
        title: info.name ?? item.name,
        artists: info.artists ?? item.artists,
        coverUrl: item.coverUrl,
      };
      const blob = buildAudioBlob(audioBuffer, meta, coverBuffer, isMp3, contentType);

      // 文件名
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
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
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

/**
 * 根据文件头嗅探音频格式。
 * CDN 经常把 flac 标成 audio/mpeg 或 application/octet-stream，
 * 只靠 URL/Content-Type 会把无损音质误判成 mp3，因此优先读取二进制头。
 */
function sniffAudioExt(buffer: ArrayBuffer): string | null {
  const head = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 16));
  const ascii = (start: number, len: number) =>
    String.fromCharCode(...head.subarray(start, start + len));

  if (head.length >= 4) {
    const magic = ascii(0, 4);
    if (magic === 'fLaC') return 'flac';
    if (magic === 'OggS') return 'ogg';
    if (magic === 'RIFF') return 'wav';
    if (magic === 'MAC ') return 'ape';
  }
  // MP4/M4A：第 4-8 字节为 ftyp
  if (head.length >= 12 && ascii(4, 4) === 'ftyp') return 'm4a';
  // ID3v2 标签
  if (head.length >= 3 && ascii(0, 3) === 'ID3') return 'mp3';
  // MPEG / ADTS 帧同步
  const b0 = head[0] ?? 0;
  const b1 = head[1] ?? 0;
  if (head.length >= 2 && b0 === 0xff && (b1 & 0xe0) === 0xe0) {
    // ADTS AAC 的 layer 位为 0，MPEG 音频层非 0
    return (b1 & 0x06) === 0 ? 'aac' : 'mp3';
  }
  return null;
}

/** 确定扩展名：文件头嗅探 > URL/Content-Type 推断 > mp3 兜底 */
function resolveAudioExt(buffer: ArrayBuffer, url: string, contentType: string): string {
  return sniffAudioExt(buffer) ?? guessExt(url, contentType);
}

/** 获取封面 ArrayBuffer */
async function fetchCover(coverUrl?: string): Promise<ArrayBuffer | null> {
  if (!coverUrl) return null;
  try {
    const res = await fetch(coverUrl, { signal: AbortSignal.timeout(COVER_TIMEOUT_MS) });
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
