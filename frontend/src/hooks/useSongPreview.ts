import { useEffect, useState } from 'react';

interface SongPreviewState<T> {
  info: T | null;
  loading: boolean;
  error: string;
}

/** 拉取平台歌曲信息，供 NcmSongCard / QmSongCard 复用 */
export function useSongPreview<T>(
  songId: string,
  fetcher: (songId: string) => Promise<T>
): SongPreviewState<T> {
  const [info, setInfo] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!songId) {
      setInfo(null);
      setError('');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');
    fetcher(songId)
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '解析失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [songId, fetcher]);

  return { info, loading, error };
}
