import { AnimatePresence, motion } from 'framer-motion';
import {
  ListMusic,
  Loader2,
  Mic2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lazy } from 'react';
import { PlaylistPanel } from '@/components/PlaylistPanel';
import { formatDuration } from '@/lib/format';
import { useAtomValue } from 'jotai';
import { playerActions } from '@/boot/PlayerBoot';
import {
  NCM_QUALITY_LABEL,
  NCM_QUALITY_ORDER,
  trackAtom,
  playingAtom,
  currentAtom,
  durationAtom,
  loadingAtom,
  errorAtom,
  selectRequestAtom,
  shuffleAtom,
  repeatModeAtom,
  volumeAtom,
  mutedAtom,
  lyricDataAtom,
  playlistAtom,
  qualityAtom,
  type NcmQuality,
  type RepeatMode,
} from '@/atoms/player';

const LyricsPage = lazy(() =>
  import('@/components/LyricsPage').then((m) => ({ default: m.LyricsPage }))
);

/**
 * 拖拽期间挂在 window 上的 mousemove/mouseup 监听器管理。
 * 正常路径在 mouseup 时移除；组件在拖拽中途被卸载时由 effect 兜底移除，防止监听器泄漏
 */
function useDragListeners() {
  const cleanersRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    const cleaners = cleanersRef.current;
    return () => {
      cleaners.forEach((fn) => fn());
      cleaners.length = 0;
    };
  }, []);

  const add = useCallback((move: (ev: MouseEvent) => void, up: () => void) => {
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    const remove = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const i = cleanersRef.current.indexOf(remove);
      if (i >= 0) cleanersRef.current.splice(i, 1);
    };
    cleanersRef.current.push(remove);
    return remove;
  }, []);

  return { add };
}

function RepeatIcon({ mode }: { mode: RepeatMode }) {
  if (mode === 'one') return <Repeat1 className="h-4 w-4" />;
  return <Repeat className="h-4 w-4" />;
}

// 控制按钮：hover 放大、点击缩放反馈
const ctrlBtn =
  'inline-flex items-center justify-center rounded-full transition-transform duration-150 hover:scale-110 active:scale-90';

/** 多网易云 ID 选择弹窗 */
export function NcmSelectDialog() {
  const selectRequest = useAtomValue(selectRequestAtom);
  const { resolveSelect } = playerActions;
  return (
    <AnimatePresence>
      {selectRequest && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 px-4"
          onClick={() => resolveSelect(null)}
        >
          <motion.div
            initial={{ scale: 0.96, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="w-full max-w-md rounded-lg border border-line bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-foreground">选择网易云歌曲 ID</h3>
            <p className="mt-1 text-sm text-ink-2">该歌曲有多个网易云 ID，请选择要播放的版本：</p>
            {/* ID 过多时限制高度内部滚动 */}
            <ul className="mt-3 max-h-[50vh] space-y-1.5 overflow-y-auto pr-1">
              {selectRequest.ids.map((id, idx) => (
                <li key={`${id}-${idx}`}>
                  <button
                    type="button"
                    onClick={() => resolveSelect(id)}
                    className="block w-full rounded-md border border-input bg-surface-2 px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-primary-tint hover:text-primary"
                  >
                    <span className="font-mono">{id}</span>
                    {idx === 0 && <span className="ml-2 text-[10px] text-ink-3">（首选）</span>}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => resolveSelect(null)}
                className="rounded-md px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-surface-2"
              >
                取消
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** 音量控制 */
function VolumeControl() {
  const volume = useAtomValue(volumeAtom);
  const muted = useAtomValue(mutedAtom);
  const { setVolume, toggleMute } = playerActions;
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const drag = useDragListeners();

  const displayVolume = muted ? 0 : volume;
  const showSlider = hovering || dragging;

  // 竖直滑块：顶部=最大值，底部=0
  const handleSeek = (clientY: number) => {
    const el = sliderRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    setVolume(ratio);
  };

  return (
    <div
      className="relative flex items-center"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div
        className={`absolute bottom-full left-1/2 -translate-x-1/2 pb-2 transition-all duration-200 ${
          showSlider
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-1 opacity-0'
        }`}
      >
        {/* 卡片背景 */}
        <div className="rounded-lg bg-card/95 p-1.5 shadow-lg ring-1 ring-line backdrop-blur-md">
          <div
            ref={sliderRef}
            className="relative flex h-28 w-6 cursor-pointer items-center justify-center"
            onClick={(e) => handleSeek(e.clientY)}
            onMouseDown={(e) => {
              e.preventDefault();
              setDragging(true);
              handleSeek(e.clientY);
              const move = (ev: MouseEvent) => handleSeek(ev.clientY);
              const up = () => {
                setDragging(false);
                stop();
              };
              const stop = drag.add(move, up);
            }}
          >
            {/* 滑轨 */}
            <div className="relative h-full w-1.5 rounded-full bg-surface-2">
              {/* 已填充部分 */}
              <div
                className="absolute bottom-0 left-0 w-full rounded-full bg-primary pointer-events-none"
                style={{ height: `${displayVolume * 100}%` }}
              />
              {/* 拖拽手柄 */}
              <div
                className="absolute left-1/2 h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-full bg-primary shadow-md ring-2 ring-card pointer-events-none"
                style={{ bottom: `${displayVolume * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 音量图标 */}
      <button
        type="button"
        onClick={toggleMute}
        className={`${ctrlBtn} relative z-10 h-8 w-8 text-ink-3 hover:text-foreground`}
        title={muted ? '取消静音' : '静音'}
      >
        {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** 音质选择按钮：点击弹出下拉菜单选择音质，切换后保持进度 */
function QualityControl() {
  const quality = useAtomValue(qualityAtom);
  const track = useAtomValue(trackAtom);
  const { reloadWithQuality } = playerActions;
  const [open, setOpen] = useState(false);
  if (!track) return null;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full border border-line bg-surface-2/60 px-2.5 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:border-primary hover:text-primary"
        title="切换音质"
      >
        {NCM_QUALITY_LABEL[quality as NcmQuality]}
      </button>
      <AnimatePresence>
        {open && (
          <>
            {/* 透明遮罩：点击外部关闭 */}
            <div className="fixed inset-0 z-[160]" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-full left-1/2 z-[170] mb-2 -translate-x-1/2 rounded-lg border border-line bg-card p-1 shadow-lg"
            >
              {NCM_QUALITY_ORDER.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={async () => {
                    setOpen(false);
                    if (q !== quality) {
                      await reloadWithQuality(q);
                    }
                  }}
                  className={`block w-full whitespace-nowrap rounded px-3 py-1.5 text-left text-xs transition-colors hover:bg-primary-tint hover:text-primary ${
                    q === quality ? 'text-primary' : 'text-ink-2'
                  }`}
                >
                  {NCM_QUALITY_LABEL[q]}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 播放器底栏（浅色主题） */
export function PlayerBar() {
  // 按需订阅各自 atom：current 高频更新（timeupdate），不再连带重渲染无关组件
  const track = useAtomValue(trackAtom);
  const playing = useAtomValue(playingAtom);
  const current = useAtomValue(currentAtom);
  const duration = useAtomValue(durationAtom);
  const loading = useAtomValue(loadingAtom);
  const error = useAtomValue(errorAtom);
  const shuffle = useAtomValue(shuffleAtom);
  const repeatMode = useAtomValue(repeatModeAtom);
  const lyricData = useAtomValue(lyricDataAtom);
  const playlist = useAtomValue(playlistAtom);
  const {
    toggle,
    seek,
    close,
    toggleShuffle,
    cycleRepeatMode,
    openLyricsPage,
    playNext,
    playPrev,
    togglePlaylistPanel,
  } = playerActions;
  const drag = useDragListeners();

  const progress = duration > 0 ? (current / duration) * 100 : 0;

  // 根据播放进度查找当前歌词行
  const currentLyric = useMemo(() => {
    if (!playing) return null;
    if (!lyricData || lyricData.length === 0) return null;
    const currentMs = current * 1000;
    let activeIndex = -1;
    for (let i = 0; i < lyricData.length; i++) {
      const entry = lyricData[i];
      if (entry && entry.startTime <= currentMs) {
        activeIndex = i;
      } else {
        break;
      }
    }
    if (activeIndex === -1) return null;
    const line = lyricData[activeIndex];
    if (!line) return null;
    const text = line.words
      .map((w) => w.word)
      .join('')
      .trim();
    if (!text) return null;
    return { index: activeIndex, text };
  }, [lyricData, current, playing]);

  return (
    <AnimatePresence>
      {track && (
        <motion.div
          initial={{ y: 90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 90, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
          className="fixed bottom-0 left-0 right-0 z-[150] border-t border-line bg-card/80 backdrop-blur-xl backdrop-saturate-150"
          style={{ backdropFilter: 'blur(24px) saturate(1.8)' }}
        >
          {/* 顶部进度条 */}
          <div
            className="group relative h-[3px] cursor-pointer bg-surface-2"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (e.clientX - rect.left) / rect.width;
              seek(ratio * duration);
            }}
            onMouseDown={(e) => {
              if (duration <= 0) return;
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              const seekToClientX = (clientX: number) => {
                const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                seek(ratio * duration);
              };
              seekToClientX(e.clientX);
              const move = (ev: MouseEvent) => seekToClientX(ev.clientX);
              const up = () => {
                stop();
              };
              const stop = drag.add(move, up);
            }}
          >
            <div
              className="absolute left-0 top-0 h-full bg-primary transition-[width] duration-150"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
              style={{ left: `${progress}%` }}
            />
          </div>

          {/* 控制区域 */}
          <div className="mx-auto flex h-[68px] max-w-[1400px] items-center gap-4 px-6">
            {/* ===== 左侧：封面 + 信息 + 操作 ===== */}
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {/* 封面 */}
              <button
                type="button"
                onClick={openLyricsPage}
                className="group relative h-11 w-11 shrink-0 overflow-hidden rounded-[4px] transition-transform duration-200 hover:scale-105 active:scale-95"
                title="查看歌词"
              >
                {track.cover ? (
                  <img
                    src={track.cover}
                    alt={track.title}
                    className="h-full w-full object-cover transition-[filter,transform] duration-300 group-hover:scale-110 group-hover:blur-[2px]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-surface-2">
                    <Play className="h-4 w-4 text-ink-3" />
                  </div>
                )}
                {/* 悬浮遮罩 + 歌词图标 */}
                <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 backdrop-blur-[1px] transition-opacity duration-300 group-hover:opacity-100">
                  <Mic2 className="h-4 w-4 text-white drop-shadow" />
                </span>
              </button>

              {/* 歌曲信息 */}
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{track.title}</div>
                {/* 歌词翻页动画 */}
                <div className="h-[16px] overflow-hidden text-xs text-ink-2">
                  <AnimatePresence mode="wait">
                    {currentLyric ? (
                      <motion.div
                        key={currentLyric.index}
                        initial={{ y: 16, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -16, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                        className="truncate"
                      >
                        {currentLyric.text}
                      </motion.div>
                    ) : (
                      <motion.div
                        key="artist"
                        initial={{ y: 16, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -16, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                        className="truncate"
                      >
                        {track.artists}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* ===== 中间：播放控制 ===== */}
            <div className="flex shrink-0 items-center gap-3">
              {/* 随机 */}
              <button
                type="button"
                onClick={toggleShuffle}
                className={`${ctrlBtn} h-8 w-8 ${
                  shuffle ? 'text-primary' : 'text-ink-3 hover:text-foreground'
                }`}
                title="随机播放"
              >
                <Shuffle className="h-4 w-4" />
              </button>

              {/* 上一首 */}
              <button
                type="button"
                onClick={playPrev}
                className={`${ctrlBtn} h-8 w-8 text-ink-2 hover:text-foreground`}
                title="上一首"
              >
                <SkipBack className="h-5 w-5" />
              </button>

              {/* 播放/暂停 */}
              <button
                type="button"
                onClick={toggle}
                disabled={loading}
                className={`${ctrlBtn} h-10 w-10 bg-primary text-primary-foreground hover:bg-primary-hover hover:scale-110 active:scale-90 disabled:opacity-50`}
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : playing ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5 translate-x-0.5" />
                )}
              </button>

              {/* 下一首 */}
              <button
                type="button"
                onClick={() => playNext()}
                className={`${ctrlBtn} h-8 w-8 text-ink-2 hover:text-foreground`}
                title="下一首"
              >
                <SkipForward className="h-5 w-5" />
              </button>

              {/* 循环 */}
              <button
                type="button"
                onClick={cycleRepeatMode}
                className={`${ctrlBtn} h-8 w-8 ${
                  repeatMode !== 'off' ? 'text-primary' : 'text-ink-3 hover:text-foreground'
                }`}
                title={repeatMode === 'one' ? '单曲循环' : '列表循环'}
              >
                <RepeatIcon mode={repeatMode} />
              </button>
            </div>

            {/* ===== 右侧：音质 + 时间 + 音量 + 关闭 ===== */}
            <div className="flex flex-1 items-center justify-end gap-4">
              {/* 音质 */}
              <div className="hidden shrink-0 sm:block">
                <QualityControl />
              </div>

              {/* 时间 */}
              <div className="hidden shrink-0 items-center gap-1 text-xs text-ink-3 sm:flex">
                {error ? (
                  <span className="text-error" title={error}>
                    播放出错
                  </span>
                ) : (
                  <>
                    {/* formatDuration 收毫秒，播放器的 current/duration 是秒 */}
                    <span>{formatDuration(current * 1000)}</span>
                    <span>/</span>
                    <span>{formatDuration(duration * 1000)}</span>
                  </>
                )}
              </div>

              {/* 音量 */}
              <div className="hidden sm:block">
                <VolumeControl />
              </div>

              {/* 播放队列 */}
              <button
                type="button"
                onClick={togglePlaylistPanel}
                className={`${ctrlBtn} relative hidden h-8 w-8 text-ink-3 hover:text-foreground sm:inline-flex`}
                title="播放列表"
              >
                <ListMusic className="h-4 w-4" />
                {playlist.length > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-ink-3 px-1 text-[9px] font-medium text-white shadow-sm">
                    {playlist.length}
                  </span>
                )}
              </button>

              {/* 关闭 */}
              <button
                type="button"
                onClick={close}
                className={`${ctrlBtn} h-7 w-7 text-ink-3 hover:text-foreground`}
                aria-label="关闭播放器"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** 播放器套件：底栏 + 选择弹窗 + 歌词页 + 播放列表 */
export function Player() {
  return (
    <>
      <PlayerBar />
      <NcmSelectDialog />
      <PlaylistPanel />
      <Suspense fallback={null}>
        <LyricsPage />
      </Suspense>
    </>
  );
}
