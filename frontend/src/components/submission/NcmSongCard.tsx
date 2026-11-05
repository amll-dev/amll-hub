import { api } from '@/lib/api';
import { usePlayer } from '@/hooks/usePlayer';
import { useSongPreview } from '@/hooks/useSongPreview';
import { SongPreviewCard, SongPreviewStatus } from '@/components/submission/SongPreviewCard';

/** 网易云歌曲信息卡片 */
export function NcmSongCard({ songId, ttml }: { songId: string; ttml?: string }) {
  const { playNcmSong, openLyricsPage, loading: playerLoading } = usePlayer();
  const { info, loading, error } = useSongPreview(songId, api.parseNcmMusic);

  // 播放
  const handlePlay = async () => {
    if (!songId) return;
    try {
      await playNcmSong(songId, {
        name: info?.name,
        artists: info?.artists,
        cover: info?.cover,
        customTtml: ttml,
      });
      openLyricsPage();
    } catch {
      // 静默，错误已由 PlayerContext 处理
    }
  };

  if (loading || error) {
    return <SongPreviewStatus loading={loading} error={error} platformLabel="网易云" />;
  }
  if (!info) return null;

  return (
    <SongPreviewCard
      cover={info.cover}
      name={info.name}
      artists={info.artists}
      durationMs={info.duration}
      songId={songId}
      platform="ncm"
      canPlay={!!info.url}
      playing={playerLoading}
      onPlay={() => void handlePlay()}
    />
  );
}
