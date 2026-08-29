import { atom } from 'jotai';
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

// ===== 网易云解析 atoms（全局唯一且跨路由持久，替代原 NcmParseProvider） =====

/** 已提交的搜索词（点击搜索时更新），驱动搜索 Query */
export const ncmSearchQueryAtom = atom('');
/** 点击搜索结果后隐藏列表，重新搜索时恢复 */
export const ncmHideSearchListAtom = atom(false);

export const ncmParsedSongAtom = atom<ParsedSong | null>(null);
export const ncmParseLoadingAtom = atom(false);
export const ncmParseErrorAtom = atom<string | null>(null);
/** 歌曲 ID 解析输入框 */
export const ncmSongIdInputAtom = atom('');

/** 已提交的歌单 ID，驱动歌单 Query */
export const ncmPlaylistIdAtom = atom('');

// ===== 派生数据（Query 结果由 hook 侧映射，atoms 只存提交源） =====
export type { NcmSong, NcmPlaylistDetail };
