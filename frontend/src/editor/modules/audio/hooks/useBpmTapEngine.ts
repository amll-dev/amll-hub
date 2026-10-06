import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useState } from 'react';
import { audioEngine } from '$/modules/audio/audio-engine';
import {
  bpmScaleAtom,
  bpmStateAtom,
  bpmTapModeAtom,
  tapTimesAtom,
  totalTapCountAtom,
} from '$/modules/audio/states';
import { SyncJudgeMode, syncJudgeModeAtom } from '$/modules/settings/states';

export function computeOptimalAnchorTick(tapTimes: number[], bpm: number): number {
  if (tapTimes.length === 0) return 0;
  if (tapTimes.length === 1) return tapTimes[0]!;

  const period = 60 / bpm;
  if (period <= 0) return tapTimes[0]!;

  const t0 = tapTimes[0]!;
  const stableTaps = tapTimes.length >= 4 ? tapTimes.slice(1) : tapTimes;

  const offsets: number[] = stableTaps.map((t) => {
    const diff = (t - t0) % period;
    let normalizedDiff = diff;
    if (normalizedDiff > period / 2) {
      normalizedDiff -= period;
    } else if (normalizedDiff < -period / 2) {
      normalizedDiff += period;
    }
    return normalizedDiff;
  });

  offsets.sort((a, b) => a - b);
  const mid = Math.floor(offsets.length / 2);
  const medianOffset =
    offsets.length % 2 !== 0 ? offsets[mid]! : (offsets[mid - 1]! + offsets[mid]!) / 2;

  let optimalAnchor = t0 + medianOffset;
  while (optimalAnchor < 0) {
    optimalAnchor += period;
  }

  return optimalAnchor;
}

export function useBpmTapEngine() {
  const [tapMode, setTapMode] = useAtom(bpmTapModeAtom);
  const [tapTimes, setTapTimes] = useAtom(tapTimesAtom);
  const [totalTapCount, setTotalTapCount] = useAtom(totalTapCountAtom);
  const setBpmState = useSetAtom(bpmStateAtom);
  const setScale = useSetAtom(bpmScaleAtom);
  const syncJudgeMode = useAtomValue(syncJudgeModeAtom);

  const [isHighlighted, setIsHighlighted] = useState(false);

  const isKeyTapMode = tapMode === 'key';
  const isSpectrogramTapMode = tapMode === 'spectrogram';
  const isTapModeActive = tapMode !== 'off';

  const triggerHighlight = useCallback(() => {
    setIsHighlighted(true);
    setTimeout(() => {
      setIsHighlighted(false);
    }, 100);
  }, []);

  const triggerTap = useCallback(
    (customTimeSeconds?: number, downTimeOffset = 0) => {
      triggerHighlight();

      let hitTime = 0;
      if (typeof customTimeSeconds === 'number') {
        hitTime = customTimeSeconds;
      } else {
        hitTime = audioEngine.ctxCurrentTime + audioEngine.ctxOutputLatency;
        if (hitTime <= 0) {
          hitTime = performance.now() / 1000;
        } else {
          switch (syncJudgeMode) {
            case SyncJudgeMode.FirstKeyDownTime:
              hitTime -= downTimeOffset / 1000;
              break;
            case SyncJudgeMode.LastKeyUpTime:
              break;
            case SyncJudgeMode.MiddleKeyTime:
              hitTime -= downTimeOffset / 2000;
              break;
          }
        }
      }

      setTapTimes((prev) => {
        const now = hitTime;
        let nextTapTimes: number[];
        if (prev.length > 0) {
          const last = prev[prev.length - 1]!;
          if (now - last > 2.5) {
            nextTapTimes = [now];
            setTotalTapCount(1);
          } else {
            nextTapTimes = [...prev, now];
            setTotalTapCount((c) => c + 1);
          }
        } else {
          nextTapTimes = [now];
          setTotalTapCount(1);
        }

        const MAX_TAP_HISTORY = 10;
        if (nextTapTimes.length > MAX_TAP_HISTORY) {
          nextTapTimes = nextTapTimes.slice(-MAX_TAP_HISTORY);
        }

        if (nextTapTimes.length >= 2) {
          const interval =
            (nextTapTimes[nextTapTimes.length - 1]! - nextTapTimes[0]!) / (nextTapTimes.length - 1);
          if (interval > 0) {
            const bpm = Math.round(60 / interval);
            if (bpm >= 20 && bpm <= 400) {
              const optimalAnchor = computeOptimalAnchorTick(nextTapTimes, bpm);
              setBpmState({
                status: 'completed',
                result: {
                  bpm,
                  baseBpm: bpm,
                  anchorTick: optimalAnchor,
                  confidence: 1,
                  ticks: [],
                },
                calculationTime: 0,
              });
              setScale(1);
            }
          }
        }

        return nextTapTimes;
      });
    },
    [syncJudgeMode, setBpmState, setScale, setTapTimes, setTotalTapCount, triggerHighlight]
  );

  const resetTapTimes = useCallback(() => {
    setTapTimes([]);
    setTotalTapCount(0);
  }, [setTapTimes, setTotalTapCount]);

  return {
    tapMode,
    setTapMode,
    isKeyTapMode,
    isSpectrogramTapMode,
    isTapModeActive,
    tapTimes,
    totalTapCount,
    triggerTap,
    resetTapTimes,
    isHighlighted,
  };
}
