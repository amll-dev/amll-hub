import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { LyricViewer } from '@/components/LyricViewer';
import { buttonTap } from '@/lib/motion';

export function ViewLyricPage() {
  const { filename } = useParams<{ filename: string }>();

  if (!filename) {
    return (
      <div className="mx-auto max-w-[900px] px-6 py-16 text-center">
        <h1 className="text-xl font-bold text-error">缺少文件参数</h1>
        <p className="mt-2 text-sm text-ink-2">请提供要查看的歌词文件</p>
        <Link to="/" className="mt-6 inline-block text-sm text-primary hover:underline">
          返回首页
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
          to="/"
          {...buttonTap}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-card px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:border-primary hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          返回搜索
        </Link>
      </div>

      <LyricViewer filename={filename} showHeader showActions rawLyricFile={filename} />
    </motion.div>
  );
}
