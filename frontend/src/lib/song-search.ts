import { api } from '@/lib/api';
import { qmSongToNcmSong } from '@/lib/qm';
import type { MusicPlatform, NcmSong } from '@/lib/types';

/** 按平台搜索歌曲，并统一成 NcmSong 结构 */
export async function searchPlatformSongs(
  platform: MusicPlatform,
  keyword: string,
  limit = 10
): Promise<NcmSong[]> {
  if (platform === 'qq') {
    const res = await api.searchQm(keyword, limit);
    return (res.data ?? []).map(qmSongToNcmSong);
  }
  const res = await api.searchNcm(keyword, limit);
  return res.data ?? [];
}
