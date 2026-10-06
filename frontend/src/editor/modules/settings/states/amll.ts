import { atomWithStorage } from 'jotai/utils';

export const amllNormalizeSpacesAtom = atomWithStorage('amllOptimizeNormalizeSpaces', false);
export const amllResetLineTimestampsAtom = atomWithStorage(
  'amllOptimizeResetLineTimestamps',
  false
);
export const amllConvertExcessiveBackgroundLinesAtom = atomWithStorage(
  'amllOptimizeConvertExcessiveBackgroundLines',
  false
);
export const amllSyncMainAndBackgroundLinesAtom = atomWithStorage(
  'amllOptimizeSyncMainAndBackgroundLines',
  false
);
export const amllCleanUnintentionalOverlapsAtom = atomWithStorage(
  'amllOptimizeCleanUnintentionalOverlaps',
  false
);
export const amllTryAdvanceStartTimeAtom = atomWithStorage(
  'amllOptimizeTryAdvanceStartTime',
  false
);
