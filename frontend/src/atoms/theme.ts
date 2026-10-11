import { atom, getDefaultStore } from 'jotai';

// ===== 主题 =====

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'amll-theme';

/** 系统当前偏好 */
function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readStoredPreference(): ThemePreference {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

/** 把解析后的主题写到 <html> */
function applyTheme(resolved: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  // 同步原生控件配色
  document.documentElement.style.colorScheme = resolved;
}

/** 切换期间给 html 挂过渡类 */
function withTransition(fn: () => void) {
  const root = document.documentElement;
  root.classList.add('theme-transitioning');
  fn();
  window.setTimeout(() => root.classList.remove('theme-transitioning'), 320);
}

function resolve(preference: ThemePreference): 'light' | 'dark' {
  return preference === 'dark' || (preference === 'system' && systemPrefersDark())
    ? 'dark'
    : 'light';
}

const themePreferenceBaseAtom = atom<ThemePreference>(readStoredPreference());

/** 解析后的实际主题 */
export const resolvedThemeAtom = atom<'light' | 'dark'>(
  readStoredPreference() === 'dark' || (readStoredPreference() === 'system' && systemPrefersDark())
    ? 'dark'
    : 'light'
);

export const themeAtom = atom(
  (get) => get(themePreferenceBaseAtom),
  (_get, set, preference: ThemePreference) => {
    localStorage.setItem(STORAGE_KEY, preference);
    set(themePreferenceBaseAtom, preference);
    const next = resolve(preference);
    withTransition(() => {
      applyTheme(next);
      set(resolvedThemeAtom, next);
    });
  }
);

const store = getDefaultStore();

// 模块加载即应用一次
applyTheme(store.get(resolvedThemeAtom));

/** 切换主题偏好 */
export function setTheme(preference: ThemePreference) {
  store.set(themeAtom, preference);
}

/** 系统偏好变化时调用 */
export function syncWithSystem() {
  if (store.get(themeAtom) !== 'system') return;
  const resolved: 'light' | 'dark' = systemPrefersDark() ? 'dark' : 'light';
  if (store.get(resolvedThemeAtom) !== resolved) {
    store.set(resolvedThemeAtom, resolved);
    applyTheme(resolved);
  }
}
