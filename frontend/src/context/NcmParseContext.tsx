import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import type { NcmPlaylistDetail, NcmSong } from '@/lib/types';
import { usePlayer } from '@/hooks/usePlayer';
import { NcmParseContext, type ParsedSong } from '@/hooks/useNcmParse';

/**
 * 持久化网易云解析页的内部 state
 */
export function NcmParseProvider({ children }: { children: ReactNode }) {
  const { quality } = usePlayer();

  const [searchSongs, setSearchSongs] = useState<NcmSong[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hideSearchList, setHideSearchList] = useState(false);

  const [parsedSong, setParsedSong] = useState<ParsedSong | null>(null);
  const [parseLoading, setParseLoading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [songIdInput, setSongIdInput] = useState('');

  const [playlistDetail, setPlaylistDetail] = useState<NcmPlaylistDetail | null>(null);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);

  const doSearch = useCallback(async (q: string) => {
    setSearchLoading(true);
    setSearchError(null);
    setHideSearchList(false);
    try {
      const res = await api.searchNcm(q);
      setSearchSongs(res.data ?? []);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : '搜索失败');
      setSearchSongs(null);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  /** 解析歌曲 */
  const parseSong = useCallback(
    async (
      songId: string,
      meta: { name?: string; artists?: string; cover?: string; duration?: number }
    ) => {
      setParseLoading(true);
      setParseError(null);
      setHideSearchList(true);
      setSongIdInput(songId);
      try {
        const info = await api.parseNcmMusic(songId, quality);
        // 先填充播放信息，歌词异步获取
        setParsedSong({
          songId,
          info,
          metaDuration: meta.duration,
          lyricLines: null,
          lyricError: null,
        });

        // 获取歌词
        try {
          const { parseLrc, parseTTML } = await import('@applemusic-like-lyrics/lyric');
          const ttml = await api.getNcmLyricTtml(songId);
          if (ttml) {
            setParsedSong((prev) => (prev ? { ...prev, lyricLines: parseTTML(ttml).lines } : prev));
            return;
          }
          if (info.lyric) {
            const lines = parseLrc(info.lyric);
            if (info.tlyric) {
              const transLines = parseLrc(info.tlyric);
              const transMap = new Map<number, string>();
              for (const t of transLines) {
                transMap.set(Math.round(t.startTime), t.words[0]?.word ?? '');
              }
              for (const m of lines) {
                m.translatedLyric = transMap.get(Math.round(m.startTime)) ?? '';
              }
            }
            setParsedSong((prev) => (prev ? { ...prev, lyricLines: lines } : prev));
            return;
          }
          setParsedSong((prev) => (prev ? { ...prev, lyricLines: null } : prev));
        } catch (e) {
          setParsedSong((prev) =>
            prev ? { ...prev, lyricError: e instanceof Error ? e.message : '获取歌词失败' } : prev
          );
        }
      } catch (e) {
        setParseError(e instanceof Error ? e.message : '解析失败');
        setParsedSong(null);
      } finally {
        setParseLoading(false);
      }
    },
    [quality]
  );

  const doParsePlaylist = useCallback(async (id: string) => {
    setPlaylistLoading(true);
    setPlaylistError(null);
    try {
      const res = await api.parseNcmPlaylist(id);
      setPlaylistDetail(res.playlist ?? null);
    } catch (e) {
      setPlaylistError(e instanceof Error ? e.message : '解析失败');
      setPlaylistDetail(null);
    } finally {
      setPlaylistLoading(false);
    }
  }, []);

  const value = useMemo(
    () => ({
      searchSongs,
      searchLoading,
      searchError,
      hideSearchList,
      doSearch,
      parsedSong,
      parseLoading,
      parseError,
      parseSong,
      songIdInput,
      setSongIdInput,
      playlistDetail,
      playlistLoading,
      playlistError,
      doParsePlaylist,
    }),
    [
      searchSongs,
      searchLoading,
      searchError,
      hideSearchList,
      doSearch,
      parsedSong,
      parseLoading,
      parseError,
      parseSong,
      songIdInput,
      setSongIdInput,
      playlistDetail,
      playlistLoading,
      playlistError,
      doParsePlaylist,
    ]
  );

  return <NcmParseContext.Provider value={value}>{children}</NcmParseContext.Provider>;
}
