import { useEffect, useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { api } from '@/lib/api';
import { usePlayer } from '@/hooks/usePlayer';
import type { NcmMusicInfo } from '@/lib/types';

/** 网易云歌曲信息卡片 */
export function NcmSongCard({ songId, ttml }: { songId: string; ttml?: string }) {
  const { playNcmSong, openLyricsPage, loading: playerLoading } = usePlayer();
  const [info, setInfo] = useState<NcmMusicInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!songId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .parseNcmMusic(songId)
      .then((d) => {
        if (cancelled) return;
        setInfo(d);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '解析失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [songId]);

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

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-3">
        <Loader2 className="h-4 w-4 animate-spin" />
        正在解析网易云歌曲信息…
      </div>
    );
  }
  if (error) {
    return <p className="text-sm text-ink-3">网易云解析失败：{error}</p>;
  }
  if (!info) return null;

  const durationStr = info.duration
    ? `${Math.floor(info.duration / 60000)}:${String(Math.floor((info.duration % 60000) / 1000)).padStart(2, '0')}`
    : '';

  return (
    <div className="relative flex gap-4 rounded-lg border border-line bg-surface-2 p-4">
      {info.cover && (
        <img
          src={info.cover}
          alt={info.name || '封面'}
          className="h-20 w-20 shrink-0 rounded-lg border border-line object-cover"
        />
      )}
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        {info.name && (
          <div className="truncate text-base font-semibold text-foreground">{info.name}</div>
        )}
        {info.artists && (
          <div className="text-ink-2">
            <span className="text-ink-3">艺术家：</span>
            {info.artists}
          </div>
        )}
        {durationStr && <div className="text-ink-3">时长：{durationStr}</div>}
        <div className="text-ink-3">ID：{songId}</div>
      </div>
      {info.url && (
        <div className="absolute right-4 top-1/2 flex -translate-y-1/2 shrink-0 gap-2">
          <button
            type="button"
            onClick={handlePlay}
            disabled={playerLoading}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {playerLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            播放
          </button>
        </div>
      )}
    </div>
  );
}
