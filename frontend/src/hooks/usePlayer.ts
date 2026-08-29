import { useAtomValue } from 'jotai';
import type { LyricLine } from '@applemusic-like-lyrics/lyric';
import type { SearchHit } from '@/lib/types';
import {
  NCM_QUALITY_LABEL,
  NCM_QUALITY_ORDER,
  trackAtom,
  playingAtom,
  currentAtom,
  durationAtom,
  loadingAtom,
  errorAtom,
  selectRequestAtom,
  shuffleAtom,
  repeatModeAtom,
  volumeAtom,
  mutedAtom,
  lyricDataAtom,
  lyricLoadingAtom,
  lyricErrorAtom,
  qualityAtom,
  playlistAtom,
  currentIndexAtom,
  showPlaylistPanelAtom,
  type NcmQuality,
  type PlayerTrack,
  type PlaylistItem,
  type RepeatMode,
  type SelectRequest,
} from '@/atoms/player';
import { playerActions } from '@/boot/PlayerBoot';

// 类型与常量从 atoms/player re-export，消费方导入路径不变
export { NCM_QUALITY_LABEL, NCM_QUALITY_ORDER };
export type { NcmQuality, PlayerTrack, PlaylistItem, RepeatMode, SelectRequest };

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

/**
 * 播放器状态（jotai atoms + playerActions，全局可用，无需 Provider）。
 * 引擎副作用在 boot/PlayerBoot（Layout 挂一次）。
 * 注意：本 hook 订阅全部播放器 atoms，任一变化都会触发重渲染（含 timeupdate
 * 级的 current）；仅需局部状态的组件（Player/PlaylistPanel 等）应直接
 * useAtomValue 单个 atom。
 */
export function usePlayer(): PlayerContextValue {
  return {
    track: useAtomValue(trackAtom),
    playing: useAtomValue(playingAtom),
    current: useAtomValue(currentAtom),
    duration: useAtomValue(durationAtom),
    loading: useAtomValue(loadingAtom),
    error: useAtomValue(errorAtom),
    selectRequest: useAtomValue(selectRequestAtom),
    shuffle: useAtomValue(shuffleAtom),
    repeatMode: useAtomValue(repeatModeAtom),
    volume: useAtomValue(volumeAtom),
    muted: useAtomValue(mutedAtom),
    lyricData: useAtomValue(lyricDataAtom),
    lyricLoading: useAtomValue(lyricLoadingAtom),
    lyricError: useAtomValue(lyricErrorAtom),
    quality: useAtomValue(qualityAtom),
    playlist: useAtomValue(playlistAtom),
    currentIndex: useAtomValue(currentIndexAtom),
    showPlaylistPanel: useAtomValue(showPlaylistPanelAtom),
    ...playerActions,
  };
}
