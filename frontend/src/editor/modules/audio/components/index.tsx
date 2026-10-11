/*
 * Copyright 2023-2025 Steve Xiao (stevexmh@qq.com) and contributors.
 *
 * 本源代码文件是属于 AMLL TTML Tool 项目的一部分。
 * This source code file is a part of AMLL TTML Tool project.
 * 本项目的源代码的使用受到 GNU GENERAL PUBLIC LICENSE version 3 许可证的约束，具体可以参阅以下链接。
 * Use of this source code is governed by the GNU GPLv3 license that can be found through the following link.
 *
 * https://github.com/amll-dev/amll-ttml-tool/blob/main/LICENSE
 */

import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { ChevronDown, ChevronUp, Loader2, LocateFixed, Pause, Play, Volume2 } from 'lucide-react';
import { type FC, memo, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Slider } from '@/components/ui/slider';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { audioEngine } from '$/modules/audio/audio-engine';
import { AudioSlider } from '$/modules/audio/components/AudioSlider';
import { useBpmControl } from '$/modules/audio/hooks';
import {
  audioEngineStateAtom,
  audioPlayingAtom,
  currentDurationAtom,
  playbackRateAtom,
  volumeAtom,
} from '$/modules/audio/states';
import { AuditionKeyBinding } from '$/modules/keyboard/components/AuditionKeyBinding';
import { AudioSpectrogram } from '$/modules/spectrogram/components/AudioSpectrogram';
import {
  keyPlaybackRateDownAtom,
  keyPlaybackRateResetAtom,
  keyPlaybackRateUpAtom,
  keyPlayPauseAtom,
  keySeekBackwardAtom,
  keySeekForwardAtom,
  keyVolumeDownAtom,
  keyVolumeUpAtom,
} from '$/states/keybindings.ts';
import { locateActionAtom, lyricLinesAtom } from '$/states/main.ts';
import { openTabAtom } from '$/states/sidebar.ts';
import { useKeyBindingAtom } from '$/utils/keybindings.ts';
import { msToTimestamp } from '@/lib/format';

const AudioPlaybackKeyBinding = memo(() => {
  const store = useStore();

  useKeyBindingAtom(keyPlayPauseAtom, () => {
    if (audioEngine.musicPlaying) audioEngine.pauseMusic();
    else audioEngine.resumeMusic();
  }, []);

  useKeyBindingAtom(keySeekForwardAtom, () => {
    audioEngine.seekMusic(Math.min(audioEngine.musicCurrentTime + 5, audioEngine.musicDuration));
  }, []);

  useKeyBindingAtom(keySeekBackwardAtom, () => {
    audioEngine.seekMusic(Math.max(audioEngine.musicCurrentTime - 5, 0));
  }, []);

  useKeyBindingAtom(keyVolumeUpAtom, () => {
    store.set(volumeAtom, (v) => Math.min(1, v + 0.1));
  }, [store]);

  useKeyBindingAtom(keyVolumeDownAtom, () => {
    store.set(volumeAtom, (v) => Math.max(0, v - 0.1));
  }, [store]);

  useKeyBindingAtom(keyPlaybackRateUpAtom, () => {
    store.set(playbackRateAtom, (v) => Math.min(4, v + 0.25));
  }, [store]);

  useKeyBindingAtom(keyPlaybackRateDownAtom, () => {
    store.set(playbackRateAtom, (v) => Math.max(0.25, v - 0.25));
  }, [store]);

  useKeyBindingAtom(keyPlaybackRateResetAtom, () => {
    store.set(playbackRateAtom, 1);
  }, [store]);

  return null;
});

const CurrentTimeDisplay = memo(() => {
  const timeRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let lastRenderedText = '';
    const updateTime = (timeInSeconds: number) => {
      if (!timeRef.current) return;
      const text = msToTimestamp(timeInSeconds * 1000);

      if (text !== lastRenderedText) {
        timeRef.current.textContent = text;
        lastRenderedText = text;
      }
    };

    updateTime(audioEngine.musicCurrentTime);

    audioEngine.onTimeUpdate(updateTime);
    return () => audioEngine.offTimeUpdate(updateTime);
  }, []);

  return (
    <span ref={timeRef} className="text-left text-sm tabular-nums" style={{ minWidth: '5.5em' }}>
      00:00.000
    </span>
  );
});

export const AudioControls: FC = memo(() => {
  const [spectrogramVisible, setSpectrogramVisible] = useState(false);
  const currentDuration = useAtomValue(currentDurationAtom);
  const engineState = useAtomValue(audioEngineStateAtom);
  const { bpmState, currentBpm } = useBpmControl();
  const [audioPlaying, _setAudioPlaying] = useAtom(audioPlayingAtom);
  const [volume, setVolume] = useAtom(volumeAtom);
  const [playbackRate, setPlaybackRate] = useAtom(playbackRateAtom);
  const { lyricLines } = useAtomValue(lyricLinesAtom);
  const openTab = useSetAtom(openTabAtom);

  const setLocateAction = useSetAtom(locateActionAtom);

  const handleLocate = useCallback(() => {
    setLocateAction((c) => c + 1);
  }, [setLocateAction]);

  const audioLoaded =
    engineState === 'ready' || engineState === 'playing' || engineState === 'paused';
  const onTogglePlay = useCallback(() => {
    if (audioEngine.musicPlaying) {
      audioEngine.pauseMusic();
    } else {
      audioEngine.resumeMusic();
    }
  }, []);

  useEffect(() => {
    setVolume(audioEngine.volume);
    setPlaybackRate(audioEngine.musicPlayBackRate);

    const onVolumeChange = () => setVolume(audioEngine.volume);
    audioEngine.addEventListener('volume-change', onVolumeChange);

    return () => {
      audioEngine.removeEventListener('volume-change', onVolumeChange);
    };
  }, [setVolume, setPlaybackRate]);

  useEffect(() => {
    audioEngine.volume = volume;
  }, [volume]);

  useEffect(() => {
    audioEngine.musicPlayBackRate = playbackRate;
  }, [playbackRate]);

  return (
    <div className="mx-2 mb-2 overflow-hidden rounded-lg border border-line bg-card">
      <AudioPlaybackKeyBinding />
      <AuditionKeyBinding />
      <div className="flex flex-col">
        <div style={{ display: spectrogramVisible ? 'flex' : 'none' }}>
          <AudioSpectrogram />
        </div>
        <div className="flex items-center gap-x-2 px-2">
          <HoverCard openDelay={200} closeDelay={100}>
            <HoverCardTrigger asChild>
              <Button variant="secondary" size="icon" className="my-2 size-7 shrink-0" title="音量">
                <Volume2 className="size-4" />
              </Button>
            </HoverCardTrigger>
            <HoverCardContent className="w-auto">
              <div className="grid grid-cols-[auto_7em_2em] items-baseline gap-2">
                <span className="whitespace-nowrap">音量</span>
                <Slider
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onValueChange={(v) => setVolume(v)}
                />
                <span className="whitespace-nowrap text-xs text-ink-3">
                  {(volume * 100).toFixed()}%
                </span>
                <span className="whitespace-nowrap">播放速度</span>
                <Slider
                  min={0.1}
                  max={2}
                  step={0.05}
                  value={playbackRate}
                  onValueChange={(v) => setPlaybackRate(v)}
                />
                <span className="whitespace-nowrap text-xs text-ink-3">
                  {playbackRate.toFixed(2)}x
                </span>
                <span className="whitespace-nowrap">BPM</span>
                <div className="flex items-center">
                  {bpmState.status === 'analyzing' && (
                    <Button variant="secondary" className="h-6 px-2" onClick={() => openTab('bpm')}>
                      <Loader2 className="size-3.5 animate-spin" />
                    </Button>
                  )}
                  {bpmState.status === 'completed' && (
                    <Button
                      variant="secondary"
                      className="h-6 px-2 text-xs"
                      onClick={() => openTab('bpm')}
                    >
                      {currentBpm ?? Math.round(bpmState.result.bpm)}
                    </Button>
                  )}
                  {bpmState.status === 'error' && (
                    <Button
                      variant="destructive"
                      className="h-6 px-2 text-xs"
                      onClick={() => openTab('bpm')}
                    >
                      错误
                    </Button>
                  )}
                  {bpmState.status === 'idle' && (
                    <Button
                      variant="secondary"
                      className="h-6 px-2 text-xs"
                      onClick={() => openTab('bpm')}
                    >
                      -
                    </Button>
                  )}
                </div>
                <span />
              </div>
            </HoverCardContent>
          </HoverCard>
          <SimpleTooltip label="暂停 / 播放音乐">
            <Button
              variant="secondary"
              size="icon"
              className="my-2 size-7 shrink-0"
              disabled={!audioLoaded}
              onClick={onTogglePlay}
            >
              {audioPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
          </SimpleTooltip>
          <CurrentTimeDisplay />
          <AudioSlider />
          <span className="text-sm" style={{ minWidth: '5.5em' }}>
            {msToTimestamp(currentDuration)}
          </span>
          <SimpleTooltip label="定位">
            <Button
              variant="secondary"
              size="icon"
              className="my-2 size-7 shrink-0"
              onClick={handleLocate}
              disabled={lyricLines.length === 0}
            >
              <LocateFixed className="size-[18px]" />
            </Button>
          </SimpleTooltip>
          <SimpleTooltip label="展开 / 收起频谱图">
            <Button
              variant="secondary"
              size="icon"
              className="my-2 size-7 shrink-0"
              onClick={() => setSpectrogramVisible(!spectrogramVisible)}
            >
              {spectrogramVisible ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronUp className="size-4" />
              )}
            </Button>
          </SimpleTooltip>
        </div>
      </div>
    </div>
  );
});

export default AudioControls;
