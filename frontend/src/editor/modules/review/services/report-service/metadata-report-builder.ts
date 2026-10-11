import type { TTMLLyric, TTMLMetadata } from '$/types/ttml';
import { createReviewReport, createReviewReportBlockId } from './normalize-service';
import type { ReviewReportBlock } from './types';

const METADATA_LABELS: Record<string, string> = {
  // —— 编辑器面板内置 key ——
  musicName: '歌曲名称',
  artists: '歌曲的艺术家',
  songwriter: '词曲作者',
  album: '歌曲的专辑名',
  ncmMusicId: '网易云音乐 ID',
  qqMusicId: 'QQ 音乐 ID',
  spotifyId: 'Spotify 音乐 ID',
  appleMusicId: 'Apple Music 音乐 ID',
  isrc: '歌曲的 ISRC 号码',
  ttmlAuthorGithub: '歌词作者 GitHub ID',
  ttmlAuthorGithubLogin: '歌词作者 GitHub 用户名',
  // —— 其它常见元数据 key ——
  title: '标题',
  artist: '歌手',
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
function diffValues(
  oldValues: string[],
  newValues: string[]
): { removed: string[]; added: string[] } {
  const oldSet = new Set(oldValues);
  const newSet = new Set(newValues);
  return {
    removed: oldValues.filter((v) => !newSet.has(v)),
    added: newValues.filter((v) => !oldSet.has(v)),
  };
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

    const { removed, added } = diffValues(oldValues, newValues);
    const label = getLabel(key);

    // 一个 key 同时有增有删时拆成两条 —— 语义单一，模板统一为
    // 「元数据（类型）需要增加/删除内容为 xxx 的数据」。
    if (added.length > 0) {
      blocks.push({
        id: createReviewReportBlockId('metadata'),
        kind: 'metadata',
        enabled: true,
        action: 'add',
        key,
        label,
        items: added,
      });
    }
    if (removed.length > 0) {
      blocks.push({
        id: createReviewReportBlockId('metadata'),
        kind: 'metadata',
        enabled: true,
        action: 'remove',
        key,
        label,
        items: removed,
      });
    }
  }

  return blocks;
};

/** 只产出元数据部分的报告（便于单独测试与复用） */
export const buildMetadataReport = (freeze: TTMLLyric, staged: TTMLLyric) =>
  createReviewReport(buildMetadataChanges(freeze, staged));
