import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  Download,
  FileText,
  Languages,
  Loader2,
  Music as MusicIcon,
  User,
  Disc3,
  Edit,
  ListOrdered,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { downloadBlobFile, downloadText, sanitizeFileName } from '@/lib/download';
import { listItem, staggerContainer } from '@/lib/motion';
import { formatLyricTime } from '@/lib/format';
import type { LyricViewLine, LyricViewResponse, OnlinePlatform } from '@/lib/types';
import { EmptyState } from '@/components/ui/EmptyState';

export interface LyricViewerProps {
  filename?: string;
  ttml?: string;
  online?: { platform: OnlinePlatform; songId: string };
  showHeader?: boolean;
  showActions?: boolean;
  rawLyricFile?: string;
}

/** 平台歌词模式返回：视图数据 + 原始歌词文本与下载文件名 */
interface OnlineViewResult extends LyricViewResponse {
  rawLyric: string | null;
  downloadName: string;
}

/** 按平台决定下载扩展名 */
export const ONLINE_LYRIC_EXT: Record<OnlinePlatform, string> = {
  qq: 'qrc',
  kugou: 'krc',
  ncm: 'lrc',
};

/** 拉取平台歌词并转换为 LyricViewResponse 结构 */
async function fetchOnlineView(
  platform: OnlinePlatform,
  songId: string
): Promise<OnlineViewResult> {
  const [song, lyric] = await Promise.all([
    api.getOnlineSong(platform, songId),
    api.getOnlineLyric(platform, songId).catch(() => null),
  ]);
  const matchText = (
    arr: { time: number; text: string }[] | undefined,
    time: number
  ): string | undefined => {
    if (!arr || arr.length === 0) return undefined;
    let best: { time: number; text: string } | null = null;
    let bestDiff = Infinity;
    for (const t of arr) {
      const diff = Math.abs(t.time - time);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = t;
      }
    }
    return best && bestDiff <= 100 ? best.text : undefined;
  };
  const lines: LyricViewLine[] = (lyric?.lines ?? []).map((l) => ({
    startTime: l.time,
    endTime: l.time + l.duration,
    text: l.text,
    translatedLyric: matchText(lyric?.translation, l.time),
    romanLyric: matchText(lyric?.romanization, l.time),
    isBg: false,
    isDuet: false,
  }));
  const downloadName = `${sanitizeFileName(song.songName || '未知歌曲')} - ${sanitizeFileName(
    song.artists?.join(', ') || '未知歌手'
  )}.${ONLINE_LYRIC_EXT[platform]}`;
  return {
    metadata: {
      musicName: song.songName ? [song.songName] : [],
      artists: song.artists ?? [],
      album: song.albumName ? [song.albumName] : [],
    },
    lines,
    rawLyric: lyric?.raw || (lines.length > 0 ? JSON.stringify(lines) : null),
    downloadName,
  };
}

/** 将毫秒（float）格式化为 MM:SS.mmm */

function MetaChip({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-primary hover:text-primary">
      <Icon className="h-3.5 w-3.5" />
      {children}
    </span>
  );
}

/** TTML 文本不做 queryKey 原文存储，用 djb2 + 长度生成短指纹（仅用于缓存定位） */
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}:${s.length.toString(36)}`;
}

export function LyricViewer({
  filename,
  ttml,
  online,
  showHeader = true,
  showActions = true,
  rawLyricFile,
}: LyricViewerProps) {
  const [dlError, setDlError] = useState('');
  const onlinePlatform = online?.platform;
  const onlineSongId = online?.songId;

  // 三种数据源模式：本地文件名 / TTML 文本 / 平台在线
  const mode = filename ? 'file' : ttml ? 'ttml' : onlinePlatform && onlineSongId ? 'online' : null;

  // 请求由 Query 接管：按数据源缓存去重，竞态由 queryKey 隔离
  const viewQuery = useQuery({
    queryKey:
      mode === 'file'
        ? queryKeys.viewLyric(filename!)
        : mode === 'online'
          ? queryKeys.onlineViewLyric(onlinePlatform!, onlineSongId!)
          : queryKeys.parseLyric(ttml ? hashString(ttml) : ''),
    queryFn: () => {
      if (mode === 'file') return api.viewLyric(filename!);
      if (mode === 'online') return fetchOnlineView(onlinePlatform!, onlineSongId!);
      return api.parseLyric(ttml!);
    },
    enabled: mode !== null,
    staleTime: 5 * 60_000,
  });

  const { data, isPending, error } = viewQuery;
  const loading = mode !== null && isPending;
  const errorMsg =
    mode === null
      ? '缺少歌词数据'
      : error instanceof Error
        ? error.message
        : error
          ? '加载失败'
          : '';
  // 平台模式：原始 LRC 文本与下载文件名（其他模式为 null）。
  // OnlineViewResult 是 LyricViewResponse 的扩展，联合类型会被收窄，需显式还原
  const onlineData = mode === 'online' ? (data as OnlineViewResult | undefined) : undefined;
  const onlineRaw = onlineData?.rawLyric ?? null;
  const onlineDlName = onlineData?.downloadName ?? null;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-3 text-sm text-ink-2">加载歌词中…</p>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-surface-2 py-12 text-center">
        <AlertCircle className="h-8 w-8 text-error" />
        <h3 className="mt-3 text-base font-semibold text-error">加载歌词失败</h3>
        <p className="mt-1 text-sm text-ink-2">{errorMsg}</p>
      </div>
    );
  }

  if (!data || data.lines.length === 0) {
    return <EmptyState icon={FileText} title="暂无歌词内容" />;
  }

  const md = data.metadata;
  const titles = md.musicName ?? [];
  const artists = md.artists ?? [];
  const albums = md.album ?? [];
  const author = md.ttmlAuthorGithubLogin?.[0] ?? md.ttmlAuthorGithub?.[0];

  const handleDownload = async () => {
    setDlError('');
    // 平台模式：直接下载已获取的 LRC 原始文本
    if (onlineRaw) {
      try {
        downloadText(onlineRaw, onlineDlName ?? 'lyric.lrc');
      } catch (e) {
        setDlError(e instanceof Error ? `下载失败：${e.message}` : '下载失败');
      }
      return;
    }
    const file = rawLyricFile ?? filename;
    if (!file) return;
    try {
      await downloadBlobFile(api.rawLyricDownloadURL(file), file);
    } catch (e) {
      // 下载失败时提示用户（而非静默吞错）
      setDlError(e instanceof Error ? `下载失败：${e.message}` : '下载失败');
    }
  };

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={staggerContainer}
      className="rounded-xl border border-line bg-card p-6 shadow-sm transition-shadow hover:shadow-md sm:p-8"
    >
      {/* 标题 + 元数据 */}
      {showHeader && (
        <motion.div variants={listItem} className="mb-6 border-b-2 border-line pb-5">
          <h1 className="text-2xl font-bold leading-tight text-foreground sm:text-3xl">
            {titles[0] ?? '未知歌曲'}
          </h1>
          {titles.length > 1 && (
            <p className="mt-1 text-sm text-ink-2">{titles.slice(1).join(' / ')}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {artists.length > 0 && <MetaChip icon={User}>{artists.join(', ')}</MetaChip>}
            {albums.length > 0 && <MetaChip icon={Disc3}>{albums.join(', ')}</MetaChip>}
            {author && <MetaChip icon={Edit}>{author}</MetaChip>}
            <MetaChip icon={ListOrdered}>{data.lines.length} 行歌词</MetaChip>
          </div>
        </motion.div>
      )}

      {/* 歌词内容 */}
      <motion.div variants={listItem} className="space-y-1">
        {data.lines.map((line, idx) => (
          <motion.div
            key={idx}
            variants={listItem}
            className={`flex gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-primary-tint/50 sm:gap-4 sm:px-4 ${
              line.isDuet ? 'flex-row-reverse text-right' : ''
            }`}
          >
            {/* 时间 */}
            <span
              className={`shrink-0 font-mono text-xs font-semibold text-primary sm:text-sm ${
                line.isDuet ? 'text-right' : ''
              }`}
              style={{ minWidth: '72px' }}
            >
              {formatLyricTime(line.startTime)}
            </span>

            {/* 歌词文本 */}
            <div className="min-w-0 flex-1">
              {/* 主歌词 */}
              {!line.isBg && (
                <div className="text-base font-medium text-foreground sm:text-lg">
                  {line.text || '♪'}
                </div>
              )}

              {/* 背景歌词 */}
              {line.isBg && (
                <div
                  className={`flex items-start gap-1.5 rounded-md bg-surface-2 px-3 py-1.5 text-sm text-ink-3 ${
                    line.isDuet ? 'flex-row-reverse' : ''
                  }`}
                >
                  <MusicIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{line.text}</span>
                </div>
              )}

              {/* 翻译 */}
              {line.translatedLyric && (
                <div
                  className={`mt-1 flex items-start gap-1.5 text-sm text-primary ${
                    line.isDuet ? 'justify-end' : 'pl-1'
                  }`}
                >
                  <Languages className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{line.translatedLyric}</span>
                </div>
              )}

              {/* 罗马音 */}
              {line.romanLyric && (
                <div
                  className={`mt-1 font-mono text-xs text-purple-500 ${
                    line.isDuet ? 'text-right' : 'pl-1'
                  }`}
                >
                  {line.romanLyric}
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* 操作按钮 */}
      {showActions && (rawLyricFile || filename || onlineRaw) && (
        <motion.div variants={listItem} className="mt-6 flex gap-3 border-t border-line pt-5">
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            <Download className="h-4 w-4" />
            下载歌词
          </button>
          {dlError && <p className="self-center text-sm text-error">{dlError}</p>}
        </motion.div>
      )}
    </motion.div>
  );
}
