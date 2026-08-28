import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { LyricViewer } from '@/components/LyricViewer';
import { buttonTap } from '@/lib/motion';
import type { OnlinePlatform } from '@/lib/types';

const PLATFORMS: OnlinePlatform[] = ['ncm', 'qq', 'kugou'];

export function OnlineViewLyricPage() {
  const { platform, songId } = useParams<{ platform: string; songId: string }>();
  const validPlatform = PLATFORMS.includes(platform as OnlinePlatform)
    ? (platform as OnlinePlatform)
    : null;

  if (!validPlatform || !songId) {
    return (
      <div className="mx-auto max-w-[900px] px-6 py-16 text-center">
        <h1 className="text-xl font-bold text-error">参数错误</h1>
        <p className="mt-2 text-sm text-ink-2">平台或歌曲 ID 无效</p>
        <Link
          to="/lyrics-search"
          className="mt-6 inline-block text-sm text-primary hover:underline"
        >
          返回平台搜索
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
          to="/lyrics-search"
          {...buttonTap}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-card px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:border-primary hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          返回平台搜索
        </Link>
      </div>

      <LyricViewer
        online={{ platform: validPlatform, songId: decodeURIComponent(songId) }}
        showHeader
      />
    </motion.div>
  );
}
