import type { LyricRequest, LyricRequestStatus } from '@/lib/types';

export type RequestBadgeVariant =
  'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive';

/** 列表/详情展示用的状态 */
export function requestDisplayStatus(req: {
  status: LyricRequestStatus;
  submissionStatus?: string;
}): { label: string; variant: RequestBadgeVariant } {
  if (req.status === 'completed') return { label: '已完成', variant: 'success' };
  switch (req.submissionStatus) {
    case 'reviewing':
      return { label: '审核中', variant: 'default' };
    case 'pending':
      return { label: '待审核', variant: 'warning' };
    case 'need_revision':
    case 'missing_audio':
      return { label: '需修改', variant: 'destructive' };
    case 'approved':
      return { label: '已完成', variant: 'success' };
    default:
      return { label: '待处理', variant: 'warning' };
  }
}

export type PlatformKey = 'ncmId' | 'qqId' | 'spotifyId' | 'appleMusicId';

export interface PlatformMeta {
  key: PlatformKey;
  label: string;
  /** 表单里的字段名 */
  fieldLabel: string;
  /** 卡片上的短名 */
  short: string;
  url: (id: string) => string;
}

/** 四平台 ID 与跳转地址 */
export const platforms: PlatformMeta[] = [
  {
    key: 'ncmId',
    label: '网易云音乐',
    fieldLabel: '网易云音乐ID',
    short: '网易云',
    url: (id) => `https://music.163.com/song?id=${encodeURIComponent(id)}`,
  },
  {
    key: 'qqId',
    label: 'QQ 音乐',
    fieldLabel: 'QQ音乐ID',
    short: 'QQ 音乐',
    url: (id) => `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(id)}`,
  },
  {
    key: 'spotifyId',
    label: 'Spotify',
    fieldLabel: 'Spotify ID',
    short: 'Spotify',
    url: (id) => `https://open.spotify.com/track/${encodeURIComponent(id)}`,
  },
  {
    key: 'appleMusicId',
    label: 'Apple Music',
    fieldLabel: 'Apple Music ID',
    short: 'Apple Music',
    url: (id) => `https://music.apple.com/song/${encodeURIComponent(id)}`,
  },
];

/** 该请愿已提供的平台 */
export function providedPlatforms(req: LyricRequest): PlatformMeta[] {
  return platforms.filter((p) => {
    const v = req[p.key];
    return !!v && v !== '0';
  });
}

/** 是否为本人发起的请愿 */
export function isRequestOwner(req: LyricRequest, userName?: string): boolean {
  return !!userName && req.requesterName === userName;
}

/** 展示用的发起人名称与头像 */
export function requesterIdentity(req: LyricRequest): { name: string; avatar: string } {
  const displayName =
    typeof req.requesterInfo?.displayName === 'string' && req.requesterInfo.displayName
      ? req.requesterInfo.displayName
      : req.requesterName;
  const avatar = typeof req.requesterInfo?.avatar === 'string' ? req.requesterInfo.avatar : '';
  return { name: displayName, avatar };
}
