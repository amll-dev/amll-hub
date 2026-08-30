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

/** 主题偏好，初值取 localStorage */
export const themeAtom = atom<ThemePreference>(readStoredPreference());

/** 解析后的实际主题，供 UI 显示当前态 */
export const resolvedThemeAtom = atom<'light' | 'dark'>(
  readStoredPreference() === 'dark' || (readStoredPreference() === 'system' && systemPrefersDark())
    ? 'dark'
    : 'light'
);

const store = getDefaultStore();

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

// 模块加载即应用一次
applyTheme(store.get(resolvedThemeAtom));

/** 切换主题偏好 */
export function setTheme(preference: ThemePreference) {
  localStorage.setItem(STORAGE_KEY, preference);
  const resolved: 'light' | 'dark' =
    preference === 'dark' || (preference === 'system' && systemPrefersDark()) ? 'dark' : 'light';
  store.set(themeAtom, preference);
  store.set(resolvedThemeAtom, resolved);
  withTransition(() => applyTheme(resolved));
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
