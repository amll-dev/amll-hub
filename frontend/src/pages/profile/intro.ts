import { createContext, useContext, useEffect, useState } from 'react';

/** 个人中心入场动画 */
let introPlayed = false;

export const ProfileIntroContext = createContext(true);

/** 布局层调用：本次挂载是否需要播放入场动画 */
export function useProfileIntro(): boolean {
  const [playIntro] = useState(() => !introPlayed);
  useEffect(() => {
    introPlayed = true;
  }, []);
  return playIntro;
}

/** 子页面读取是否播放入场动画 */
export function usePlayProfileIntro(): boolean {
  return useContext(ProfileIntroContext);
}
