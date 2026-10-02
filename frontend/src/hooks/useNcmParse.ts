import { useCallback } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import type { NcmPlaylistDetail, NcmSong } from '@/lib/types';
import { qualityAtom, type NcmQuality } from '@/atoms/player';
import {
  ncmSearchQueryAtom,
  ncmHideSearchListAtom,
  ncmParsedSongAtom,
  ncmParseLoadingAtom,
  ncmParseErrorAtom,
  ncmSongIdInputAtom,
  ncmPlaylistIdAtom,
  ncmQualityAtom,
  type ParsedSong,
} from '@/atoms/ncmParse';

export type { ParsedSong };

export interface NcmParseContextValue {
  // ===== 搜索歌曲 =====
  searchSongs: NcmSong[] | null;
  searchLoading: boolean;
  searchError: string | null;
  /** 点击搜索结果后隐藏列表，重新搜索时恢复 */
  hideSearchList: boolean;
  doSearch: (q: string) => Promise<void>;

  // ===== 解析结果 =====
  parsedSong: ParsedSong | null;
  parseLoading: boolean;
  parseError: string | null;
  parseSong: (
    songId: string,
    meta: { name?: string; artists?: string; cover?: string; duration?: number }
  ) => Promise<void>;

  // ===== 歌曲 ID 解析输入框 =====
  songIdInput: string;
  setSongIdInput: (v: string) => void;

  // ===== 音质 =====
  /** 解析页当前生效的音质：页面手动选过就用它，否则跟随播放器全局音质 */
  quality: NcmQuality;
  /** 页面级待应用音质（null = 跟随全局） */
  pageQuality: NcmQuality | null;
  setPageQuality: (q: NcmQuality | null) => void;
  /** 把页面选择同步到全局音质（真正解析 / 播放前调用） */
  applyQuality: () => NcmQuality;

  // ===== 解析歌单 =====
  playlistDetail: NcmPlaylistDetail | null;
  playlistLoading: boolean;
  playlistError: string | null;
  doParsePlaylist: (id: string) => Promise<void>;
}

/**
 * 网易云解析页状态（jotai atoms，全局唯一且天然跨路由持久——
 * 原先靠 Provider 提到 Layout 层级实现，atoms 化后不再需要）。
 * 搜索/歌单解析是可缓存的 GET，交给 TanStack Query（按关键词/歌单 ID 去重缓存）；
 * parseSong 是用户点击触发的命令式流程（先渲染播放信息、歌词异步补充、
 * 结果驱动播放器而非列表渲染），保留手写实现。
 */
export function useNcmParse(): NcmParseContextValue {
  const searchQuery = useAtomValue(ncmSearchQueryAtom);
  const hideSearchList = useAtomValue(ncmHideSearchListAtom);
  const parsedSong = useAtomValue(ncmParsedSongAtom);
  const parseLoading = useAtomValue(ncmParseLoadingAtom);
  const parseError = useAtomValue(ncmParseErrorAtom);
  const playlistId = useAtomValue(ncmPlaylistIdAtom);
  const globalQuality = useAtomValue(qualityAtom);

  const [, setHideSearchList] = useAtom(ncmHideSearchListAtom);
  const [, setSearchQuery] = useAtom(ncmSearchQueryAtom);
  const [, setParsedSong] = useAtom(ncmParsedSongAtom);
  const [, setParseLoading] = useAtom(ncmParseLoadingAtom);
  const [, setParseError] = useAtom(ncmParseErrorAtom);
  const [songIdInput, setSongIdInput] = useAtom(ncmSongIdInputAtom);
  const [, setPlaylistId] = useAtom(ncmPlaylistIdAtom);
  const [pageQuality, setPageQuality] = useAtom(ncmQualityAtom);
  const [, setGlobalQuality] = useAtom(qualityAtom);

  // 页面没手动选过就跟随播放器全局音质
  const quality = pageQuality ?? globalQuality;

  const searchNcmQuery = useQuery({
    queryKey: queryKeys.ncmSearch(searchQuery),
    queryFn: () => api.searchNcm(searchQuery),
    enabled: !!searchQuery.trim(),
    staleTime: 60_000,
  });

  const playlistQuery = useQuery({
    queryKey: queryKeys.ncmPlaylist(playlistId),
    queryFn: () => api.parseNcmPlaylist(playlistId),
    enabled: !!playlistId.trim(),
    staleTime: 60_000,
  });

  const doSearch = useCallback(
    async (q: string) => {
      setHideSearchList(false);
      setSearchQuery(q.trim());
      // await 语义保留：内部等待不影响调用方（调用方均未消费返回值）
    },
    [setHideSearchList, setSearchQuery]
  );

  /** 解析歌曲：获取播放链接 + 歌词。歌词三级回退：① ncm-lyrics TTML → ② LRC（合并翻译）→ ③ 无歌词 */
  const parseSong = useCallback(
    async (
      songId: string,
      meta: { name?: string; artists?: string; cover?: string; duration?: number }
    ) => {
      setParseLoading(true);
      setParseError(null);
      setHideSearchList(true);
      setSongIdInput(songId);
      // 真正解析时才把页面选择同步到全局，播放器与歌词页的音质随之对齐
      setGlobalQuality(quality);
      try {
        const info = await api.parseNcmMusic(songId, quality);
        // 先填充播放信息，歌词异步获取（避免阻塞播放按钮）
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
          // ① ncm-lyrics/{songId} TTML
          const ttml = await api.getNcmLyricTtml(songId);
          if (ttml) {
            setParsedSong((prev) => (prev ? { ...prev, lyricLines: parseTTML(ttml).lines } : prev));
            return;
          }
          // ② 网易云返回的 LRC（合并翻译）
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
          // ③ 无歌词
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
    [
      setParseLoading,
      setParseError,
      setHideSearchList,
      setSongIdInput,
      setGlobalQuality,
      setParsedSong,
      quality,
    ]
  );

  const doParsePlaylist = useCallback(
    async (id: string) => {
      setPlaylistId(id.trim());
    },
    [setPlaylistId]
  );

  /** 把页面级音质选择同步到全局，返回生效的音质 */
  const applyQuality = useCallback(() => {
    setGlobalQuality(quality);
    return quality;
  }, [quality, setGlobalQuality]);

  return {
    searchSongs: (searchNcmQuery.data?.data as NcmSong[] | undefined) ?? null,
    searchLoading: searchNcmQuery.isFetching,
    searchError: searchNcmQuery.error
      ? searchNcmQuery.error instanceof Error
        ? searchNcmQuery.error.message
        : '搜索失败'
      : null,
    hideSearchList,
    doSearch,
    parsedSong,
    parseLoading,
    parseError,
    parseSong,
    songIdInput,
    setSongIdInput,
    quality,
    pageQuality,
    setPageQuality,
    applyQuality,
    playlistDetail: playlistQuery.data?.playlist ?? null,
    playlistLoading: playlistQuery.isFetching,
    playlistError: playlistQuery.error
      ? playlistQuery.error instanceof Error
        ? playlistQuery.error.message
        : '解析失败'
      : null,
    doParsePlaylist,
  };
}
