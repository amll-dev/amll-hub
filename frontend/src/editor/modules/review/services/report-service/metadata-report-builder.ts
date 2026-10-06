import type { TTMLLyric, TTMLMetadata } from '$/types/ttml';
import { createReviewReport, createReviewReportBlockId } from './normalize-service';
import type { ReviewReportBlock } from './types';

/** 元数据 key → 中文标签。只覆盖投稿里常见的，其余回退到 key 本身。 */
const METADATA_LABELS: Record<string, string> = {
  title: '标题',
  artist: '歌手',
  album: '专辑',
  albumArtist: '专辑歌手',
  byArtist: '演唱者',
  composer: '作曲',
  lyricist: '作词',
  arranger: '编曲',
  mix: '混音',
  musicProvider: '音乐提供方',
  lyricProvider: '歌词提供方',
  trackNumber: '音轨号',
  discNumber: '碟片号',
  language: '语言',
  version: '版本',
  duration: '时长',
};

/** 已知平台 ID 前缀 → 展示名。这些是「同一首歌的不同平台 ID」。 */
const PLATFORM_LABELS: Record<string, string> = {
  netease: '网易云',
  qq: 'QQ 音乐',
  spotify: 'Spotify',
  kugou: '酷狗',
  kuwo: '酷我',
  musicbrainz: 'MusicBrainz',
  lrclib: 'LRCLIB',
};

function getLabel(key: string): string {
  if (METADATA_LABELS[key]) return METADATA_LABELS[key];
  const platform = PLATFORM_LABELS[key];
  if (platform) return `${platform} ID`;
  return key;
}

function normalizeValues(entry: TTMLMetadata | undefined): string[] {
  if (!entry) return [];
  return entry.value
    .map((v) => v.trim())
    .filter((v) => v !== '')
    .sort();
}

function sameValues(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/** 逐 key 做集合差：返回「旧里有新没有」与「新里有旧没有」 */
function diffValues(oldValues: string[], newValues: string[]): string[] {
  const oldSet = new Set(oldValues);
  const newSet = new Set(newValues);
  const removed = oldValues.filter((v) => !newSet.has(v));
  const added = newValues.filter((v) => !oldSet.has(v));
  return [...removed.map((v) => `- ${v}`), ...added.map((v) => `+ ${v}`)];
}

/** 把 TTMLLyric 的 metadata 压成 Map（同一个 key 出现多次时合并 value） */
function toMetadataMap(lyric: TTMLLyric): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const entry of lyric.metadata ?? []) {
    const existing = map.get(entry.key) ?? [];
    map.set(entry.key, [...existing, ...normalizeValues(entry)]);
  }
  for (const [key, values] of map) {
    map.set(key, values.sort());
  }
  return map;
}

export const buildMetadataChanges = (freeze: TTMLLyric, staged: TTMLLyric): ReviewReportBlock[] => {
  const oldMap = toMetadataMap(freeze);
  const newMap = toMetadataMap(staged);
  const keys = new Set([...oldMap.keys(), ...newMap.keys()]);
  const blocks: ReviewReportBlock[] = [];

  for (const key of keys) {
    const oldValues = oldMap.get(key) ?? [];
    const newValues = newMap.get(key) ?? [];

    if (sameValues(oldValues, newValues)) continue;

    const label = getLabel(key);
    let content: string;

    if (oldValues.length === 0) {
      content = `**${label}**：新增 ${newValues.map((v) => `\`${v}\``).join('、')}`;
    } else if (newValues.length === 0) {
      content = `**${label}**：删除 ${oldValues.map((v) => `\`${v}\``).join('、')}`;
    } else {
      const detail = diffValues(oldValues, newValues).join('，');
      content = `**${label}**：${detail}`;
    }

    blocks.push({
      id: createReviewReportBlockId('metadata'),
      kind: 'manual',
      enabled: true,
      // 独立成段，不和歌词 diff 混在一起
      lineBreakBefore: true,
      content,
    });
  }

  return blocks;
};

/** 只产出元数据部分的报告（便于单独测试与复用） */
export const buildMetadataReport = (freeze: TTMLLyric, staged: TTMLLyric) =>
  createReviewReport(buildMetadataChanges(freeze, staged));
