import { api } from '@/lib/api';
import { usePlayer } from '@/hooks/usePlayer';
import { useSongPreview } from '@/hooks/useSongPreview';
import { qmCoverProxy } from '@/lib/qm';
import { SongPreviewCard, SongPreviewStatus } from '@/components/submission/SongPreviewCard';

/** QM 歌曲信息卡片 */
export function QmSongCard({ songId, ttml }: { songId: string; ttml?: string }) {
  const { playNcmSong, openLyricsPage, loading: playerLoading } = usePlayer();
  const { info, loading, error } = useSongPreview(songId, api.parseQmMusic);

  const handlePlay = async () => {
    if (!songId) return;
    try {
      await playNcmSong(songId, {
        name: info?.name,
        artists: info?.artistName,
        // 背景取色需要 CORS，封面走后台代理
        cover: qmCoverProxy(info?.cover, 800),
        platform: 'qq',
        level: info?.level,
        customTtml: ttml,
      });
      openLyricsPage();
    } catch {
      // 静默，错误已由 PlayerContext 处理
    }
  };

  if (loading || error) {
    return <SongPreviewStatus loading={loading} error={error} platformLabel="QQ 音乐" />;
  }
  if (!info) return null;

  return (
    <SongPreviewCard
      cover={qmCoverProxy(info.cover, 300)}
      name={info.name}
      artists={info.artistName}
      songId={songId}
      platform="qq"
      canPlay={!!info.url}
      playing={playerLoading}
      onPlay={() => void handlePlay()}
    />
  );
}
