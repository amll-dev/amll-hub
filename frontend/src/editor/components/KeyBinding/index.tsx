import { Kbd } from '@radix-ui/themes';
import { useAtomValue } from 'jotai';
import type { FC } from 'react';
import { formatKeyBindings, type useKeyBindingAtom } from '$/utils/keybindings.ts';

/**
 * 在 UI 上显示某个键位当前绑定的按键。
 *
 * 键位本身存在 jotai 的 keybinding atom 里（可被用户在设置中改），
 * 所以这里不能写死字符串 —— BPM 面板的「点此打拍」提示要跟着用户配置走。
 */
export const KeyBinding: FC<{
  kbdAtom: Parameters<typeof useKeyBindingAtom>[0];
}> = ({ kbdAtom }) => {
  const kbd = useAtomValue(kbdAtom);
  const keys = formatKeyBindings(kbd);
  return <Kbd>{keys}</Kbd>;
};
