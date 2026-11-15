import { atom, type createStore, useAtomValue } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { type DependencyList, useEffect } from 'react';
import { IS_MAC } from './platform';
import { createLogger } from './logger';

const keyBindingsLogger = createLogger('KeyBindings');

export type KeyBindingsConfig = string[];
export interface KeyBindingEvent {
  downTime: number;
  downTimeOffset: number;
}
export type KeyBindingCallback = (evt: KeyBindingEvent) => void;

/**
 * 触发模式枚举
 */
export enum KeyBindingTriggerMode {
  KeyDown = 'keydown',
  KeyUp = 'keyup',
}

/**
 * 用于在事件监听器中快速读取当前模式
 */
let currentTriggerMode: KeyBindingTriggerMode = KeyBindingTriggerMode.KeyDown;

// TODO: 把这个组件变成 hook 这样就可以直接读取 atom 而不是手动解析 localStorage 了
if (typeof localStorage !== 'undefined') {
  const raw = localStorage.getItem('keyBindingTriggerMode');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      currentTriggerMode = parsed as KeyBindingTriggerMode;
    } catch {
      currentTriggerMode = raw as KeyBindingTriggerMode;
    }
  }
}

if (
  currentTriggerMode !== KeyBindingTriggerMode.KeyDown &&
  currentTriggerMode !== KeyBindingTriggerMode.KeyUp
) {
  currentTriggerMode = KeyBindingTriggerMode.KeyDown;
}

const internalTriggerModeAtom = atomWithStorage<KeyBindingTriggerMode>(
  'keyBindingTriggerMode',
  currentTriggerMode,
  undefined,
  { getOnInit: true }
);

export const keyBindingTriggerModeAtom = atom(
  (get) => get(internalTriggerModeAtom),
  (_get, set, newValue: KeyBindingTriggerMode) => {
    set(internalTriggerModeAtom, newValue);
    currentTriggerMode = newValue;
  }
);

/**
 * 单个按键码 → 展示用标签。
 * `formatKeyBindings` / `formatKeyBindingsAsArray` 共用这一份，避免同一组合
 * 在两个 UI 上显示成两种样子。
 */
function formatKeyLabel(key: string): string {
  const code = removeSideOfKeyCode(key);
  if (code.startsWith('Key')) return code.substring(3);
  if (IS_MAC) {
    if (code === 'Control') return '⌃';
    if (code === 'Alt') return '⌥';
    if (code === 'Shift') return '⇧';
    if (code === 'Meta') return '⌘';
    if (code === 'Backspace') return '⌫';
    return code;
  }
  if (code.startsWith('Control')) return 'Ctrl';
  if (code === 'Meta') return 'Win';
  return code;
}

export function formatKeyBindingsAsArray(cfg: KeyBindingsConfig): string[] {
  return cfg.map(formatKeyLabel);
}

export function formatKeyBindings(cfg: KeyBindingsConfig): string {
  return formatKeyBindingsAsArray(cfg).join(IS_MAC ? ' ' : ' + ');
}

export const RESET_KEYBINDING = Symbol('reset-keybinding');

export function atomWithKeybindingStorage(storageName: string, defaultValue: KeyBindingsConfig) {
  const key = `keybindings:${storageName}`;
  const keyAtom = atomWithStorage(key, defaultValue);
  return atom(
    (get) => get(keyAtom),
    async (_get, set, update?: KeyBindingsConfig | typeof RESET_KEYBINDING) => {
      if (update) {
        if (update === RESET_KEYBINDING) set(keyAtom, defaultValue);
        else set(keyAtom, update);
      }
    }
  );
}

/**
 * 这些前缀的键左右是两个**不同的键**（`[` / `]`、方向键），不能剥掉 L/R 后缀。
 * 名字按语义取：不是黑名单，是「保留左右区分的前缀」。
 */
const SIDE_SUFFIX_EXEMPT_PREFIXES = new Set(['Bracket', 'Arrow']);

function removeSideOfKeyCode(code: string) {
  for (const key of SIDE_SUFFIX_EXEMPT_PREFIXES) {
    if (code.startsWith(key)) return code;
  }
  if (code.endsWith('Left')) return code.substring(0, code.length - 4);
  if (code.endsWith('Right')) return code.substring(0, code.length - 5);
  return code;
}

/**
 * 组合键的统一字符串：**排序后拼接**。
 * 不排序的话 `['Shift','Control','KeyZ']` 与 `['Control','Shift','KeyZ']`
 * 是两个不同的键，用户先按哪个由手速决定，同一个组合会时灵时不灵。
 * 注册侧（`registerKeyBindings`）与触发侧（keydown/keyup）必须都走这里。
 */
function joinKeyCodes(codes: Iterable<string>): string {
  return [...codes].sort().join(' + ').trim();
}

/** 同一个组合被多个功能注册时会全部执行，提示一次，避免排查时无从下手 */
const warnedConflicts = new Set<string>();

const pressingKeys = new Set<string>();
const registeredKeyBindings = new Map<string, Set<KeyBindingCallback>>();
let downTime = 0;

function triggerCallbacks(joinedKey: string, evt: KeyboardEvent, targetTime: number) {
  const callbacks = registeredKeyBindings.get(joinedKey);
  if (callbacks) {
    const downTimeOffset = evt.timeStamp - targetTime;
    const e: KeyBindingEvent = {
      downTime: targetTime,
      downTimeOffset,
    };
    for (const cb of callbacks) {
      try {
        cb(e);
      } catch (err) {
        keyBindingsLogger.error('Error in key binding ', joinedKey, 'callback', err);
      }
    }
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();
  }
}

window.addEventListener('keydown', (evt) => {
  if (evt.repeat) return;
  if (isEditing(evt)) {
    pressingKeys.clear();
    return;
  }
  if (pressingKeys.size === 0) {
    downTime = evt.timeStamp;
  }

  const code = removeSideOfKeyCode(evt.code);

  // 阻止空格滚动
  if (
    (evt.code === 'Space' || evt.code === 'Home' || evt.code === 'End') &&
    evt.target === document.body
  ) {
    evt.preventDefault();
    evt.stopPropagation();
  }

  pressingKeys.add(code);

  if (currentTriggerMode === KeyBindingTriggerMode.KeyDown) {
    triggerCallbacks(joinKeyCodes(pressingKeys), evt, downTime);
  }
});

window.addEventListener('keyup', (evt) => {
  if (isEditing(evt)) {
    pressingKeys.clear();
    return;
  }

  const code = removeSideOfKeyCode(evt.code);

  if (currentTriggerMode === KeyBindingTriggerMode.KeyUp) {
    triggerCallbacks(joinKeyCodes(pressingKeys), evt, downTime);
  }

  pressingKeys.delete(code);
});
window.addEventListener('blur', () => {
  pressingKeys.clear();
});
window.addEventListener('focus', () => {
  pressingKeys.clear();
});

export function forceInvokeKeyBindingAtom(
  store: ReturnType<typeof createStore>,
  thisAtom: ReturnType<typeof atomWithKeybindingStorage>,
  evt?: MouseEvent | KeyboardEvent | TouchEvent
) {
  const keyBinding = store.get(thisAtom);
  const joined = joinKeyCodes(keyBinding);
  const callbacks = registeredKeyBindings.get(joined);

  if (callbacks) {
    const downTimeOffset = 0;

    const e: KeyBindingEvent = {
      downTime,
      downTimeOffset,
    };
    for (const cb of callbacks) {
      try {
        cb(e);
      } catch (err) {
        keyBindingsLogger.error('Error in key binding ', joined, 'callback', err);
      }
    }
    evt?.preventDefault();
    evt?.stopPropagation();
    evt?.stopImmediatePropagation();
  }
}

// From https://wangchujiang.com/hotkeys-js/
export function isEditing(event: KeyboardEvent | MouseEvent) {
  const checkElement = (target: HTMLElement | null) => {
    const tagName = target?.tagName;
    return (
      target?.isContentEditable ||
      tagName === 'INPUT' ||
      tagName === 'SELECT' ||
      tagName === 'TEXTAREA'
    );
  };
  return (
    checkElement((event.target || event.srcElement) as HTMLElement | null) ||
    checkElement(document.activeElement as HTMLElement | null)
  );
}

export function isInteracting(event: KeyboardEvent | MouseEvent) {
  const checkElement = (target: HTMLElement | null) => {
    const tagName = target?.tagName;
    return (
      target?.isContentEditable ||
      tagName === 'INPUT' ||
      tagName === 'SELECT' ||
      tagName === 'TEXTAREA' ||
      tagName === 'BUTTON'
    );
  };
  return (
    checkElement((event.target || event.srcElement) as HTMLElement | null) ||
    checkElement(document.activeElement as HTMLElement | null)
  );
}

export function registerKeyBindings(cfg: KeyBindingsConfig, callback: KeyBindingCallback) {
  if (cfg.length === 0) {
    return () => {};
  }
  const joined = joinKeyCodes(cfg);
  let set = registeredKeyBindings.get(joined);
  if (!set) {
    set = new Set();
    registeredKeyBindings.set(joined, set);
  } else if (set.size > 0 && !warnedConflicts.has(joined)) {
    warnedConflicts.add(joined);
    keyBindingsLogger.warn(`快捷键 ${joined} 已绑定 ${set.size} 个回调，本次注册会让它们同时执行`);
  }
  set.add(callback);
  return () => {
    set?.delete(callback);
  };
}

export function useKeyBinding(
  cfg: KeyBindingsConfig,
  callback: KeyBindingCallback,
  deps?: DependencyList
) {
  useEffect(() => {
    return registerKeyBindings(cfg, callback);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps 由调用方传入，长度运行时才确定，无法静态验证
  }, [cfg, callback, ...(deps || [])]);
}

/**
 * @deprecated 请使用 useCommand
 */
export function useKeyBindingAtom(
  thisAtom: ReturnType<typeof atomWithKeybindingStorage>,
  callback: KeyBindingCallback,
  deps?: DependencyList
): KeyBindingsConfig {
  const keyBindings = useAtomValue(thisAtom);
  useEffect(() => {
    return registerKeyBindings(keyBindings, callback);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps 由调用方传入，长度运行时才确定，无法静态验证
  }, [keyBindings, callback, ...(deps || [])]);
  return keyBindings;
}
