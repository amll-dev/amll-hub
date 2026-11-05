import { useCallback } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { extractNcmSongId } from '@/lib/ncm';
import { qmMusicToNcmInfo, qmPlaylistToNcm, qmToLyricLines } from '@/lib/qm';
import { searchPlatformSongs } from '@/lib/song-search';
import { queryKeys } from '@/lib/query';
import {
  QM_QUALITY_LABEL,
  QM_QUALITY_ORDER,
  type MusicPlatform,
  type NcmPlaylistDetail,
  type NcmSong,
  type QmQuality,
} from '@/lib/types';
import { NCM_QUALITY_LABEL, NCM_QUALITY_ORDER, qualityAtom, type NcmQuality } from '@/atoms/player';
import {
  parsePlatformAtom,
  ncmSearchQueryAtom,
  ncmHideSearchListAtom,
  ncmParsedSongAtom,
  ncmParseLoadingAtom,
  ncmParseErrorAtom,
  ncmSongIdInputAtom,
  ncmPlaylistIdAtom,
  ncmQualityAtom,
  qmQualityAtom,
  type ParsedSong,
} from '@/atoms/ncmParse';

export type { ParsedSong };

/** 音质下拉项 */
export interface QualityOption {
  value: string;
  label: string;
}

export interface NcmParseContextValue {
  platform: MusicPlatform;
  setPlatform: (p: MusicPlatform) => void;

  // 搜索歌曲
  searchSongs: NcmSong[] | null;
  searchLoading: boolean;
  searchError: string | null;
  /** 点击搜索结果后隐藏列表，重新搜索时恢复 */
  hideSearchList: boolean;
  doSearch: (q: string) => Promise<void>;

  // 解析结果
  parsedSong: ParsedSong | null;
  parseLoading: boolean;
  parseError: string | null;
  parseSong: (
    songId: string,
    meta: { name?: string; artists?: string; cover?: string; duration?: number }
  ) => Promise<void>;

  // 歌曲 ID 解析输入框
  songIdInput: string;
  setSongIdInput: (v: string) => void;

  // 音质
  /** 解析页当前生效的网易云音质：页面手动选过就用它，否则跟随播放器全局音质 */
  quality: NcmQuality;
  /** 页面级待应用音质（null = 跟随全局） */
  pageQuality: NcmQuality | null;
  setPageQuality: (q: NcmQuality | null) => void;
  /** 把页面选择同步到全局音质（真正解析 / 播放前调用） */
  applyQuality: () => NcmQuality;
  /** 当前音源对应的音质下拉项 */
  qualityOptions: QualityOption[];
  /** 当前音源选中的音质值 */
  qualityValue: string;
  setQualityValue: (v: string) => void;

  // 解析歌单
  playlistDetail: NcmPlaylistDetail | null;
  playlistLoading: boolean;
  playlistError: string | null;
  doParsePlaylist: (id: string) => Promise<void>;
}

/** 解析页状态 */
export function useNcmParse(): NcmParseContextValue {
  const searchQuery = useAtomValue(ncmSearchQueryAtom);
  const hideSearchList = useAtomValue(ncmHideSearchListAtom);
  const parsedSong = useAtomValue(ncmParsedSongAtom);
  const parseLoading = useAtomValue(ncmParseLoadingAtom);
  const parseError = useAtomValue(ncmParseErrorAtom);
  const playlistId = useAtomValue(ncmPlaylistIdAtom);
  const globalQuality = useAtomValue(qualityAtom);

  const [platform, setPlatformAtom] = useAtom(parsePlatformAtom);
  const [, setHideSearchList] = useAtom(ncmHideSearchListAtom);
  const [, setSearchQuery] = useAtom(ncmSearchQueryAtom);
  const [, setParsedSong] = useAtom(ncmParsedSongAtom);
  const [, setParseLoading] = useAtom(ncmParseLoadingAtom);
  const [, setParseError] = useAtom(ncmParseErrorAtom);
  const [songIdInput, setSongIdInput] = useAtom(ncmSongIdInputAtom);
  const [, setPlaylistId] = useAtom(ncmPlaylistIdAtom);
  const [pageQuality, setPageQuality] = useAtom(ncmQualityAtom);
  const [qmQuality, setQmQuality] = useAtom(qmQualityAtom);
  const [, setGlobalQuality] = useAtom(qualityAtom);

  const isQQ = platform === 'qq';
  // 页面没手动选过就跟随播放器全局音质
  const quality = pageQuality ?? globalQuality;

  const searchQueryResult = useQuery({
    queryKey: isQQ ? queryKeys.qmSearch(searchQuery) : queryKeys.ncmSearch(searchQuery),
    queryFn: () => searchPlatformSongs(platform, searchQuery),
    enabled: !!searchQuery.trim(),
    staleTime: 60_000,
  });

  const playlistQuery = useQuery({
    queryKey: queryKeys.ncmPlaylist(playlistId),
    queryFn: () => api.parseNcmPlaylist(playlistId),
    enabled: !isQQ && !!playlistId.trim(),
    staleTime: 60_000,
  });

  const qmPlaylistQuery = useQuery({
    queryKey: queryKeys.qmPlaylist(playlistId),
    queryFn: () => api.parseQmPlaylist(playlistId),
    enabled: isQQ && !!playlistId.trim(),
    staleTime: 60_000,
  });

  /** 切换音源：清掉上一个音源的解析结果，避免新旧数据串台 */
  const setPlatform = useCallback(
    (p: MusicPlatform) => {
      if (p === platform) return;
      setPlatformAtom(p);
      setParsedSong(null);
      setParseError(null);
      setPlaylistId('');
    },
    [platform, setPlatformAtom, setParsedSong, setParseError, setPlaylistId]
  );

  const doSearch = useCallback(
    async (q: string) => {
      setHideSearchList(false);
      setSearchQuery(q.trim());
      // await 语义保留：内部等待不影响调用方（调用方均未消费返回值）
    },
    [setHideSearchList, setSearchQuery]
  );

  /** 解析歌曲 */
  const parseSong = useCallback(
    async (
      songId: string,
      meta: { name?: string; artists?: string; cover?: string; duration?: number }
    ) => {
      // 分享链接先归一成纯 ID
      const id = isQQ ? unifyQmInput(songId) : extractNcmSongId(songId);
      setParseLoading(true);
      setParseError(null);
      setHideSearchList(true);
      setSongIdInput(id);
      // 真正解析时才把页面选择同步到全局，播放器与歌词页的音质随之对齐
      if (!isQQ) setGlobalQuality(quality);

      try {
        if (isQQ) {
          const res = await api.parseQmMusic(id, qmQuality);
          // 先填播放信息，歌词异步补充
          setParsedSong({
            songId: id,
            platform: 'qq',
            info: qmMusicToNcmInfo(res),
            metaDuration: meta.duration,
            lyricLines: null,
            lyricError: null,
          });

          try {
            const { parseTTML } = await import('@applemusic-like-lyrics/lyric');
            const ttml = await api.getQqLyricTtml(id);
            if (ttml) {
              setParsedSong((prev) =>
                prev ? { ...prev, lyricLines: parseTTML(ttml).lines } : prev
              );
              return;
            }
          } catch (e) {
            setParsedSong((prev) =>
              prev ? { ...prev, lyricError: e instanceof Error ? e.message : '获取歌词失败' } : prev
            );
          }

          setParsedSong((prev) =>
            prev ? { ...prev, lyricLines: qmToLyricLines(res.lyrics) } : prev
          );
          return;
        }

        const info = await api.parseNcmMusic(id, quality);
        // 先填充播放信息，歌词异步获取（避免阻塞播放按钮）
        setParsedSong({
          songId: id,
          platform: 'ncm',
          info,
          metaDuration: meta.duration,
          lyricLines: null,
          lyricError: null,
        });

        // 获取歌词
        try {
          const { parseLrc, parseTTML } = await import('@applemusic-like-lyrics/lyric');
          // ① ncm-lyrics/{songId} TTML
          const ttml = await api.getNcmLyricTtml(id);
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
      isQQ,
      qmQuality,
      quality,
      setParseLoading,
      setParseError,
      setHideSearchList,
      setSongIdInput,
      setGlobalQuality,
      setParsedSong,
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
    if (!isQQ) setGlobalQuality(quality);
    return quality;
  }, [isQQ, quality, setGlobalQuality]);

  const qualityOptions: QualityOption[] = isQQ
    ? QM_QUALITY_ORDER.map((q) => ({ value: q, label: QM_QUALITY_LABEL[q] }))
    : NCM_QUALITY_ORDER.map((q) => ({ value: q, label: NCM_QUALITY_LABEL[q] }));

  const setQualityValue = useCallback(
    (v: string) => {
      if (isQQ) setQmQuality(v as QmQuality);
      else setPageQuality(v as NcmQuality);
    },
    [isQQ, setQmQuality, setPageQuality]
  );

  const searchSongs: NcmSong[] | null = searchQueryResult.data ?? null;

  const searchError = searchQueryResult.error as Error | null;

  const playlistDetail: NcmPlaylistDetail | null = isQQ
    ? qmPlaylistQuery.data?.playlist
      ? qmPlaylistToNcm(qmPlaylistQuery.data.playlist)
      : null
    : (playlistQuery.data?.playlist ?? null);

  const playlistError = (isQQ ? qmPlaylistQuery.error : playlistQuery.error) as Error | null;

  return {
    platform,
    setPlatform,
    searchSongs,
    searchLoading: searchQueryResult.isFetching,
    searchError: searchError ? searchError.message || '搜索失败' : null,
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
    qualityOptions,
    qualityValue: isQQ ? qmQuality : quality,
    setQualityValue,
    playlistDetail,
    playlistLoading: isQQ ? qmPlaylistQuery.isFetching : playlistQuery.isFetching,
    playlistError: playlistError ? playlistError.message || '解析失败' : null,
    doParsePlaylist,
  };
}

/** QQ 输入归一 */
function unifyQmInput(input: string): string {
  const text = input.trim();
  const fromQuery = /[?&]songmid=([0-9A-Za-z]+)/.exec(text);
  if (fromQuery?.[1]) return fromQuery[1];
  const fromPath = /songDetail\/([0-9A-Za-z]+)/.exec(text);
  if (fromPath?.[1]) return fromPath[1];
  return text;
}
