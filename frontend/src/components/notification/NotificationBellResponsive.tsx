import { useMediaQuery } from '@/hooks/useMediaQuery';
import { NotificationBellMenu } from './NotificationBellMenu';
import { NotificationBellSheet } from './NotificationBellSheet';

/**
 * 消息铃铛唯一对外入口：桌面 DropdownMenu / 移动 Sheet 二选一。
 * 用法：<NotificationBellResponsive />（调用方保证已登录）。
 */
export function NotificationBellResponsive() {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  return isDesktop ? <NotificationBellMenu /> : <NotificationBellSheet />;
}
