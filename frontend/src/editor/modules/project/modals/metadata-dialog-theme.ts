/**
 * 弹窗 Radix accent 色阶下发
 *
 * ## 为什么需要它
 *
 * `MetadataEditor` 的 Dialog Portal 到 `body`，**不在 `editor-body` 子树里**，
 * 所以 `editor-theme.css` 里挂在 `body.editor-body [data-accent-color]`
 * 的品牌红色阶对它不生效 —— 弹窗里按钮/复选框/开关会回落到 Radix
 * 内置的indigo。
 *
 * 而 Radix 的 `Dialog.Content` 内部又套了一层 `<Theme asChild>`，
 * 在自己元素上渲染 `data-accent-color="indigo"`，Radix 用
 * `[data-accent-color='…']`（优先级 0,1,0）声明色阶。CSS 类很难稳定
 * 压过它，所以这里用**内联 style**（优先级最高，一定生效）。
 *
 * ## 色值来源：CSS 变量，不是硬编码
 *
 * 色阶的唯一权威定义在 `components/review/editor-theme.css`
 * （浅色档 + 深色档）。这里**读取**那些变量再回填成内联 style，
 * 而不是抄一份色值 —— 之前这里硬编码了 34 个色值，和 CSS 那份
 * 逐字相同，改配色时必然两边漂移。
 *
 * 读取时机：Portal 内容挂载后从 `document.body` 上取
 * （`editor-theme.css` 挂在 body 上，深色档由 `body.editor-body.dark`
 * 决定）。取不到时回落到当前文件里的兜底值，保证不会渲染成 indigo。
 */
import type React from 'react';

/** Radix accent 梯度：1~13 纯色，a1~a13 半透明，另有 4 个语义别名 */
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

/**
 * 兜底色阶（品牌红）。
 *
 * 仅在读不到 CSS 变量时使用 —— 例如 `editor-theme.css` 未加载
 * （如单独跑 Storybook）。正常路径下读到的是 CSS 里那份。
 */
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

/**
 * 从 body 上读取当前主题下的品牌红色阶。
 *
 * 深色档由 `body.editor-body.dark` 提供，所以必须从 **body** 读而不是
 * 从弹窗元素读（弹窗不在 editor-body 内）。读到的值已经带上主题。
 */
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
