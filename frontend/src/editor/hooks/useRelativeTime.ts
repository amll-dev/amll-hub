import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/** 相对时间文案（刚刚 / N 分钟前 / N 小时前 / N 天前）。 */
export const useRelativeTime = () => {
  const { t } = useTranslation();

  return useCallback(
    (timestamp: number) => {
      const diff = Date.now() - timestamp;
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) return t('time.daysAgo', '{count}天前', { count: days });
      if (hours > 0) return t('time.hoursAgo', '{count}小时前', { count: hours });
      if (minutes > 0) return t('time.minutesAgo', '{count}分钟前', { count: minutes });
      return t('time.justNow', '刚刚');
    },
    [t]
  );
};
