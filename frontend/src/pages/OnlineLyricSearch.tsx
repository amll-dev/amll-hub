import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  Clock,
  Disc3,
  Download,
  Eye,
  Hash,
  Loader2,
  Music,
  Play,
  Search,
  User,
} from 'lucide-react';
import { useOnlineSearchContext } from '@/context/OnlineSearchContext';
import { usePlayer } from '@/hooks/usePlayer';
import { api } from '@/lib/api';
import { downloadText, sanitizeFileName } from '@/lib/download';
import { buttonTap, fadeUp, listItem, staggerContainer } from '@/lib/motion';
import { ONLINE_LYRIC_EXT } from '@/components/LyricViewer';
import type { OnlinePlatform, OnlineSearchHit } from '@/lib/types';

const PLATFORM_OPTIONS: { value: OnlinePlatform; label: string }[] = [
  { value: 'ncm', label: '网易云' },
  { value: 'qq', label: 'QQ音乐' },
  { value: 'kugou', label: '酷狗' },
];

/** 秒 -> mm:ss */
function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function OnlineLyricSearch() {
  const {
    inputValue,
    setInputValue,
    platform,
    setPlatform,
    searchLoading,
    searchError,
    searchResults,
    doSearch,
  } = useOnlineSearchContext();
  const { playNcmSong, loading: playerLoading, track } = usePlayer();
  const navigate = useNavigate();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || searchLoading) return;
    void doSearch(inputValue.trim());
  };

  const handlePlatformChange = (p: OnlinePlatform) => {
    setPlatform(p);
    // 切换平台时若输入框有内容，立即用新平台重搜
    const q = inputValue.trim();
    if (q && !searchLoading) {
      void doSearch(q, p);
    }
  };

  // 播放（仅网易云平台支持）
  const handlePlay = (hit: OnlineSearchHit) => {
    if (playerLoading) return;
    void playNcmSong(hit.platformId, {
      name: hit.songName,
      artists: hit.artists.join(' / '),
      cover: hit.coverUrl || undefined,
    });
  };

  // 查看歌词：跳转到平台歌词查看页
  const handleView = (hit: OnlineSearchHit) => {
    navigate(`/online-lyric/${hit.platform}/${encodeURIComponent(hit.platformId)}`);
  };

  // 下载歌词：拉取原始歌词文本
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [dlError, setDlError] = useState<{ key: string; msg: string } | null>(null);

  const handleDownload = async (hit: OnlineSearchHit) => {
    const key = `${hit.platform}-${hit.platformId}`;
    if (downloadingKey) return;
    setDownloadingKey(key);
    setDlError(null);
    try {
      const lyric = await api.getOnlineLyric(hit.platform, hit.platformId);
      if (!lyric.raw) throw new Error('暂无歌词');
      downloadText(
        lyric.raw,
        `${sanitizeFileName(hit.songName || '未知歌曲')} - ${sanitizeFileName(
          hit.artists.join(', ') || '未知歌手'
        )}.${ONLINE_LYRIC_EXT[hit.platform]}`
      );
    } catch (e) {
      setDlError({ key, msg: e instanceof Error ? e.message : '下载失败' });
    } finally {
      setDownloadingKey(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12">
      <motion.div initial="hidden" animate="show" variants={fadeUp}>
        <h1 className="text-3xl font-bold tracking-tight">平台歌词搜索</h1>
        <p className="mt-2 text-sm text-ink-2">
          搜索歌曲并查看各平台歌词，支持网易云、QQ音乐、酷狗音乐。
        </p>
      </motion.div>

      {/* 搜索栏 */}
      <motion.form
        onSubmit={handleSubmit}
        initial="hidden"
        animate="show"
        variants={fadeUp}
        className="mt-6 flex items-center gap-2"
      >
        <PlatformSelect value={platform} onChange={handlePlatformChange} />

        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="输入歌曲 / 歌手 / 专辑关键词…"
            className="h-11 w-full rounded-md border border-input bg-card pl-10 pr-4 text-sm text-foreground transition-colors placeholder:text-ink-3 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-[var(--amll-primary-soft)]"
          />
        </div>

        <motion.button
          type="submit"
          disabled={searchLoading || !inputValue.trim()}
          {...buttonTap}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {searchLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4 shrink-0" />
          )}
          搜索
        </motion.button>
      </motion.form>

      {/* 搜索结果：独立卡片列表 */}
      <div className="mt-6">
        <SearchResultList
          hits={searchResults?.hits ?? []}
          loading={searchLoading}
          error={searchError}
          playingId={track?.ncmSongId}
          playerLoading={playerLoading}
          downloadingKey={downloadingKey}
          dlError={dlError}
          onView={handleView}
          onPlay={handlePlay}
          onDownload={handleDownload}
        />
      </div>
    </div>
  );
}

// ===== 平台下拉选择器 =====
function PlatformSelect({
  value,
  onChange,
}: {
  value: OnlinePlatform;
  onChange: (v: OnlinePlatform) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = PLATFORM_OPTIONS.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-11 items-center gap-1 rounded-md border border-input bg-card pl-3 pr-7 text-sm font-medium text-foreground transition-colors hover:border-primary focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-[var(--amll-primary-soft)]"
      >
        {current?.label}
        <ChevronDown
          className={`pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute left-0 top-[calc(100%+6px)] z-50 min-w-[120px] overflow-hidden rounded-md border border-line bg-popover p-1 shadow-lg"
          >
            {PLATFORM_OPTIONS.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`block w-full rounded px-3 py-2 text-left text-sm transition-colors hover:bg-primary-tint hover:text-primary ${
                    o.value === value
                      ? 'bg-primary-tint font-medium text-primary'
                      : 'text-foreground'
                  }`}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

// ===== 搜索结果列表 =====
function SearchResultList({
  hits,
  loading,
  error,
  playingId,
  playerLoading,
  downloadingKey,
  dlError,
  onView,
  onPlay,
  onDownload,
}: {
  hits: OnlineSearchHit[];
  loading: boolean;
  error: string | null;
  playingId?: string;
  playerLoading: boolean;
  downloadingKey: string | null;
  dlError: { key: string; msg: string } | null;
  onView: (hit: OnlineSearchHit) => void;
  onPlay: (hit: OnlineSearchHit) => void;
  onDownload: (hit: OnlineSearchHit) => void;
}) {
  if (error) {
    return <p className="text-sm text-error">{error}</p>;
  }
  if (loading) {
    return <ListSkeleton />;
  }
  if (hits.length === 0) {
    return <p className="text-sm text-ink-3">输入关键词开始搜索</p>;
  }

  const btnBase =
    'inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  const btnIdle = 'text-ink-3 hover:bg-surface-2 hover:text-primary';
  const btnActive = 'bg-primary-tint text-primary';

  return (
    <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="space-y-2">
      {hits.map((hit) => {
        const key = `${hit.platform}-${hit.platformId}`;
        const isPlaying = hit.platform === 'ncm' && playingId === hit.platformId;
        const isDownloading = downloadingKey === key;
        const hitDlError = dlError?.key === key ? dlError.msg : null;
        return (
          <motion.li
            key={key}
            variants={listItem}
            className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4 transition-colors hover:bg-surface-2 sm:flex-row sm:items-center"
          >
            <SongCover src={hit.coverUrl} alt={hit.songName} />

            <div className="min-w-0 flex-1">
              <p className="break-words font-semibold text-foreground">
                {hit.songName || '未知歌曲'}
              </p>
              {hit.artists.length > 0 && (
                <div className="mt-1 flex items-start gap-1 text-sm text-ink-2">
                  <User className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="break-words">{hit.artists.join(' / ')}</span>
                </div>
              )}
              {hit.albumName && (
                <div className="mt-1 flex items-start gap-1 text-sm text-ink-2">
                  <Disc3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="break-words">{hit.albumName}</span>
                </div>
              )}
              {/* 平台 ID 标签 */}
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <span className="inline-flex items-center gap-0.5 rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3">
                  <Hash className="h-2.5 w-2.5" />
                  {hit.platform}:{hit.platformId}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              <div className="flex items-center gap-1 text-xs text-ink-3">
                <Clock className="h-3.5 w-3.5" />
                {formatDuration(hit.duration)}
              </div>
              <div className="flex items-center gap-1">
                {/* 播放（仅网易云） */}
                {hit.platform === 'ncm' && (
                  <button
                    type="button"
                    onClick={() => onPlay(hit)}
                    disabled={playerLoading}
                    title={isPlaying ? '正在播放' : '播放'}
                    className={`${btnBase} ${isPlaying ? btnActive : btnIdle}`}
                  >
                    {playerLoading && isPlaying ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </button>
                )}
                {/* 查看歌词（跳转到查看页） */}
                <button
                  type="button"
                  onClick={() => onView(hit)}
                  title="查看歌词"
                  className={`${btnBase} ${btnIdle}`}
                >
                  <Eye className="h-4 w-4" />
                </button>
                {/* 下载歌词 */}
                <button
                  type="button"
                  onClick={() => onDownload(hit)}
                  disabled={downloadingKey !== null}
                  title={hitDlError ? `下载失败：${hitDlError}` : '下载歌词'}
                  className={`${btnBase} ${hitDlError ? 'text-error hover:bg-error/10' : btnIdle}`}
                >
                  {isDownloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}

// ===== 封面 =====
function SongCover({ src, alt }: { src?: string; alt: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="h-12 w-12 shrink-0 rounded-md object-cover shadow-sm"
      />
    );
  }
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-3">
      <Music className="h-5 w-5" />
    </div>
  );
}

// ===== 骨架屏（对齐正常搜索的卡片骨架） =====
function ListSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="amll-skeleton h-20 w-full rounded-md" />
      ))}
    </div>
  );
}
