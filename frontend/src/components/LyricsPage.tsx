import {
  AudioQualityType,
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
import { useAtomValue, useStore } from 'jotai';
import { type FC, useEffect, useRef } from 'react';
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

/** 歌词页面 */
export function LyricsPage() {
  const isLyricPageOpened = useAtomValue(isLyricPageOpenedAtom);
  const store = useStore();
  const { lyricError } = usePlayer();

  // Esc 关闭歌词页
  useEffect(() => {
    if (!isLyricPageOpened) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        store.set(isLyricPageOpenedAtom, false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLyricPageOpened, store]);

  return (
    <>
      <PlayerStateSync />
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
    </>
  );
}
