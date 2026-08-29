import { atom } from 'jotai';
import type { LyricLine } from '@applemusic-like-lyrics/lyric';
import type { SearchHit } from '@/lib/types';

// ===== 类型与常量（原 hooks/usePlayer.ts，消费方仍从 usePlayer re-export） =====

/** 正在播放的曲目信息 */
export interface PlayerTrack {
  title: string;
  artists: string;
  cover?: string;
  audioUrl: string;
  /** 关联的搜索命中 */
  hit?: SearchHit;
  /** 当前播放使用的网易云歌曲 ID */
  ncmSongId?: string;
  /** 网易云解析返回的 LRC 主歌词 */
  ncmLyric?: string;
  /** 网易云解析返回的 LRC 翻译 */
  ncmTLyric?: string;
  skipTtml?: boolean;
  /** 外部直接传入的 TTML 文本 */
  customTtml?: string;
}

/** 多 ncm id 选择弹窗的请求 */
export interface SelectRequest {
  /** 待选择的 ncm id 列表 */
  ids: string[];
  /** 关联的搜索命中 */
  hit: SearchHit;
}

/** 播放列表项 */
export interface PlaylistItem {
  songId: string;
  name: string;
  artists: string;
  cover?: string;
}

export type RepeatMode = 'off' | 'all' | 'one';

/** 网易云音质等级 */
export type NcmQuality =
  'standard' | 'exhigh' | 'lossless' | 'hires' | 'jyeffect' | 'jymaster' | 'sky' | 'dolby';

export const NCM_QUALITY_LABEL: Record<NcmQuality, string> = {
  standard: '标准',
  exhigh: '极高',
  lossless: '无损',
  hires: 'Hi-Res',
  jyeffect: '高清臻音',
  jymaster: '超清母带',
  sky: '沉浸环绕声',
  dolby: '杜比全景声',
};

export const NCM_QUALITY_ORDER: NcmQuality[] = [
  'standard',
  'exhigh',
  'lossless',
  'hires',
  'jyeffect',
  'jymaster',
  'sky',
  'dolby',
];

// ===== 播放器状态 atoms（全局唯一，替代原 PlayerProvider 内的 useState） =====

export const trackAtom = atom<PlayerTrack | null>(null);
export const playingAtom = atom(false);
/** 当前进度（秒） */
export const currentAtom = atom(0);
/** 总时长（秒） */
export const durationAtom = atom(0);
/** 加载中（解析 ncm） */
export const loadingAtom = atom(false);
export const errorAtom = atom<string | null>(null);
/** 多 id 选择弹窗：有值时弹窗显示 */
export const selectRequestAtom = atom<SelectRequest | null>(null);
export const shuffleAtom = atom(false);
export const repeatModeAtom = atom<RepeatMode>('off');
/** 当前音量（0-1） */
export const volumeAtom = atom(1);
export const mutedAtom = atom(false);
/** 歌词数据（AMLL LyricLine[]） */
export const lyricDataAtom = atom<LyricLine[] | null>(null);
export const lyricLoadingAtom = atom(false);
export const lyricErrorAtom = atom<string | null>(null);
export const qualityAtom = atom<NcmQuality>('exhigh');
export const playlistAtom = atom<PlaylistItem[]>([]);
/** 当前播放索引（-1 表示无） */
export const currentIndexAtom = atom(-1);
/** 播放列表弹窗是否打开 */
export const showPlaylistPanelAtom = atom(false);
