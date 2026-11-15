import { useAtomValue } from 'jotai';
import type { DependencyList } from 'react';
import { type KeyBindingCallback, useKeyBinding } from '$/utils/keybindings';
import type { KeyBindingCommand } from './types';

/**
 * 在组件中绑定快捷键命令
 * @param command 注册好的命令对象，见 `keyboard/commands.ts`
 * @param callback 触发时的回调函数
 * @param deps 依赖项数组 (同 useEffect)
 */
export function useCommand(
  command: KeyBindingCommand,
  callback: KeyBindingCallback,
  deps: DependencyList = []
) {
  const currentKeys = useAtomValue(command.atom);

  useKeyBinding(currentKeys, callback, deps);
}
