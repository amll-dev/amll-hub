/**
 * 共享的按钮样式常量。
 * 用于消除各表单/页面里重复粘贴的超长 className 字符串；
 * 颜色一律走设计 token（如 hover:bg-primary-hover），不允许硬编码色值。
 */

/** 主操作按钮l */
export const primaryBtnClass =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50';

/** 表单内联主操作按钮 */
export const sendCodeBtnClass =
  'inline-flex h-11 shrink-0 items-center justify-center rounded-md border border-input bg-card px-4 text-sm font-medium text-primary transition-colors hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-60';
