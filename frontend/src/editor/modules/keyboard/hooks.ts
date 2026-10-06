import { useAtomValue } from 'jotai';
import type { DependencyList } from 'react';
import { type KeyBindingCallback, useKeyBinding } from '$/utils/keybindings';
import type { KeyBindingCommand } from './types';

/*
 * 仅用于下方 JSDoc 的 `{@link Commands}` 引用，不参与运行。
 *
 * 用 `export` 导出即可让 ESLint 认定它被使用；类型本身没有运行时开销。
 * （原来是 `// biome-ignore` 注释，但项目用的是 ESLint，那条注释不生效。）
 */
export type Commands = typeof import('./commands');

/**
 * 在组件中绑定快捷键命令
 * @param command 注册好的命令对象，参见 {@link Commands commands.ts}
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
