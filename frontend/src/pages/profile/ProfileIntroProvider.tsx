import type { ReactNode } from 'react';
import { ProfileIntroContext } from './intro';

/**
 * 把布局层算出的「是否播放入场动画」注入给子页面。
 *
 * 单独成文件是为了守住 react-refresh 边界：本文件只导出组件，
 * context 与 hooks 放在同目录的 intro.ts。
 */
export function ProfileIntroProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <ProfileIntroContext.Provider value={value}>{children}</ProfileIntroContext.Provider>;
}
