import type React from 'react';

/** accent 梯度：1~13 纯色，a1~a13 半透明，另有 4 个语义别名 */
const ACCENT_VARS = [
  '--accent-1',
  '--accent-2',
  '--accent-3',
  '--accent-4',
  '--accent-5',
  '--accent-6',
  '--accent-7',
  '--accent-8',
  '--accent-9',
  '--accent-10',
  '--accent-11',
  '--accent-12',
  '--accent-13',
  '--accent-a1',
  '--accent-a2',
  '--accent-a3',
  '--accent-a4',
  '--accent-a5',
  '--accent-a6',
  '--accent-a7',
  '--accent-a8',
  '--accent-a9',
  '--accent-a10',
  '--accent-a11',
  '--accent-a12',
  '--accent-contrast',
  '--accent-surface',
  '--accent-indicator',
  '--accent-track',
] as const;

const FALLBACK = {
  '--accent-1': '#fff5f6',
  '--accent-2': '#feeaec',
  '--accent-3': '#fbdde0',
  '--accent-4': '#f9c8cd',
  '--accent-5': '#f6aeb6',
  '--accent-6': '#f3919d',
  '--accent-7': '#ef7484',
  '--accent-8': '#ec576b',
  '--accent-9': '#e0303f',
  '--accent-10': '#c22a38',
  '--accent-11': '#a81f2c',
  '--accent-12': '#8a1a25',
  '--accent-13': '#6b141d',
  '--accent-a1': 'rgb(224 48 63 / 0.05)',
  '--accent-a2': 'rgb(224 48 63 / 0.08)',
  '--accent-a3': 'rgb(224 48 63 / 0.16)',
  '--accent-a4': 'rgb(197 32 48 / 0.34)',
  '--accent-a5': 'rgb(197 32 48 / 0.42)',
  '--accent-a6': 'rgb(190 28 44 / 0.52)',
  '--accent-a7': 'rgb(184 24 40 / 0.62)',
  '--accent-a8': 'rgb(178 20 36 / 0.72)',
  '--accent-a9': 'rgb(224 48 63 / 0.92)',
  '--accent-a10': 'rgb(224 48 63 / 0.88)',
  '--accent-a11': 'rgb(224 48 63 / 0.8)',
  '--accent-a12': 'rgb(224 48 63 / 0.6)',
  '--accent-contrast': '#ffffff',
  '--accent-surface': '#fff5f6',
  '--accent-indicator': '#e0303f',
  '--accent-track': '#fbdde0',
} as const satisfies Record<(typeof ACCENT_VARS)[number], string>;

export function readBrandAccentStyle(): React.CSSProperties {
  if (typeof document === 'undefined') return FALLBACK as React.CSSProperties;

  const styles = getComputedStyle(document.body);
  const out: Record<string, string> = {};
  let missing = 0;

  for (const name of ACCENT_VARS) {
    // 注意：`--accent-9` 这类自定义属性在 getPropertyValue 里返回原样字符串
    const value = styles.getPropertyValue(name).trim();
    if (value) {
      out[name] = value;
    } else {
      missing++;
      out[name] = FALLBACK[name];
    }
  }

  // 全部读不到说明 editor-theme.css 没加载，用兜底即可
  if (missing === ACCENT_VARS.length) return FALLBACK as React.CSSProperties;

  return out as React.CSSProperties;
}
