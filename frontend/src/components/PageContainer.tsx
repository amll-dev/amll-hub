import { cn } from '@/lib/utils';

/** 容器宽度档位 */
const widthClass = {
  /** 常规内容页（默认） */
  md: 'max-w-[1200px]',
  /** 排行榜等略窄布局 */
  sm: 'max-w-[1100px]',
  /** 详情页宽布局 */
  lg: 'max-w-[1280px]',
  /** 表单页 */
  form: 'max-w-3xl',
} as const;

export type PageWidth = keyof typeof widthClass;

interface PageContainerProps {
  width?: PageWidth;
  /** 覆盖默认内边距等样式（如空态 py-32 text-center、首屏 py-0） */
  className?: string;
  children: React.ReactNode;
}

/** 页面统一容器：水平居中 + px-6 + 默认 py-12（可按需覆盖） */
export function PageContainer({ width = 'md', className, children }: PageContainerProps) {
  return (
    <div className={cn('mx-auto w-full px-6 py-12', widthClass[width], className)}>{children}</div>
  );
}
