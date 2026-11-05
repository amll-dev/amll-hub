import type { MusicPlatform } from '@/lib/types';

/** 解析页 / 表单搜索面板共用的音源选项 */
export const PLATFORM_OPTIONS: readonly { value: MusicPlatform; label: string }[] = [
  { value: 'ncm', label: '网易云' },
  { value: 'qq', label: 'QQ 音乐' },
];
