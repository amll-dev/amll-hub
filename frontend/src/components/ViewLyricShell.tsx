import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { buttonTap } from '@/lib/motion';

export interface ViewLyricShellProps {
  /** 参数校验失败时展示的错误信息（title + description + 返回入口） */
  error?: { title: string; description: string; fallbackTo?: string; fallbackLabel?: string };
  /** 正常态返回按钮的路径与文案 */
  backTo: string;
  backLabel: string;
  children: ReactNode;
}

/**
 * 歌词查看页外壳：ViewLyricPage / OnlineViewLyricPage 共用。
 * 参数错误态（900px 居中提示块）与正常态（900px 容器 + 返回按钮）同构，
 * 抽成一个组件消除两页的逐行重复。
 */
export function ViewLyricShell({ error, backTo, backLabel, children }: ViewLyricShellProps) {
  if (error) {
    return (
      <div className="mx-auto max-w-[900px] px-6 py-16 text-center">
        <h1 className="text-xl font-bold text-error">{error.title}</h1>
        <p className="mt-2 text-sm text-ink-2">{error.description}</p>
        <Link
          to={error.fallbackTo ?? '/'}
          className="mt-6 inline-block text-sm text-primary hover:underline"
        >
          {error.fallbackLabel ?? '返回首页'}
        </Link>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
      className="mx-auto max-w-[900px] px-6 py-8"
    >
      {/* 返回按钮 */}
      <div className="mb-6">
        <Link
          to={backTo}
          {...buttonTap}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-card px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:border-primary hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel}
        </Link>
      </div>

      {children}
    </motion.div>
  );
}
