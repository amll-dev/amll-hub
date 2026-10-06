import { useAtomValue } from 'jotai';
import { type FC, useContext, useMemo } from 'react';
import { bpmScaleAtom, bpmStateAtom, currentDurationAtom } from '$/modules/audio/states';
import { SpectrogramContext } from './SpectrogramContext';

interface BeatLinesOverlayProps {
  clientWidth: number;
}

export const BeatLinesOverlay: FC<BeatLinesOverlayProps> = ({ clientWidth }) => {
  const bpmState = useAtomValue(bpmStateAtom);
  const scale = useAtomValue(bpmScaleAtom);
  const currentDurationMs = useAtomValue(currentDurationAtom);

  const { zoom, scrollLeft } = useContext(SpectrogramContext);

  const durationS = currentDurationMs / 1000;

  const allBeatTimes = useMemo(() => {
    if (bpmState.status !== 'completed' || durationS <= 0) return [];

    const { result } = bpmState;
    const rawTicks = result.ticks || [];

    let coreBeats: number[] = [];
    let intervalS = 0;

    if (rawTicks.length > 0) {
      const isMs = rawTicks[rawTicks.length - 1] > durationS * 2;
      const ticksInSeconds = isMs ? rawTicks.map((t) => t / 1000) : rawTicks;

      if (ticksInSeconds.length >= 2) {
        intervalS =
          (ticksInSeconds[ticksInSeconds.length - 1] - ticksInSeconds[0]) /
          (ticksInSeconds.length - 1);
      } else {
        intervalS = 60 / result.bpm;
      }

      if (scale === 1) {
        coreBeats = ticksInSeconds;
      } else if (scale === 0.5) {
        coreBeats = ticksInSeconds.filter((_, i) => i % 2 === 0);
        intervalS *= 2;
      } else if (scale === 2) {
        const doubled: number[] = [];
        for (let i = 0; i < ticksInSeconds.length; i++) {
          doubled.push(ticksInSeconds[i]);
          if (i < ticksInSeconds.length - 1) {
            doubled.push((ticksInSeconds[i] + ticksInSeconds[i + 1]) / 2);
          }
        }
        coreBeats = doubled;
        intervalS /= 2;
      } else {
        coreBeats = ticksInSeconds;
      }
    }

    if (coreBeats.length === 0) {
      const effectiveBpm = result.bpm * scale;
      if (effectiveBpm <= 0) return [];

      intervalS = 60 / effectiveBpm;
      const anchorTick = result.anchorTick ?? 0;
      const anchorS = anchorTick > 500 ? anchorTick / 1000 : anchorTick;

      const beats: number[] = [];
      let t = anchorS;
      while (t - intervalS >= 0) {
        t -= intervalS;
      }
      while (t <= durationS + intervalS) {
        if (t >= 0 && t <= durationS) {
          beats.push(t);
        }
        t += intervalS;
      }
      return beats;
    }

    if (intervalS <= 0) return coreBeats;

    const beats: number[] = [...coreBeats];

    let first = beats[0];
    while (first - intervalS >= 0) {
      first -= intervalS;
      beats.unshift(first);
    }

    let last = beats[beats.length - 1];
    while (last + intervalS <= durationS) {
      last += intervalS;
      beats.push(last);
    }

    return beats;
  }, [bpmState, scale, durationS]);

  const visibleBeats = useMemo(() => {
    if (allBeatTimes.length === 0 || zoom <= 0) return [];

    const bufferS = 200 / zoom;
    const viewStartS = Math.max(0, scrollLeft / zoom - bufferS);
    const viewEndS = (scrollLeft + clientWidth) / zoom + bufferS;

    return allBeatTimes.filter((t) => t >= viewStartS && t <= viewEndS);
  }, [allBeatTimes, scrollLeft, clientWidth, zoom]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        height: '100%',
        width: '100%',
        pointerEvents: 'none',
        zIndex: 8,
      }}
    >
      {visibleBeats.map((beatTime, idx) => {
        const x = beatTime * zoom;
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: beat time and index key
            key={`${beatTime.toFixed(3)}-${idx}`}
            style={{
              position: 'absolute',
              top: 0,
              left: `${x}px`,
              width: '1px',
              height: '100%',
              borderLeft: '1px dashed var(--amber-10)',
              pointerEvents: 'none',
            }}
          />
        );
      })}
    </div>
  );
};

export default BeatLinesOverlay;
