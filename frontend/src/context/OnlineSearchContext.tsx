import { createContext, useContext, type ReactNode } from 'react';
import { useOnlineSearch } from '@/hooks/useOnlineSearch';
import type { OnlineSearchContextValue } from '@/hooks/useOnlineSearch';

export const OnlineSearchContext = createContext<OnlineSearchContextValue | null>(null);

export function OnlineSearchProvider({ children }: { children: ReactNode }) {
  const value = useOnlineSearch();
  return (
    <OnlineSearchContext.Provider value={value}>{children}</OnlineSearchContext.Provider>
  );
}

/** 读取平台歌词搜索状态 */
export function useOnlineSearchContext() {
  const ctx = useContext(OnlineSearchContext);
  if (!ctx) {
    throw new Error('useOnlineSearchContext must be used within OnlineSearchProvider');
  }
  return ctx;
}
