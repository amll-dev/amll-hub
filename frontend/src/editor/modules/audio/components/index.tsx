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

import {
  ChevronDownFilled,
  ChevronUpFilled,
  MyLocationRegular,
  PauseFilled,
  PlayFilled,
  Speaker2Filled,
} from '@fluentui/react-icons';
import {
  Button,
  Card,
  Flex,
  Grid,
  HoverCard,
  IconButton,
  Inset,
  Slider,
  Spinner,
  Text,
  Tooltip,
} from '@radix-ui/themes';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { type FC, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
    <Text
      size="2"
      ref={timeRef}
      style={{
        minWidth: '5.5em',
        textAlign: 'left',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      00:00.000
    </Text>
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
  const { t } = useTranslation();
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
    <Card m="2" mt="0">
      <Inset>
        <AudioPlaybackKeyBinding />
        <AuditionKeyBinding />
        <Flex direction="column">
          <div style={{ display: spectrogramVisible ? 'flex' : 'none' }}>
            <AudioSpectrogram />
          </div>
          <Flex align="center" px="2" gapX="2">
            <HoverCard.Root>
              <HoverCard.Trigger>
                <IconButton my="2" variant="soft" title={t('audioPanel.volume', '音量')}>
                  <Speaker2Filled />
                </IconButton>
              </HoverCard.Trigger>
              <HoverCard.Content>
                <Flex direction="column" align="center">
                  <Grid columns="0fr 7em 2em" gap="2" align="baseline">
                    <Text wrap="nowrap">{t('audioPanel.volume', '音量')}</Text>
                    <Slider
                      min={0}
                      max={1}
                      defaultValue={[volume]}
                      step={0.01}
                      onValueChange={(v) => setVolume(v[0] ?? volume)}
                    />
                    <Text wrap="nowrap" color="gray" size="1">
                      {(volume * 100).toFixed()}%
                    </Text>
                    <Text wrap="nowrap">{t('audioPanel.playbackRate', '播放速度')}</Text>
                    <Slider
                      min={0.1}
                      max={2}
                      defaultValue={[playbackRate]}
                      step={0.05}
                      onValueChange={(v) => setPlaybackRate(v[0] ?? playbackRate)}
                    />
                    <Text wrap="nowrap" color="gray" size="1">
                      {playbackRate.toFixed(2)}x
                    </Text>
                    <Text wrap="nowrap">{t('audioPanel.bpm', 'BPM')}</Text>
                    <Flex align="center">
                      {bpmState.status === 'analyzing' && (
                        <Button variant="soft" size="1" onClick={() => openTab('bpm')}>
                          <Spinner size="1" />
                        </Button>
                      )}
                      {bpmState.status === 'completed' && (
                        <Button variant="soft" size="1" onClick={() => openTab('bpm')}>
                          {currentBpm ?? Math.round(bpmState.result.bpm)}
                        </Button>
                      )}
                      {bpmState.status === 'error' && (
                        <Button variant="soft" color="red" size="1" onClick={() => openTab('bpm')}>
                          {t('audioPanel.bpmError', '错误')}
                        </Button>
                      )}
                      {bpmState.status === 'idle' && (
                        <Button variant="soft" color="gray" size="1" onClick={() => openTab('bpm')}>
                          -
                        </Button>
                      )}
                    </Flex>
                    <span />
                  </Grid>
                </Flex>
              </HoverCard.Content>
            </HoverCard.Root>
            <Tooltip content={t('audioPanel.playPause', '暂停 / 播放音乐')}>
              <IconButton
                my="2"
                ml="0"
                variant="soft"
                disabled={!audioLoaded}
                onClick={onTogglePlay}
              >
                {audioPlaying ? <PauseFilled /> : <PlayFilled />}
              </IconButton>
            </Tooltip>
            <CurrentTimeDisplay />
            <AudioSlider />
            <Text
              size="2"
              style={{
                minWidth: '5.5em',
              }}
            >
              {msToTimestamp(currentDuration)}
            </Text>
            <Tooltip content={t('lyricEditor.locate', '定位')}>
              <IconButton
                my="2"
                ml="0"
                variant="soft"
                onClick={handleLocate}
                disabled={lyricLines.length === 0}
              >
                <MyLocationRegular fontSize={18} />
              </IconButton>
            </Tooltip>
            <Tooltip content={t('audioPanel.expandSpectrogram', '展开 / 收起频谱图')}>
              <IconButton
                my="2"
                ml="0"
                variant="soft"
                onClick={() => setSpectrogramVisible(!spectrogramVisible)}
              >
                {spectrogramVisible ? <ChevronDownFilled /> : <ChevronUpFilled />}
              </IconButton>
            </Tooltip>
          </Flex>
        </Flex>
      </Inset>
    </Card>
  );
});

export default AudioControls;
