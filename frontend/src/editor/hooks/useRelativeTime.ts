import { useCallback } from 'react';

/** 相对时间文案（刚刚 / N 分钟前 / N 小时前 / N 天前）。 */
export const useRelativeTime = () => {
  return useCallback((timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}天前`;
    if (hours > 0) return `${hours}小时前`;
    if (minutes > 0) return `${minutes}分钟前`;
    return '刚刚';
  }, []);
};
