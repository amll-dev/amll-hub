import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { AlertTriangle, Home, RotateCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 全局兜底错误边界：包住 RouterProvider。
 * 捕获路由 errorElement 覆盖不到的渲染异常（如 RouterProvider 自身、
 * errorElement 内部再抛错），避免整页白屏。
 */
export class GlobalErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[GlobalErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <FallbackUI
        title="页面出错了"
        message={this.state.error.message}
        onReload={() => window.location.reload()}
      />
    );
  }
}

/**
 * 路由级错误边界（createBrowserRouter 的 errorElement）。
 * 懒加载 chunk 加载失败、页面组件渲染异常都会落到这里，
 * 区分路由错误响应（isRouteErrorResponse）与意外异常分别展示。
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) {
    return (
      <FallbackUI
        title={`请求出错（${error.status}）`}
        message={error.statusText || error.data}
        onReload={() => window.location.reload()}
      />
    );
  }
  const message = error instanceof Error ? error.message : undefined;
  return (
    <FallbackUI title="页面出错了" message={message} onReload={() => window.location.reload()} />
  );
}

/** 错误兜底 UI：路由级（errorElement）与全局错误边界共用 */
export function FallbackUI({
  title,
  message,
  onReload,
}: {
  title: string;
  message?: string;
  onReload: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft">
        <AlertTriangle className="h-7 w-7 text-primary" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="max-w-md text-sm text-ink-3">
          {message || '页面加载时发生了意外错误，请重试。'}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onReload}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          <RotateCw className="h-4 w-4" />
          重试
        </button>
        <a
          href="/"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-input bg-card px-5 text-sm font-medium text-primary transition-colors hover:bg-primary-soft"
        >
          <Home className="h-4 w-4" />
          回到首页
        </a>
      </div>
    </div>
  );
}
