import { openDB } from 'idb';
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

const CUSTOM_BACKGROUND_DB = 'amll-custom-background';
const CUSTOM_BACKGROUND_STORE = 'background-image';
const CUSTOM_BACKGROUND_KEY = 'main';

type CustomBackgroundRecord = {
  key: string;
  blob: Blob;
  updatedAt: number;
};

const customBackgroundDbPromise = openDB(CUSTOM_BACKGROUND_DB, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(CUSTOM_BACKGROUND_STORE)) {
      db.createObjectStore(CUSTOM_BACKGROUND_STORE, { keyPath: 'key' });
    }
  },
});

const readLegacyCustomBackground = async () => {
  try {
    const raw = localStorage.getItem('customBackgroundImage');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as string | null;
    if (!parsed || typeof parsed !== 'string') {
      localStorage.removeItem('customBackgroundImage');
      return null;
    }
    if (!parsed.startsWith('data:')) {
      localStorage.removeItem('customBackgroundImage');
      return null;
    }
    const response = await fetch(parsed);
    const blob = await response.blob();
    localStorage.removeItem('customBackgroundImage');
    return blob;
  } catch {
    return null;
  }
};

const readCustomBackgroundBlob = async () => {
  try {
    const db = await customBackgroundDbPromise;
    const record = (await db.get(CUSTOM_BACKGROUND_STORE, CUSTOM_BACKGROUND_KEY)) as
      CustomBackgroundRecord | undefined;
    if (record?.blob) return record.blob;
  } catch {
    /* 自定义背景持久化失败：降级走 legacy 读取，不影响编辑 */
  }
  const legacy = await readLegacyCustomBackground();
  if (!legacy) return null;
  try {
    const db = await customBackgroundDbPromise;
    const record: CustomBackgroundRecord = {
      key: CUSTOM_BACKGROUND_KEY,
      blob: legacy,
      updatedAt: Date.now(),
    };
    await db.put(CUSTOM_BACKGROUND_STORE, record);
  } catch {
    /* 自定义背景持久化失败：降级走 legacy 读取，不影响编辑 */
  }
  return legacy;
};

const writeCustomBackgroundBlob = async (blob: Blob | null) => {
  try {
    const db = await customBackgroundDbPromise;
    if (!blob) {
      await db.delete(CUSTOM_BACKGROUND_STORE, CUSTOM_BACKGROUND_KEY);
      return;
    }
    const record: CustomBackgroundRecord = {
      key: CUSTOM_BACKGROUND_KEY,
      blob,
      updatedAt: Date.now(),
    };
    await db.put(CUSTOM_BACKGROUND_STORE, record);
  } catch {
    /* 自定义背景持久化失败：降级走 legacy 读取，不影响编辑 */
  }
};

const customBackgroundImageValueAtom = atom<string | null>(null);

export const customBackgroundImageAtom = atom(
  (get) => get(customBackgroundImageValueAtom),
  async (get, set, next: File | Blob | null) => {
    const previous = get(customBackgroundImageValueAtom);
    if (previous) {
      URL.revokeObjectURL(previous);
    }
    if (!next) {
      await writeCustomBackgroundBlob(null);
      set(customBackgroundImageValueAtom, null);
      return;
    }
    await writeCustomBackgroundBlob(next);
    const url = URL.createObjectURL(next);
    set(customBackgroundImageValueAtom, url);
  }
);

export const customBackgroundImageInitAtom = atom(null, async (get, set) => {
  const previous = get(customBackgroundImageValueAtom);
  if (previous) {
    URL.revokeObjectURL(previous);
  }
  const blob = await readCustomBackgroundBlob();
  if (!blob) {
    set(customBackgroundImageValueAtom, null);
    return;
  }
  const url = URL.createObjectURL(blob);
  set(customBackgroundImageValueAtom, url);
});

export const customBackgroundOpacityAtom = atomWithStorage('customBackgroundOpacity', 0.4);

export const customBackgroundMaskAtom = atomWithStorage('customBackgroundMask', 0.2);

export const customBackgroundBlurAtom = atomWithStorage('customBackgroundBlur', 0);

export const customBackgroundBrightnessAtom = atomWithStorage('customBackgroundBrightness', 1);
