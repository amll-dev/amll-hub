import {
  AudioQualityType,
  hideLyricViewAtom,
  isLyricPageOpenedAtom,
  musicArtistsAtom,
  musicCoverAtom,
  musicDurationAtom,
  musicLyricLinesAtom,
  musicNameAtom,
  musicPlayingAtom,
  musicPlayingPositionAtom,
  musicQualityAtom,
  musicQualityTagAtom,
  musicVolumeAtom,
  onChangeVolumeAtom,
  onClickControlThumbAtom,
  onCycleRepeatModeAtom,
  onLyricLineClickAtom,
  onPlayOrResumeAtom,
  onRequestNextSongAtom,
  onRequestPrevSongAtom,
  onSeekPositionAtom,
  onToggleShuffleAtom,
  PrebuiltLyricPlayer,
  repeatModeAtom,
  isShuffleActiveAtom,
} from '@applemusic-like-lyrics/react-full';
import '@applemusic-like-lyrics/core/style.css';
import '@applemusic-like-lyrics/react-full/style.css';
import type { LyricLineMouseEvent } from '@applemusic-like-lyrics/core';
import { useAtom, useAtomValue, useStore } from 'jotai';
import { type FC, useCallback, useEffect, useRef, useState } from 'react';
import { lyricErrorAtom } from '@/atoms/player';
import { playerActions } from '@/boot/PlayerBoot';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { NCM_QUALITY_LABEL, usePlayer, type NcmQuality } from '@/hooks/usePlayer';

/** 将回调包装为 AMLL 期望的 { onEmit } 结构 */
const toEmit = <T,>(onEmit: T) => ({ onEmit });

const PlayerStateSync: FC = () => {
  const {
    track,
    playing,
    current,
    duration,
    volume,
    muted,
    shuffle,
    repeatMode,
    quality,
    toggle,
    seek,
    setVolume,
    toggleShuffle,
    cycleRepeatMode,
    playNext,
    playPrev,
    lyricData,
  } = usePlayer();
  const store = useStore();

  // 同步歌曲基础信息
  useEffect(() => {
    if (!track) return;
    store.set(musicNameAtom, track.title);
    store.set(
      musicArtistsAtom,
      track.artists.split(' / ').map((name) => ({ name, id: name }))
    );
    store.set(musicCoverAtom, track.cover ?? '');
  }, [track, store]);

  // 同步歌词
  useEffect(() => {
    if (!lyricData) return;
    store.set(musicLyricLinesAtom, lyricData as never);
  }, [lyricData, store]);

  // 同步播放状态
  useEffect(() => {
    store.set(musicPlayingAtom, playing);
  }, [playing, store]);

  // 同步总时长（秒 -> 毫秒）
  useEffect(() => {
    store.set(musicDurationAtom, (duration * 1000) | 0);
  }, [duration, store]);

  // 同步音量
  useEffect(() => {
    store.set(musicVolumeAtom, muted ? 0 : volume);
  }, [volume, muted, store]);

  // 同步循环模式（PlayerContext 的 RepeatMode 字符串与 AMLL RepeatMode enum 值一致）
  useEffect(() => {
    store.set(repeatModeAtom, repeatMode as never);
  }, [repeatMode, store]);

  // 同步随机
  useEffect(() => {
    store.set(isShuffleActiveAtom, shuffle);
  }, [shuffle, store]);

  // 同步音质信息
  useEffect(() => {
    if (!track) {
      store.set(musicQualityAtom, {
        type: AudioQualityType.None,
        codec: '',
        channels: 0,
        sampleRate: 0,
        sampleFormat: '',
      });
      store.set(musicQualityTagAtom, null);
      return;
    }
    const q2type: Record<NcmQuality, AudioQualityType> = {
      standard: AudioQualityType.Standard,
      exhigh: AudioQualityType.Standard,
      lossless: AudioQualityType.Lossless,
      hires: AudioQualityType.HiResLossless,
      jyeffect: AudioQualityType.HiResLossless,
      jymaster: AudioQualityType.HiResLossless,
      sky: AudioQualityType.HiResLossless,
      dolby: AudioQualityType.DolbyAtmos,
    };
    const q2codec: Record<NcmQuality, string> = {
      standard: 'MP3',
      exhigh: 'MP3',
      lossless: 'FLAC',
      hires: 'FLAC',
      jyeffect: 'FLAC',
      jymaster: 'FLAC',
      sky: 'FLAC',
      dolby: 'E-AC-3 JOC',
    };
    const type = q2type[quality] ?? AudioQualityType.None;
    store.set(musicQualityAtom, {
      type,
      codec: q2codec[quality] ?? '',
      channels: 2,
      sampleRate: 44100,
      sampleFormat: 'S16',
    });
    if (type === AudioQualityType.None || type === AudioQualityType.Standard) {
      store.set(musicQualityTagAtom, null);
    } else {
      store.set(musicQualityTagAtom, {
        tagIcon: true,
        tagText: NCM_QUALITY_LABEL[quality],
        isDolbyAtmos: type === AudioQualityType.DolbyAtmos,
      });
    }
  }, [track, quality, store]);

  // 用 rAF 循环同步进度
  const lastSyncRef = useRef({ position: 0, timestamp: 0 });
  useEffect(() => {
    let rafId: number;
    const updateLoop = () => {
      const isPlaying = store.get(musicPlayingAtom);
      const now = performance.now();
      if (isPlaying) {
        const dt = (now - lastSyncRef.current.timestamp) / 1000;
        const newPos = lastSyncRef.current.position + dt;
        const dur = store.get(musicDurationAtom) / 1000;
        const clampedPos = dur > 0 ? Math.min(newPos, dur) : newPos;
        store.set(musicPlayingPositionAtom, (clampedPos * 1000) | 0);
      } else {
        lastSyncRef.current = {
          position: store.get(musicPlayingPositionAtom) / 1000,
          timestamp: now,
        };
      }
      rafId = requestAnimationFrame(updateLoop);
    };
    rafId = requestAnimationFrame(updateLoop);
    return () => cancelAnimationFrame(rafId);
  }, [store]);

  // 当 PlayerContext 的 current 变化时，更新基准位置
  useEffect(() => {
    lastSyncRef.current = {
      position: current,
      timestamp: performance.now(),
    };
    store.set(musicPlayingPositionAtom, (current * 1000) | 0);
  }, [current, store]);

  // 绑定交互回调
  useEffect(() => {
    store.set(
      onPlayOrResumeAtom,
      toEmit(() => toggle())
    );
    store.set(
      onSeekPositionAtom,
      toEmit((ms: number) => {
        const targetPos = ms / 1000;
        lastSyncRef.current = {
          position: targetPos,
          timestamp: performance.now(),
        };
        store.set(musicPlayingPositionAtom, ms);
        seek(targetPos);
      })
    );
    store.set(
      onLyricLineClickAtom,
      // AMLL 提供的歌词行点击事件类型
      toEmit((evt: LyricLineMouseEvent) => {
        const targetMs: number = evt.line.getLine().startTime;
        const targetPos = targetMs / 1000;
        lastSyncRef.current = {
          position: targetPos,
          timestamp: performance.now(),
        };
        store.set(musicPlayingPositionAtom, targetMs);
        seek(targetPos);
      })
    );
    store.set(
      onChangeVolumeAtom,
      toEmit((v: number) => setVolume(v))
    );
    store.set(
      onCycleRepeatModeAtom,
      toEmit(() => cycleRepeatMode())
    );
    store.set(
      onToggleShuffleAtom,
      toEmit(() => toggleShuffle())
    );
    store.set(
      onRequestNextSongAtom,
      toEmit(() => playNext())
    );
    store.set(
      onRequestPrevSongAtom,
      toEmit(() => playPrev())
    );
    // 点击封面/缩略图关闭歌词页
    store.set(
      onClickControlThumbAtom,
      toEmit(() => store.set(isLyricPageOpenedAtom, false))
    );
    return () => {
      const noop = toEmit(() => {});
      store.set(onPlayOrResumeAtom, noop);
      store.set(onSeekPositionAtom, noop);
      store.set(onLyricLineClickAtom, noop);
      store.set(onChangeVolumeAtom, noop);
      store.set(onCycleRepeatModeAtom, noop);
      store.set(onToggleShuffleAtom, noop);
      store.set(onRequestNextSongAtom, noop);
      store.set(onRequestPrevSongAtom, noop);
      store.set(onClickControlThumbAtom, noop);
    };
  }, [toggle, seek, setVolume, cycleRepeatMode, toggleShuffle, playNext, playPrev, store]);

  return null;
};

/** 右键菜单行：左侧文案，右侧灰字快捷键提示 */
const MenuRow: FC<{ label: string; shortcut?: string; onSelect: () => void }> = ({
  label,
  shortcut,
  onSelect,
}) => (
  <ContextMenuItem
    onSelect={onSelect}
    className="flex cursor-default items-center justify-between gap-8 rounded-md px-3 py-2.5 text-[14px] text-[#1c1c1e] outline-none focus:bg-[#ededf0] focus:text-[#1c1c1e]"
  >
    <span className="whitespace-nowrap">{label}</span>
    {shortcut && (
      <span className="shrink-0 text-[12px] tracking-wide text-[#8e8e93]">{shortcut}</span>
    )}
  </ContextMenuItem>
);

/** 歌词页面 */
export function LyricsPage() {
  const isLyricPageOpened = useAtomValue(isLyricPageOpenedAtom);
  const [hideLyricView, setHideLyricView] = useAtom(hideLyricViewAtom);
  const lyricError = useAtomValue(lyricErrorAtom);
  const store = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 全屏状态跟随浏览器（F11 / Esc 退出全屏都能同步）
  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement));
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const action = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    void action.catch(() => {
      // 浏览器拒绝（非用户手势等）时保持原状
    });
  }, []);

  // 关闭歌词页（全屏态一并退出，避免留在全屏的黑屏上）
  const closeLyricPage = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    store.set(isLyricPageOpenedAtom, false);
  }, [store]);

  // Esc 关闭歌词页；Ctrl Alt ←/P/→ 上一首/暂停/下一首
  // F11 交给浏览器原生全屏，Web 端无法拦截也不该拦截，只在菜单里作为提示
  useEffect(() => {
    if (!isLyricPageOpened) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 菜单打开时 Esc 只关菜单
        if (menuOpen) return;
        e.preventDefault();
        closeLyricPage();
        return;
      }
      if (!e.ctrlKey || !e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'arrowleft') {
        e.preventDefault();
        playerActions.playPrev();
      } else if (key === 'arrowright') {
        e.preventDefault();
        playerActions.playNext();
      } else if (key === 'p') {
        e.preventDefault();
        playerActions.toggle();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLyricPageOpened, menuOpen, closeLyricPage]);

  return (
    <>
      <PlayerStateSync />
      <ContextMenu onOpenChange={setMenuOpen}>
        <ContextMenuTrigger asChild>
          <div
            className={`fixed inset-0 z-[180] overflow-hidden bg-black text-white transition-transform duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] ${
              isLyricPageOpened
                ? 'pointer-events-auto translate-y-0'
                : 'pointer-events-none translate-y-full'
            }`}
          >
            {/* 错误提示 */}
            {lyricError && (
              <div className="fixed left-1/2 top-6 z-[200] -translate-x-1/2 rounded-full bg-red-500/20 px-4 py-2 text-sm text-red-200 backdrop-blur-md">
                {lyricError}
              </div>
            )}

            {/* AMLL 播放器 */}
            <PrebuiltLyricPlayer id="amll-lyric-player" style={{ width: '100%', height: '100%' }} />
          </div>
        </ContextMenuTrigger>

        {/* 歌词页右键菜单 */}
        <ContextMenuContent className="z-[300] min-w-[208px] rounded-xl border-0 bg-white p-1.5 text-[#1c1c1e] shadow-[0_14px_40px_-12px_rgba(0,0,0,0.6)]">
          <MenuRow label="上一首" shortcut="Ctrl Alt ←" onSelect={() => playerActions.playPrev()} />
          <MenuRow
            label="暂停 / 继续"
            shortcut="Ctrl Alt P"
            onSelect={() => playerActions.toggle()}
          />
          <MenuRow label="下一首" shortcut="Ctrl Alt →" onSelect={() => playerActions.playNext()} />

          <ContextMenuSeparator className="mx-2 my-1 h-px bg-black/10" />

          <MenuRow
            label={hideLyricView ? '显示歌词' : '隐藏歌词'}
            onSelect={() => setHideLyricView(!hideLyricView)}
          />
          <MenuRow
            label={isFullscreen ? '退出全屏' : '进入全屏'}
            shortcut="F11"
            onSelect={toggleFullscreen}
          />

          <ContextMenuSeparator className="mx-2 my-1 h-px bg-black/10" />

          <MenuRow label="退出歌词页面" onSelect={closeLyricPage} />
        </ContextMenuContent>
      </ContextMenu>
    </>
  );
}
