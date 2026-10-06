import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef } from 'react';
import { audioEngine } from '$/modules/audio/audio-engine.ts';
import {
  audioEngineStateAtom,
  audioPlayingAtom,
  currentDurationAtom,
  loadedAudioAtom,
  playbackRateAtom,
} from '$/modules/audio/states/index.ts';
import { createLogger } from '$/utils/logger';
import { createSilentWavBlob } from '../utils';

export const mediaSessionLogger = createLogger('MediaSession');

export function useMediaSession() {
  const loadedAudio = useAtomValue(loadedAudioAtom);
  const isPlaying = useAtomValue(audioPlayingAtom);
  const engineState = useAtomValue(audioEngineStateAtom);
  const durationMs = useAtomValue(currentDurationAtom);
  const playbackRate = useAtomValue(playbackRateAtom);

  const prevObjectUrlRef = useRef<string | null>(null);
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);

  // 用静音 Audio 占位节点以便在暂停时显示系统媒体控件
  useEffect(() => {
    const silentBlob = createSilentWavBlob(10);
    const objectUrl = URL.createObjectURL(silentBlob);
    const audio = new Audio(objectUrl);
    audio.loop = true;
    silentAudioRef.current = audio;

    return () => {
      audio.pause();
      URL.revokeObjectURL(objectUrl);
      silentAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const audio = silentAudioRef.current;
    if (!audio) return;

    if (isPlaying) {
      void audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [isPlaying]);

  const setPositionStateOptimistically = useCallback(
    (targetTimeSec: number) => {
      if (!('mediaSession' in navigator)) return;
      if (!('setPositionState' in navigator.mediaSession)) return;

      const durationSec = durationMs / 1000;
      const rate = playbackRate > 0 ? playbackRate : 1.0;

      if (Number.isFinite(durationSec) && durationSec > 0 && Number.isFinite(targetTimeSec)) {
        try {
          const clampedPos = Math.min(Math.max(0, targetTimeSec), durationSec);
          navigator.mediaSession.setPositionState({
            duration: durationSec,
            playbackRate: rate,
            position: clampedPos,
          });
        } catch (e) {
          mediaSessionLogger.warn('Optimistic setPositionState failed', e);
        }
      }
    },
    [durationMs, playbackRate]
  );

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const actionHandlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      [
        'play',
        () => {
          void audioEngine.resumeMusic();
        },
      ],
      [
        'pause',
        () => {
          audioEngine.pauseMusic();
        },
      ],
      [
        'seekto',
        (details) => {
          if (details.seekTime !== undefined && details.seekTime !== null) {
            setPositionStateOptimistically(details.seekTime);
            audioEngine.seekMusic(details.seekTime);
          }
        },
      ],
      [
        'seekbackward',
        (details) => {
          const offset = details.seekOffset || 10;
          const target = Math.max(0, audioEngine.musicCurrentTime - offset);
          setPositionStateOptimistically(target);
          audioEngine.seekMusic(target);
        },
      ],
      [
        'seekforward',
        (details) => {
          const offset = details.seekOffset ?? 10;
          const target = Math.min(audioEngine.musicDuration, audioEngine.musicCurrentTime + offset);
          setPositionStateOptimistically(target);
          audioEngine.seekMusic(target);
        },
      ],
      [
        'stop',
        () => {
          audioEngine.pauseMusic();
          audioEngine.seekMusic(0);
        },
      ],
    ];

    for (const [action, handler] of actionHandlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // 部分浏览器或平台可能不支持某些特定动作
      }
    }

    return () => {
      for (const [action] of actionHandlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          /* 个别动作处理器不被浏览器支持，忽略即可 */
        }
      }
    };
  }, [setPositionStateOptimistically]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Update metadata when loaded audio or engine state changes
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const { titles, artists, albums, fileName } = audioEngine.audioTrackMetadata;

    const displayTitle = titles.length > 0 ? titles[0] : fileName || 'Untitled Track';
    const displayArtist = artists.length > 0 ? artists.join(' / ') : '';
    const displayAlbum = albums.length > 0 ? albums[0] : '';

    let artwork: MediaImage[] = [];
    const cover = audioEngine.cover;
    if (cover?.bytes && cover.bytes.byteLength > 0) {
      try {
        const mimeType = cover.mime || 'image/png';
        const blob = new Blob([cover.bytes], {
          type: mimeType,
        });
        const objectUrl = URL.createObjectURL(blob);
        if (prevObjectUrlRef.current) {
          URL.revokeObjectURL(prevObjectUrlRef.current);
        }
        prevObjectUrlRef.current = objectUrl;

        artwork = [
          {
            src: objectUrl,
            sizes: '512x512',
            type: mimeType,
          },
        ];
      } catch (e) {
        mediaSessionLogger.warn('Failed to create artwork Blob URL', e);
      }
    } else if (prevObjectUrlRef.current) {
      URL.revokeObjectURL(prevObjectUrlRef.current);
      prevObjectUrlRef.current = null;
    }

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: displayTitle,
        artist: displayArtist,
        album: displayAlbum,
        artwork,
      });
    } catch (e) {
      mediaSessionLogger.warn('Failed to set MediaMetadata', e);
    }
  }, [loadedAudio, engineState]);

  useEffect(() => {
    return () => {
      if (prevObjectUrlRef.current) {
        URL.revokeObjectURL(prevObjectUrlRef.current);
        prevObjectUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    if (engineState === 'idle' || engineState === 'loading') {
      navigator.mediaSession.playbackState = 'none';
    } else if (isPlaying) {
      navigator.mediaSession.playbackState = 'playing';
    } else {
      navigator.mediaSession.playbackState = 'paused';
    }
  }, [isPlaying, engineState]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!('setPositionState' in navigator.mediaSession)) return;

    const updatePosition = () => {
      const durationSec = durationMs / 1000;
      const currentPosSec = audioEngine.musicCurrentTime;
      const rate = playbackRate > 0 ? playbackRate : 1.0;

      if (Number.isFinite(durationSec) && durationSec > 0 && Number.isFinite(currentPosSec)) {
        try {
          const clampedPos = Math.min(Math.max(0, currentPosSec), durationSec);
          navigator.mediaSession.setPositionState({
            duration: durationSec,
            playbackRate: rate,
            position: clampedPos,
          });
        } catch (e) {
          mediaSessionLogger.warn('Failed to setPositionState', e);
        }
      }
    };

    updatePosition();

    audioEngine.addEventListener('timeupdate', updatePosition);
    return () => {
      audioEngine.removeEventListener('timeupdate', updatePosition);
    };
  }, [durationMs, playbackRate]);
}
