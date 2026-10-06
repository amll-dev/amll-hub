import { atomWithStorage } from 'jotai/utils';

export const customBackgroundOpacityAtom = atomWithStorage('customBackgroundOpacity', 0.4);

export const customBackgroundMaskAtom = atomWithStorage('customBackgroundMask', 0.2);

export const customBackgroundBlurAtom = atomWithStorage('customBackgroundBlur', 0);

export const customBackgroundBrightnessAtom = atomWithStorage('customBackgroundBrightness', 1);
