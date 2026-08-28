import { useCallback, useRef, useState } from 'react';
import type { OnlineLyric, OnlinePlatform, OnlineSearchHit, OnlineSearchResult, OnlineSongDetail } from '@/lib/types';
import { api } from '@/lib/api';

export interface OnlineSearchContextValue {
  // 搜索
  /** 输入框当前值（未提交） */
  inputValue: string;
  setInputValue: (v: string) => void;
  query: string;
  setQuery: (v: string) => void;
  platform: OnlinePlatform;
  setPlatform: (v: OnlinePlatform) => void;
  searchLoading: boolean;
  searchError: string | null;
  searchResults: OnlineSearchResult | null;
  /** @param overrideQ 覆盖搜索词 @param overridePlatform 覆盖平台（切换平台立即重搜时传入，避免闭包旧值） */
  doSearch: (q?: string, overridePlatform?: OnlinePlatform) => Promise<void>;

  // 歌曲详情
  selectedSong: OnlineSongDetail | null;
  songLoading: boolean;
  songError: string | null;

  // 歌词
  lyric: OnlineLyric | null;
  lyricLoading: boolean;
  lyricError: string | null;

  // 选中搜索结果（触发加载详情 + 歌词）
  selectSong: (hit: OnlineSearchHit) => Promise<void>;
}

export function useOnlineSearch(): OnlineSearchContextValue {
  const [inputValue, setInputValue] = useState('');
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState<OnlinePlatform>('ncm');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<OnlineSearchResult | null>(null);

  const [selectedSong, setSelectedSong] = useState<OnlineSongDetail | null>(null);
  const [songLoading, setSongLoading] = useState(false);
  const [songError, setSongError] = useState<string | null>(null);

  const [lyric, setLyric] = useState<OnlineLyric | null>(null);
  const [lyricLoading, setLyricLoading] = useState(false);
  const [lyricError, setLyricError] = useState<string | null>(null);

  // 请求序号，防止竞态
  const searchSeq = useRef(0);
  const songSeq = useRef(0);

  const doSearch = useCallback(
    async (overrideQ?: string, overridePlatform?: OnlinePlatform) => {
      const q = (overrideQ ?? query).trim();
      const p = overridePlatform ?? platform;
      if (!q) return;

      // 同步已提交搜索词（页面不再单独调 setQuery）
      setQuery(q);

      const seq = ++searchSeq.current;
      setSearchLoading(true);
      setSearchError(null);
      setSearchResults(null);
      // 切换搜索时清空详情
      setSelectedSong(null);
      setSongError(null);
      setLyric(null);
      setLyricError(null);

      try {
        const result = await api.onlineSearch(q, p);
        if (seq !== searchSeq.current) return;
        setSearchResults(result);
      } catch (err) {
        if (seq !== searchSeq.current) return;
        setSearchError(err instanceof Error ? err.message : '搜索失败');
      } finally {
        if (seq === searchSeq.current) setSearchLoading(false);
      }
    },
    [query, platform],
  );

  const selectSong = useCallback(
    async (hit: OnlineSearchHit) => {
      const seq = ++songSeq.current;
      setSongLoading(true);
      setSongError(null);
      setLyricLoading(true);
      setLyric(null);
      setLyricError(null);
      setSelectedSong(null);

      try {
        const [song, lyricData] = await Promise.all([
          api.getOnlineSong(hit.platform, hit.platformId),
          api.getOnlineLyric(hit.platform, hit.platformId).catch(() => null),
        ]);
        if (seq !== songSeq.current) return;
        setSelectedSong(song);
        setLyric(lyricData);
      } catch (err) {
        if (seq !== songSeq.current) return;
        setSongError(err instanceof Error ? err.message : '获取歌曲详情失败');
      } finally {
        if (seq === songSeq.current) {
          setSongLoading(false);
          setLyricLoading(false);
        }
      }
    },
    [],
  );

  return {
    inputValue,
    setInputValue,
    query,
    setQuery,
    platform,
    setPlatform,
    searchLoading,
    searchError,
    searchResults,
    doSearch,
    selectedSong,
    songLoading,
    songError,
    lyric,
    lyricLoading,
    lyricError,
    selectSong,
  };
}
