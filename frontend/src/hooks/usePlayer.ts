import { createContext, useContext } from 'react';
import type { LyricLine } from '@applemusic-like-lyrics/lyric';
import type { SearchHit } from '@/lib/types';

// 正在播放的曲目信息
export interface PlayerTrack {
  title: string;
  artists: string;
  cover?: string;
  audioUrl: string;
  // 关联的搜索命中
  hit?: SearchHit;
  // 当前播放使用的网易云歌曲 ID
  ncmSongId?: string;
  // 网易云解析返回的 LRC 主歌词
  ncmLyric?: string;
  // 网易云解析返回的 LRC 翻译
  ncmTLyric?: string;
  skipTtml?: boolean;
  // 外部直接传入的 TTML 文本
  customTtml?: string;
}

// 多 ncm id 选择弹窗的请求
export interface SelectRequest {
  // 待选择的 ncm id 列表
  ids: string[];
  // 关联的搜索命中
  hit: SearchHit;
}

// 播放列表项
export interface PlaylistItem {
  songId: string;
  name: string;
  artists: string;
  cover?: string;
}

export type RepeatMode = 'off' | 'all' | 'one';

// 网易云音质等级
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

export interface PlayerContextValue {
  /** 当前播放曲目（无则 null） */
  track: PlayerTrack | null;
  /** 是否正在播放 */
  playing: boolean;
  /** 当前进度（秒） */
  current: number;
  /** 总时长（秒） */
  duration: number;
  /** 加载中（解析 ncm） */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 播放/暂停 */
  toggle: () => void;
  /** 跳转到指定秒 */
  seek: (sec: number) => void;
  /** 播放一首搜索命中：解析 ncm id 后播放 */
  playHit: (hit: SearchHit) => Promise<void>;
  /** 播放一首网易云歌曲（无本地搜索命中，用于网易云解析页） */
  playNcmSong: (
    songId: string,
    meta: {
      name?: string;
      artists?: string;
      cover?: string;
      skipTtml?: boolean;
      customTtml?: string;
    }
  ) => Promise<void>;
  /** 直接播放指定 URL 的音频（如投稿者上传的音频文件） */
  playDirect: (opts: {
    audioUrl: string;
    title: string;
    artists?: string;
    cover?: string;
    customTtml?: string;
  }) => void;
  /** 关闭播放器 */
  close: () => void;
  /** 多 id 选择弹窗：有值时弹窗显示，调用 resolve 选中一个 id */
  selectRequest: SelectRequest | null;
  /** 用户在弹窗选中某个 id（或取消） */
  resolveSelect: (songId: string | null) => void;
  /** 随机播放 */
  shuffle: boolean;
  /** 切换随机播放 */
  toggleShuffle: () => void;
  /** 循环模式 */
  repeatMode: RepeatMode;
  /** 切换循环模式 */
  cycleRepeatMode: () => void;
  /** 当前音量（0-1） */
  volume: number;
  /** 设置音量（0-1） */
  setVolume: (v: number) => void;
  /** 是否静音 */
  muted: boolean;
  /** 切换静音 */
  toggleMute: () => void;
  /** 歌词数据（AMLL LyricLine[]） */
  lyricData: LyricLine[] | null;
  /** 歌词加载中 */
  lyricLoading: boolean;
  /** 歌词错误信息 */
  lyricError: string | null;
  /** 打开歌词页面（自动获取歌词） */
  openLyricsPage: () => void;
  /** 当前音质 */
  quality: NcmQuality;
  /** 设置音质 */
  setQuality: (q: NcmQuality) => void;
  /** 切换到下一个音质 */
  cycleQuality: () => void;
  /** 用指定音质重新加载当前曲目（保持进度） */
  reloadWithQuality: (q: NcmQuality) => Promise<void>;
  /** 播放列表 */
  playlist: PlaylistItem[];
  /** 当前播放索引（-1 表示无） */
  currentIndex: number;
  /** 播放列表弹窗是否打开 */
  showPlaylistPanel: boolean;
  /** 切换播放列表弹窗显示 */
  togglePlaylistPanel: () => void;
  /** 关闭播放列表弹窗 */
  closePlaylistPanel: () => void;
  /** 播放整个列表：设置列表并从第一首开始 */
  playAll: (items: PlaylistItem[]) => void;
  /** 播放下一首（根据 shuffle/repeatMode） */
  playNext: () => void;
  /** 播放上一首 */
  playPrev: () => void;
  /** 播放列表中指定索引的曲目 */
  playAtIndex: (index: number) => void;
  /** 从列表中移除指定索引 */
  removeFromPlaylist: (index: number) => void;
  /** 清空播放列表（保留当前播放） */
  clearPlaylist: () => void;
}

/** 播放器 Context 实例（Provider 在 context/PlayerContext.tsx） */
export const PlayerContext = createContext<PlayerContextValue | null>(null);

/** 读取播放器 Context，必须在 PlayerProvider 内使用 */
export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error('usePlayer must be used within PlayerProvider');
  }
  return ctx;
}
