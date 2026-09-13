import { useEffect, useState } from 'react';

/**
 * 媒体查询 hook（SSR 安全）。
 * 用于桌面/移动端组件二选一（如消息铃铛 DropdownMenu vs Sheet）。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
