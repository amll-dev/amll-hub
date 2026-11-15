/**
 * 平台判定。
 *
 * 不用 `navigator.userAgent.includes('Mac')`：iPad 的桌面模式 UA 报的是
 * Macintosh，而 iPad + 妙控键盘的物理键位就是 Mac 布局（⌘ 而不是 Ctrl）。
 * 以 `navigator.platform` / `userAgentData.platform` 为准更接近真实键盘。
 */
function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || '';
  if (/mac/i.test(platform)) return true;
  return /iphone|ipad|ipod/i.test(nav.userAgent);
}

export const IS_MAC = detectMac();

/** 主修饰键：Mac 是 ⌘(Meta)，其余是 Ctrl */
export const PRIMARY_MODIFIER = IS_MAC ? 'Meta' : 'Control';

/** 删除键：Mac 是 ⌫(Backspace)，其余是 Delete */
export const DELETE_KEY = IS_MAC ? 'Backspace' : 'Delete';
