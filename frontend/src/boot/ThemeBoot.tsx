import { useEffect } from 'react';
import { syncWithSystem } from '@/atoms/theme';

/**
 * 主题引导：监听系统深浅色偏好变化
 * 渲染 null，挂在 Layout 顶层一次。
 */
export function ThemeBoot() {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => syncWithSystem();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return null;
}
