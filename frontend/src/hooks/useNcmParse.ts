import { createContext, useContext } from 'react';
import type { LyricLine } from '@applemusic-like-lyrics/lyric';
import type { NcmMusicInfo, NcmPlaylistDetail, NcmSong } from '@/lib/types';

/** 点击搜索结果后解析出的歌曲 */
export interface ParsedSong {
  songId: string;
  info: NcmMusicInfo;
  /** 从搜索结果/歌单项传入的时长 */
  metaDuration?: number;
  /** 解析后的歌词行 */
  lyricLines: LyricLine[] | null;
  /** 歌词获取错误（不影响播放信息） */
  lyricError: string | null;
}

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

  // ===== 解析歌单 =====
  playlistDetail: NcmPlaylistDetail | null;
  playlistLoading: boolean;
  playlistError: string | null;
  doParsePlaylist: (id: string) => Promise<void>;
}

/** 网易云解析页状态 Context 实例（Provider 在 context/NcmParseContext.tsx） */
export const NcmParseContext = createContext<NcmParseContextValue | null>(null);

/** 读取网易云解析状态 Context，必须在 NcmParseProvider 内使用 */
export function useNcmParse() {
  const ctx = useContext(NcmParseContext);
  if (!ctx) {
    throw new Error('useNcmParse must be used within NcmParseProvider');
  }
  return ctx;
}
