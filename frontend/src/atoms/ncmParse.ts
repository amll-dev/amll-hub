import { atom } from 'jotai';
import type { LyricLine } from '@applemusic-like-lyrics/lyric';
import type {
  MusicPlatform,
  NcmMusicInfo,
  NcmPlaylistDetail,
  NcmSong,
  QmQuality,
} from '@/lib/types';
import type { NcmQuality } from '@/atoms/player';

/** 点击搜索结果后解析出的歌曲 */
export interface ParsedSong {
  songId: string;
  /** 曲目来源平台 */
  platform: MusicPlatform;
  info: NcmMusicInfo;
  /** 从搜索结果/歌单项传入的时长 */
  metaDuration?: number;
  /** 解析后的歌词行 */
  lyricLines: LyricLine[] | null;
  /** 歌词获取错误（不影响播放信息） */
  lyricError: string | null;
}

// 解析页 atoms

/** 当前音源 */
export const parsePlatformAtom = atom<MusicPlatform>('ncm');

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

export const ncmQualityAtom = atom<NcmQuality | null>(null);

/** QM 音质 */
export const qmQualityAtom = atom<QmQuality>('hq');

// ===== 派生数据（Query 结果由 hook 侧映射，atoms 只存提交源） =====
export type { NcmSong, NcmPlaylistDetail };
