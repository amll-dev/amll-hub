import { useEffect } from 'react';
import { resetProfileForm } from '@/atoms/profileForm';

/** 表单输入框统一样式（在 Input 基础上加表单高度） */
export const fieldClass = 'h-11 bg-card px-4';

/** 首页快捷入口卡片 */
export const quickCardClass =
  'flex flex-col gap-1.5 rounded-lg border border-line bg-card p-4 transition-colors hover:border-primary hover:bg-primary-tint/40';

/** 首页快捷入口图标底色 */
export const quickIconClass =
  'flex h-8 w-8 items-center justify-center rounded-md bg-primary-soft text-primary';

/**
 * 页面卸载时复位全局表单状态。
 * 个人中心拆成多个路由后，状态仍放在 atoms 里，切走再回来保持「卸载即重置」语义。
 */
export function useResetProfileForm() {
  useEffect(() => () => resetProfileForm(), []);
}
