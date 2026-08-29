import { useParams } from 'react-router-dom';
import { LyricViewer } from '@/components/LyricViewer';
import { ViewLyricShell } from '@/components/ViewLyricShell';
import type { OnlinePlatform } from '@/lib/types';

const PLATFORMS: OnlinePlatform[] = ['ncm', 'qq', 'kugou'];

export function OnlineViewLyricPage() {
  const { platform, songId } = useParams<{ platform: string; songId: string }>();
  const validPlatform = PLATFORMS.includes(platform as OnlinePlatform)
    ? (platform as OnlinePlatform)
    : null;

  const invalid = !validPlatform || !songId;

  return (
    <ViewLyricShell
      error={
        invalid
          ? {
              title: '参数错误',
              description: '平台或歌曲 ID 无效',
              fallbackTo: '/lyrics-search',
              fallbackLabel: '返回平台搜索',
            }
          : undefined
      }
      backTo="/lyrics-search"
      backLabel="返回平台搜索"
    >
      {validPlatform && songId && (
        <LyricViewer
          online={{ platform: validPlatform, songId: decodeURIComponent(songId) }}
          showHeader
        />
      )}
    </ViewLyricShell>
  );
}
