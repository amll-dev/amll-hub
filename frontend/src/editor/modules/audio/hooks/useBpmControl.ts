import { useAtom, useAtomValue } from 'jotai';
import { useCallback } from 'react';
import {
  bpmFollowPlaybackRateAtom,
  bpmScaleAtom,
  bpmStateAtom,
  playbackRateAtom,
} from '$/modules/audio/states';

export function useBpmControl() {
  const bpmState = useAtomValue(bpmStateAtom);
  const playbackRate = useAtomValue(playbackRateAtom);
  const [followPlaybackRate, setFollowPlaybackRate] = useAtom(bpmFollowPlaybackRateAtom);
  const [scale, setScale] = useAtom(bpmScaleAtom);

  const originalBpm = bpmState.status === 'completed' ? bpmState.result.bpm : null;

  const effectiveRate = followPlaybackRate ? playbackRate : 1;

  const currentBpm = originalBpm !== null ? Math.round(originalBpm * scale * effectiveRate) : null;

  const halveBpm = useCallback(() => {
    setScale((s) => s * 0.5);
  }, [setScale]);

  const doubleBpm = useCallback(() => {
    setScale((s) => s * 2);
  }, [setScale]);

  const resetBpm = useCallback(() => {
    setScale(1);
  }, [setScale]);

  const isAdjusted = scale !== 1;

  return {
    bpmState,
    originalBpm,
    currentBpm,
    scale,
    playbackRate,
    followPlaybackRate,
    setFollowPlaybackRate,
    isAdjusted,
    halveBpm,
    doubleBpm,
    resetBpm,
  };
}

export default useBpmControl;
