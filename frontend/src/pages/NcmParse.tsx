import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  Download,
  Link2,
  ListMusic,
  Loader2,
  Music,
  Play,
  Search,
} from 'lucide-react';
import { useNcmParse } from '@/hooks/useNcmParse';
import { useAuth } from '@/hooks/useAuth';
import { PageContainer } from '@/components/PageContainer';
import {
  usePlayer,
  NCM_QUALITY_LABEL,
  NCM_QUALITY_ORDER,
  type NcmQuality,
  type PlaylistItem,
} from '@/hooks/usePlayer';
import {
  buttonTap,
  fadeUp,
  indexedListItem,
  listContainer,
  listItem,
  staggerContainer,
} from '@/lib/motion';
import type { LyricLine } from '@applemusic-like-lyrics/lyric';
import { downloadMusicWithMeta, downloadAllAsZip, type BatchProgress } from '@/lib/download';
import { api } from '@/lib/api';

function AutoHeight({ children, className }: { children: React.ReactNode; className?: string }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    setHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <motion.div
      initial={false}
      animate={{ height }}
      transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
      className={className}
      style={{ overflow: 'hidden' }}
    >
      <div ref={innerRef}>{children}</div>
    </motion.div>
  );
}

/** 毫秒 -> mm:ss */
function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '--:--';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export function NcmParse() {
  const { user, loading: authLoading, openLogin } = useAuth();

  // 音乐解析需要登录：加载登录态时显示占位，未登录显示登录引导
  if (authLoading) {
    return (
      <div className="mx-auto flex max-w-[1200px] items-center justify-center px-6 py-32 text-sm text-ink-3">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载中…
      </div>
    );
  }

  if (!user) {
    return (
      <PageContainer className="py-32 text-center">
        <h1 className="text-2xl font-bold tracking-tight">音乐解析需要登录</h1>
        <p className="mt-3 text-ink-2">登录后即可搜索歌曲并解析歌词</p>
        <motion.button
          type="button"
          onClick={() => openLogin('/ncm')}
          {...buttonTap}
          className="mt-8 inline-flex h-11 items-center rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          立即登录
        </motion.button>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <motion.div initial="hidden" animate="show" variants={fadeUp}>
        <h1 className="text-3xl font-bold tracking-tight">音乐解析</h1>
        <p className="mt-2 text-sm text-ink-2">搜索歌曲并点击解析，或通过歌单 ID 批量解析。</p>
      </motion.div>

      <motion.div
        initial="hidden"
        animate="show"
        variants={fadeUp}
        className="mt-6 rounded-2xl border border-line bg-card p-6"
      >
        <SearchSection />
      </motion.div>

      <ParseResultSection />
    </PageContainer>
  );
}

// ===== 搜索区（含歌单入口） =====
function SearchSection() {
  const { doSearch, searchLoading, doParsePlaylist, playlistLoading } = useNcmParse();
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'search' | 'playlist'>('search');

  const loading = mode === 'search' ? searchLoading : playlistLoading;
  const submit = mode === 'search' ? doSearch : doParsePlaylist;

  return (
    <div>
      <div className="mb-4 flex items-center gap-1 rounded-lg bg-surface-2 p-1">
        {(['search', 'playlist'] as const).map((m) => {
          const active = mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className="relative rounded-md px-4 py-1.5 text-sm font-medium transition-colors"
            >
              {active && (
                <motion.span
                  layoutId="ncm-mode-indicator"
                  className="absolute inset-0 rounded-md bg-card shadow-sm"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{
                    layout: { type: 'spring', stiffness: 380, damping: 30 },
                    opacity: { duration: 0.2 },
                  }}
                />
              )}
              <span
                className={`relative z-10 transition-colors ${
                  active ? 'text-primary' : 'text-ink-2 hover:text-foreground'
                }`}
              >
                {m === 'search' ? '搜索歌曲' : '解析歌单'}
              </span>
            </button>
          );
        })}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!q.trim() || loading) return;
          void submit(q.trim());
        }}
        className="flex gap-3"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            mode === 'search' ? '输入歌曲 / 歌手 / 专辑关键词' : '输入歌单 ID 或分享链接'
          }
          className="min-w-0 flex-1 rounded-lg border border-line bg-card px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary"
        />
        <motion.button
          type="submit"
          disabled={loading}
          {...buttonTap}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : mode === 'search' ? (
            <Search className="h-4 w-4" />
          ) : (
            <ListMusic className="h-4 w-4" />
          )}
          {mode === 'search' ? '搜索' : '解析'}
        </motion.button>
        <QualitySelect />
      </form>

      {/* 切换歌单/搜索 */}
      <AutoHeight className="mt-4">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{
              opacity: 0,
              y: -12,
              transition: { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] },
            }}
            transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {mode === 'search' ? <SearchModeContent /> : <PlaylistResultsList />}
          </motion.div>
        </AnimatePresence>
      </AutoHeight>
    </div>
  );
}

/** 搜索模式内容：搜索结果列表 + 下方音乐 ID 解析 */
function SearchModeContent() {
  const { searchSongs, searchLoading, searchError, hideSearchList } = useNcmParse();

  // 搜索结果列表：出错 / 骨架 / 空态 / 正常
  const showList = !hideSearchList;
  let listNode: React.ReactNode = null;
  if (showList) {
    if (searchError) {
      listNode = <p className="mt-2 text-sm text-red-500">{searchError}</p>;
    } else if (searchLoading && searchSongs === null) {
      listNode = <ListSkeleton />;
    } else if (!searchSongs || searchSongs.length === 0) {
      listNode = <p className="mt-2 text-sm text-ink-3">暂无搜索结果</p>;
    } else {
      listNode = (
        <motion.ul
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="divide-y divide-line rounded-xl border border-line"
        >
          {searchSongs.map((s) => (
            <SearchResultItem key={s.id} song={s} />
          ))}
        </motion.ul>
      );
    }
  }

  return (
    // 高度动画统一交给外层 AutoHeight
    <div>
      <AnimatePresence initial={false} mode="popLayout">
        {listNode && (
          <motion.div
            key="ncm-search-list"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.18 } }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="pb-6"
          >
            {listNode}
          </motion.div>
        )}
      </AnimatePresence>
      {/* 下方：通过歌曲 ID 或分享链接解析 */}
      <motion.div layout transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}>
        <SongIdParsePanel />
      </motion.div>
    </div>
  );
}

/** 单条搜索结果：点击后调用 parseSong 解析并隐藏列表 */
function SearchResultItem({ song }: { song: import('@/lib/types').NcmSong }) {
  const { parseSong, parsedSong, parseLoading } = useNcmParse();
  const isActive = parsedSong?.songId === String(song.id);
  return (
    <motion.li variants={listItem}>
      <button
        type="button"
        onClick={() =>
          parseSong(String(song.id), {
            name: song.name,
            artists: song.artists.map((a) => a.name).join(' / '),
            cover: song.picUrl || song.album.picUrl,
            duration: parseDurationStr(song.duration),
          })
        }
        disabled={parseLoading}
        className={`flex w-full items-center gap-4 px-4 py-3 text-left transition-colors ${
          isActive ? 'bg-primary-tint' : 'hover:bg-surface-2'
        }`}
      >
        <Cover src={song.picUrl || song.album.picUrl} alt={song.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{song.name}</p>
          <p className="truncate text-xs text-ink-2">
            {song.artists.map((a) => a.name).join(' / ')}
            {song.album?.name ? ` · ${song.album.name}` : ''}
          </p>
        </div>
        <span className="shrink-0 text-xs text-ink-3">{song.duration || '--:--'}</span>
        {isActive && parseLoading && (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        )}
      </button>
    </motion.li>
  );
}

/** "mm:ss" -> 毫秒，解析失败返回 undefined */
function parseDurationStr(s?: string): number | undefined {
  if (!s) return undefined;
  const m = /^(\d+):(\d+)$/.exec(s);
  if (!m) return undefined;
  return (Number(m[1]) * 60 + Number(m[2])) * 1000;
}

/** 通过歌曲 ID 或分享链接解析（位于搜索下方） */
function SongIdParsePanel() {
  const { parseSong, parseLoading, songIdInput, setSongIdInput } = useNcmParse();

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-2">
        <Link2 className="h-4 w-4" />
        通过歌曲 ID 或分享链接解析
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!songIdInput.trim() || parseLoading) return;
          void parseSong(songIdInput.trim(), {});
        }}
        className="flex gap-3"
      >
        <input
          value={songIdInput}
          onChange={(e) => setSongIdInput(e.target.value)}
          placeholder="输入歌曲 ID 或分享链接"
          className="min-w-0 flex-1 rounded-lg border border-line bg-card px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary"
        />
        <motion.button
          type="submit"
          disabled={parseLoading}
          {...buttonTap}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
        >
          {parseLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          解析
        </motion.button>
      </form>
    </div>
  );
}

/** 音质下拉：自定义样式 + 动画 */
function QualitySelect() {
  const { quality, setQuality } = usePlayer();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-line bg-card px-3 py-1.5 text-sm text-foreground outline-none transition-colors hover:border-primary focus:border-primary"
      >
        <span className="text-ink-3">音质</span>
        <span className="font-medium">{NCM_QUALITY_LABEL[quality]}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-ink-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute right-0 z-50 mt-1.5 min-w-[8rem] overflow-hidden rounded-md border border-line bg-card py-1 shadow-lg"
          >
            {NCM_QUALITY_ORDER.map((q) => {
              const active = q === quality;
              return (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => {
                      setQuality(q);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors hover:bg-surface-2 ${
                      active ? 'text-primary' : 'text-ink-2'
                    }`}
                  >
                    <span>{NCM_QUALITY_LABEL[q]}</span>
                    {active && <Check className="h-3.5 w-3.5" />}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

// ===== 歌单结果列表 =====
function PlaylistResultsList() {
  const { playlistDetail, playlistLoading, playlistError } = useNcmParse();
  const { track, playAll, quality } = usePlayer();
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);

  if (playlistError) return <p className="mt-2 text-sm text-red-500">{playlistError}</p>;
  if (playlistLoading && !playlistDetail) return <ListSkeleton />;
  if (!playlistDetail) {
    return <p className="mt-2 text-sm text-ink-3">输入歌单 ID 开始解析</p>;
  }

  // 构建播放列表项
  const items: PlaylistItem[] = (playlistDetail.tracks ?? []).map((t) => ({
    songId: String(t.id),
    name: t.name,
    artists: t.ar.map((a) => a.name).join(' / '),
    cover: t.al?.picUrl,
  }));

  const handlePlayAll = () => {
    if (items.length === 0) return;
    playAll(items);
  };

  const handleDownloadAll = async () => {
    if (batchDownloading || items.length === 0) return;
    setBatchDownloading(true);
    setBatchProgress({ done: 0, total: items.length, failed: 0 });
    try {
      await downloadAllAsZip(items, (p) => setBatchProgress(p), {
        quality,
        zipName: playlistDetail.name,
      });
    } catch {
      // 忽略
    } finally {
      setBatchDownloading(false);
    }
  };

  const progressPct =
    batchProgress && batchProgress.total > 0 ? (batchProgress.done / batchProgress.total) * 100 : 0;

  return (
    <div>
      {/* 歌单基础信息 + 操作按钮 */}
      <div className="mb-3 flex items-center gap-4 rounded-xl border border-line p-4">
        <Cover src={playlistDetail.coverImgUrl} alt={playlistDetail.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-foreground">{playlistDetail.name}</p>
          <p className="mt-1 text-xs text-ink-2">
            创建者：{playlistDetail.creator?.nickname ?? '未知'} · 共 {playlistDetail.trackCount} 首
          </p>
        </div>
        {/* 播放全部 + 下载全部 */}
        {items.length > 0 && (
          <div className="flex shrink-0 items-center gap-2">
            <motion.button
              type="button"
              onClick={handlePlayAll}
              {...buttonTap}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              <Play className="h-3.5 w-3.5" />
              播放全部
            </motion.button>
            <motion.button
              type="button"
              onClick={handleDownloadAll}
              disabled={batchDownloading}
              {...buttonTap}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 py-1.5 text-xs font-medium text-ink transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
            >
              {batchDownloading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              下载全部
            </motion.button>
          </div>
        )}
      </div>

      {/* 下载进度条 */}
      <AnimatePresence>
        {batchDownloading && batchProgress && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-3 overflow-hidden rounded-xl border border-line bg-surface-2 px-4 py-3"
          >
            <div className="flex items-center justify-between text-xs text-ink-2">
              <span className="truncate">
                {batchProgress.currentName ? `下载中：${batchProgress.currentName}` : '准备中…'}
              </span>
              <span className="shrink-0 pl-2">
                {batchProgress.done}/{batchProgress.total}
                {batchProgress.failed > 0 ? `（失败 ${batchProgress.failed}）` : ''}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full bg-primary transition-all duration-200"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {playlistDetail.tracks?.length > 0 ? (
        <motion.ul
          variants={listContainer}
          initial="hidden"
          animate="show"
          className="divide-y divide-line rounded-xl border border-line"
        >
          {playlistDetail.tracks.map((t, idx) => {
            const isCurrent = track?.ncmSongId === String(t.id);
            return (
              <motion.li key={t.id} variants={indexedListItem(idx)}>
                <div
                  className={`flex w-full items-center gap-4 px-4 py-3 text-left transition-colors ${
                    isCurrent ? 'bg-primary-tint' : 'hover:bg-surface-2'
                  }`}
                >
                  <Cover src={t.al?.picUrl} alt={t.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{t.name}</p>
                    <p className="truncate text-xs text-ink-2">
                      {t.ar.map((a) => a.name).join(' / ')}
                      {t.al?.name ? ` · ${t.al.name}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-ink-3">{formatMs(t.dt)}</span>
                  {/* 播放按钮 */}
                  <PlayIconButton
                    songId={String(t.id)}
                    name={t.name}
                    artists={t.ar.map((a) => a.name).join(' / ')}
                    cover={t.al?.picUrl}
                  />
                  {/* 下载按钮 */}
                  <DownloadIconButton
                    songId={String(t.id)}
                    name={t.name}
                    artists={t.ar.map((a) => a.name).join(' / ')}
                    cover={t.al?.picUrl}
                  />
                </div>
              </motion.li>
            );
          })}
        </motion.ul>
      ) : (
        <p className="text-sm text-ink-3">歌单为空</p>
      )}
    </div>
  );
}

/** 直接播放按钮（歌单项使用）：解析后直接播放，不显示大卡片 */
function PlayIconButton({
  songId,
  name,
  artists,
  cover,
}: {
  songId: string;
  name: string;
  artists: string;
  cover?: string;
}) {
  const { playNcmSong, loading: playerLoading, track } = usePlayer();
  const isCurrent = track?.ncmSongId === songId;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (playerLoading) return;
        void playNcmSong(songId, { name, artists, cover });
      }}
      disabled={playerLoading}
      title={isCurrent ? '正在播放' : '播放'}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-50 ${
        isCurrent
          ? 'bg-primary-tint text-primary'
          : 'text-ink-3 hover:bg-surface-2 hover:text-primary'
      }`}
    >
      {playerLoading && isCurrent ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Play className="h-4 w-4" />
      )}
    </button>
  );
}

/** 单曲下载按钮（歌单项使用）：解析后下载并写入元数据 */
function DownloadIconButton({
  songId,
  name,
  artists,
  cover,
}: {
  songId: string;
  name: string;
  artists: string;
  cover?: string;
}) {
  const { quality } = usePlayer();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const info = await api.parseNcmMusic(songId, quality);
      if (!info.url) throw new Error('无可用播放链接');
      await downloadMusicWithMeta(info.url, {
        title: info.name ?? name,
        artists: info.artists ?? artists,
        coverUrl: cover,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '下载失败');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void handleDownload();
      }}
      disabled={downloading}
      title={error ? `下载失败：${error}` : '下载'}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-primary disabled:opacity-50"
    >
      {downloading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
    </button>
  );
}

// ===== 解析结果区 =====
function ParseResultSection() {
  const { parsedSong, parseLoading, parseError } = useNcmParse();

  // 状态键
  const stateKey = parseError
    ? 'error'
    : parsedSong
      ? `song-${parsedSong.songId}`
      : parseLoading
        ? 'loading'
        : 'empty';

  return (
    // AutoHeight 负责整块高度补间
    <AutoHeight>
      <div className={stateKey === 'empty' ? undefined : 'pt-6'}>
        <AnimatePresence mode="popLayout" initial={false}>
          {stateKey !== 'empty' && (
            <motion.div
              key={stateKey}
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{
                opacity: 0,
                y: -32,
                transition: { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] },
              }}
              transition={{ duration: 0.34, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {parseError ? (
                <div className="rounded-2xl border border-line bg-card p-6 text-center text-sm text-red-500">
                  {parseError}
                </div>
              ) : parseLoading && !parsedSong ? (
                <CardSkeleton />
              ) : parsedSong ? (
                <ParseResultCard parsedSong={parsedSong} loading={parseLoading} />
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AutoHeight>
  );
}

function ParseResultCard({
  parsedSong,
  loading,
}: {
  parsedSong: NonNullable<ReturnType<typeof useNcmParse>['parsedSong']>;
  loading: boolean;
}) {
  const { info, songId, metaDuration, lyricLines, lyricError } = parsedSong;
  const { playNcmSong, loading: playerLoading, track, quality } = usePlayer();
  const isCurrent = track?.ncmSongId === songId;
  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError] = useState<string | null>(null);

  // 时长优先用 parse-music 返回，回退到搜索结果传入的 metaDuration
  const durationMs = info.duration ?? metaDuration ?? 0;
  // 音质标签：优先用响应回显的 level，回退到当前全局 quality
  const qualityLabel = info.level
    ? (NCM_QUALITY_LABEL[info.level as NcmQuality] ?? info.level)
    : NCM_QUALITY_LABEL[quality];

  const handleDownload = async () => {
    if (downloading || !info.url) return;
    setDownloading(true);
    setDlError(null);
    try {
      await downloadMusicWithMeta(info.url, {
        title: info.name ?? '未知歌曲',
        artists: info.artists ?? '未知歌手',
        coverUrl: info.cover,
      });
    } catch (e) {
      setDlError(e instanceof Error ? e.message : '下载失败');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      {/* 上半：封面 + 歌曲信息 */}
      <div className="flex flex-col gap-6 p-6 sm:flex-row">
        <motion.div
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
          className="shrink-0"
        >
          <Cover src={info.cover} alt={info.name ?? '未知歌曲'} size="xl" />
        </motion.div>

        <div className="min-w-0 flex-1">
          <h2 className="break-words text-2xl font-bold tracking-tight text-foreground">
            {info.name ?? '未知歌曲'}
          </h2>
          <p className="mt-2 text-sm text-ink-2">{info.artists ?? '未知歌手'}</p>

          {/* 元信息行：音质 / 时长 / 文件大小 / 音乐 ID */}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
            <span>
              音质 <span className="text-ink-2">{qualityLabel}</span>
            </span>
            {durationMs > 0 && (
              <span>
                时长 <span className="text-ink-2">{formatMs(durationMs)}</span>
              </span>
            )}
            {info.size && info.size > 0 && (
              <span>
                大小 <span className="text-ink-2">{formatSize(info.size)}</span>
              </span>
            )}
            <span>
              ID <span className="text-ink-2">{songId}</span>
            </span>
          </div>

          {!info.url && <p className="mt-2 text-sm text-red-500">无可用播放链接</p>}
          {dlError && <p className="mt-2 text-sm text-red-500">下载失败：{dlError}</p>}

          <div className="mt-4 flex items-center gap-3">
            {info.url && (
              <motion.button
                type="button"
                onClick={() =>
                  playNcmSong(songId, {
                    name: info.name,
                    artists: info.artists,
                    cover: info.cover,
                  })
                }
                disabled={playerLoading}
                {...buttonTap}
                className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                  isCurrent
                    ? 'bg-primary-tint text-primary'
                    : 'bg-primary text-primary-foreground hover:opacity-90'
                }`}
              >
                {playerLoading && isCurrent ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {isCurrent ? '正在播放' : '播放'}
              </motion.button>
            )}
            {info.url && (
              <motion.button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                {...buttonTap}
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-card px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                下载
              </motion.button>
            )}
          </div>
        </div>
      </div>

      {/* 下半：歌词 */}
      <div className="border-t border-line bg-surface-2 p-6">
        <h3 className="mb-3 text-sm font-semibold text-ink-2">歌词</h3>
        <LyricView lines={lyricLines} loading={loading} error={lyricError} />
      </div>
    </div>
  );
}

/** 字节数 -> 人类可读（MB） */
function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '--';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

/** 歌词显示：三级回退后的 LyricLine[] 静态预览 */
function LyricView({
  lines,
  loading,
  error,
}: {
  lines: LyricLine[] | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading && !lines) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="amll-skeleton h-4 w-3/4 rounded" />
        ))}
      </div>
    );
  }
  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (!lines || lines.length === 0) {
    return <p className="text-sm text-ink-3">暂无歌词</p>;
  }

  return (
    <div className="max-h-[480px] overflow-y-auto pr-2">
      <motion.ul variants={listContainer} initial="hidden" animate="show" className="space-y-2">
        {lines.map((line, i) => (
          <motion.li key={i} variants={indexedListItem(i)}>
            <p className="text-sm leading-relaxed text-foreground">
              {line.words.map((w) => w.word).join('') || '♪'}
            </p>
            {line.translatedLyric && (
              <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{line.translatedLyric}</p>
            )}
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}

// ===== 通用小组件 =====
function Cover({
  src,
  alt,
  size = 'sm',
}: {
  src?: string;
  alt: string;
  size?: 'sm' | 'lg' | 'xl';
}) {
  const dim = size === 'xl' ? 'h-40 w-40' : size === 'lg' ? 'h-16 w-16' : 'h-12 w-12';
  return src ? (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={`${dim} shrink-0 rounded-md object-cover shadow-sm`}
    />
  ) : (
    <div
      className={`${dim} flex shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-3`}
    >
      <Music className="h-5 w-5" />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="mt-4 space-y-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="amll-skeleton h-16 rounded-xl" />
      ))}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-card p-6">
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="amll-skeleton h-40 w-40 rounded-md" />
        <div className="flex-1 space-y-3 pt-2">
          <div className="amll-skeleton h-7 w-2/3 rounded" />
          <div className="amll-skeleton h-4 w-1/3 rounded" />
          <div className="amll-skeleton h-10 w-24 rounded-lg" />
        </div>
      </div>
      <div className="mt-6 border-t border-line pt-6">
        <div className="amll-skeleton mb-3 h-4 w-12 rounded" />
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="amll-skeleton h-4 rounded"
              style={{ width: `${60 + (i % 3) * 12}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
