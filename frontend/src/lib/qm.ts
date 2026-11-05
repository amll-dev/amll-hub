import type { LyricLine } from '@applemusic-like-lyrics/lyric';
import { api } from '@/lib/api';
import type {
  NcmMusicInfo,
  NcmPlaylistDetail,
  NcmPlaylistTrack,
  NcmSong,
  OnlineLyric,
  QmMusicInfo,
  QmPlaylistDetail,
  QmSong,
} from '@/lib/types';

/** 从 CDN 地址里取图片 mid */
const QM_COVER_RE = /M000([0-9A-Za-z]{8,32})\.jpg/;

/** 封面转同源代理地址 */
export function qmCoverProxy(url: string | undefined, size = 300): string {
  if (!url) return '';
  const m = QM_COVER_RE.exec(url);
  const mid = m?.[1];
  if (!mid) return url;
  return api.qmCoverUrl(mid, size);
}

export function qmCoverAbsolute(url: string | undefined, size = 800): string {
  if (!url) return '';
  const mid = QM_COVER_RE.exec(url)?.[1] ?? /mid=([0-9A-Za-z]{8,32})/.exec(url)?.[1];
  if (!mid) return url;
  return `https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${mid}.jpg`;
}

/** QQ 歌曲 → NcmSong */
export function qmSongToNcmSong(s: QmSong): NcmSong {
  return {
    id: s.id,
    name: s.name,
    fee: s.pay?.payPlay ? 1 : 0,
    picUrl: qmCoverProxy(s.cover),
    artists: (s.artists ?? []).map((a) => ({ id: a.id, name: a.name })),
    album: {
      id: s.album?.id ?? 0,
      name: s.album?.name ?? '',
      picUrl: qmCoverProxy(s.album?.cover || s.cover),
    },
    duration: s.duration,
  };
}

/** QQ 歌单曲目 → NcmPlaylistTrack */
function qmSongToTrack(s: QmSong): NcmPlaylistTrack {
  return {
    id: s.id,
    name: s.name,
    ar: (s.artists ?? []).map((a) => ({ id: a.id, name: a.name })),
    al: {
      id: s.album?.id ?? 0,
      name: s.album?.name ?? '',
      picUrl: qmCoverProxy(s.album?.cover || s.cover),
    },
    dt: s.durationMs,
    fee: s.pay?.payPlay ? 1 : 0,
  };
}

/** QQ 歌单 → NcmPlaylistDetail */
export function qmPlaylistToNcm(p: QmPlaylistDetail): NcmPlaylistDetail {
  return {
    id: Number(p.id) || 0,
    name: p.name,
    coverImgUrl: qmCoverProxy(p.cover, 800),
    trackCount: p.trackCount,
    creator: { userId: 0, nickname: p.creator || '未知', avatarUrl: '' },
    tracks: (p.songs ?? []).map(qmSongToTrack),
  };
}

/** QQ 解析结果 → NcmMusicInfo（播放信息用） */
export function qmMusicToNcmInfo(m: QmMusicInfo): NcmMusicInfo {
  return {
    url: m.url,
    name: m.name,
    artists: m.artistName,
    cover: qmCoverProxy(m.cover, 800),
    level: m.actualLevel || m.level,
    size: m.size,
    lyric: m.lyric,
    tlyric: m.translation,
  };
}

export function qmToLyricLines(lyric?: OnlineLyric | null): LyricLine[] | null {
  const lines = lyric?.lines;
  if (!lines || lines.length === 0) return null;

  const transMap = new Map<number, string>();
  for (const t of lyric.translation ?? []) transMap.set(t.time, t.text);
  const romaMap = new Map<number, string>();
  for (const t of lyric.romanization ?? []) romaMap.set(t.time, t.text);

  return lines.map((line, idx) => {
    const next = lines[idx + 1];
    const fallbackEnd = next && next.time > line.time ? next.time : line.time + 1000;
    const endTime = line.time + line.duration > line.time ? line.time + line.duration : fallbackEnd;

    const words = line.syllables?.length
      ? line.syllables.map((s) => ({
          word: s.text,
          startTime: s.time,
          endTime: Math.max(s.time + (s.duration ?? 0), s.time + 1),
        }))
      : [{ word: line.text, startTime: line.time, endTime }];

    return {
      words,
      translatedLyric: transMap.get(line.time) ?? '',
      romanLyric: romaMap.get(line.time) ?? '',
      isBG: false,
      isDuet: false,
      startTime: line.time,
      endTime,
    };
  });
}
