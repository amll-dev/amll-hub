import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';

/** 404 页面：简单居中提示 + 返回首页按钮 */
export function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 py-32 text-center">
      <p className="text-7xl font-bold tracking-tight text-primary">404</p>
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">页面不存在</h1>
      <p className="mt-3 text-sm text-ink-2">你访问的页面可能已被移除，或链接地址有误。</p>
      <Link
        to="/"
        className="mt-8 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        <Home className="h-4 w-4" />
        返回首页
      </Link>
    </div>
  );
}
