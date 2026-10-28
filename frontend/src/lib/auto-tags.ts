/** 投稿标签自动识别 */
import type { LyricLine, TTMLMetadata } from '@/lib/ttml-processor';

/** 自动标签文案（与投稿标签字段同一套字符串，重复提交会被去重） */
export const AutoTag = {
  HoyoMix: 'HOYO-MiX',
  HoyoFair: 'HoYoFair',
  Msr: 'MSR',
  Wuthering: '鸣潮先约电台',
  Melon: '地—瓜——藤——————————',
  MultiLang: '多语言翻译',
  WordTimed: '逐字翻译/音译',
} as const;

/** artists 命中的关键词（比较前已去空格与连接符，故不用写大小写/连字符变体） */
const CREATOR_KEYWORDS: { keyword: string; tag: string }[] = [
  { keyword: 'hoyomix', tag: AutoTag.HoyoMix },
  { keyword: 'hoyofair', tag: AutoTag.HoyoFair },
  { keyword: '塞壬唱片msr', tag: AutoTag.Msr },
  { keyword: '铁痕电台msr', tag: AutoTag.Msr },
  { keyword: '鸣潮先约电台', tag: AutoTag.Wuthering },
];

/** 单个元数据字段条目数超过该值即打「地瓜藤」（合并了过多版本/平台的投稿） */
const META_ENTRY_LIMIT = 18;

/** 打「地瓜藤」时需要统计的数组型元数据字段 */
const META_LIST_FIELDS = [
  'title',
  'artist',
  'album',
  'isrc',
  'songwriters',
  'authorIds',
  'authorNames',
] as const;

/** 「多语言翻译」所需的最少译文语种数 */
const MULTI_LANG_MIN = 2;

/** 归一化：小写并去掉空白与连接符，`HOYO-MiX` / `hoyo mix` 都能命中 */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s\-_·・]/g, '');
}

/** artists 命中的厂牌标签 */
function creatorTags(metadata: TTMLMetadata): string[] {
  const haystack = (metadata.artist ?? []).map(normalize).join('\n');
  if (!haystack) return [];
  const tags: string[] = [];
  for (const { keyword, tag } of CREATOR_KEYWORDS) {
    if (!tags.includes(tag) && haystack.includes(keyword)) tags.push(tag);
  }
  return tags;
}

/** 单个元数据字段的最大条目数（平台 ID、rawProperties 也算） */
function maxMetaEntries(metadata: TTMLMetadata): number {
  let max = 0;
  for (const field of META_LIST_FIELDS) {
    max = Math.max(max, metadata[field]?.length ?? 0);
  }
  for (const values of Object.values(metadata.platformIds ?? {})) {
    max = Math.max(max, values?.length ?? 0);
  }
  for (const values of Object.values(metadata.rawProperties ?? {})) {
    max = Math.max(max, values?.length ?? 0);
  }
  return max;
}

/** 一段副歌词（翻译 / 音译）是否带逐字时间轴 */
function hasWordTiming(items: LyricLine['translations']): boolean {
  return (items ?? []).some((item) => (item.words?.length ?? 0) > 0);
}

/** 译文语种去重数量 + 是否出现逐字翻译 / 音译 */
function lyricFeatures(lines: readonly LyricLine[]): {
  languages: number;
  wordTimed: boolean;
} {
  const languages = new Set<string>();
  let wordTimed = false;

  for (const line of lines) {
    for (const items of [line.translations, line.backgroundVocal?.translations]) {
      for (const item of items ?? []) {
        if (item.language) languages.add(item.language);
      }
      if (hasWordTiming(items)) wordTimed = true;
    }
    // 音译走 romanizations，逐字时间轴同样算「逐字翻译/音译」
    for (const items of [line.romanizations, line.backgroundVocal?.romanizations]) {
      if (hasWordTiming(items)) wordTimed = true;
    }
  }

  return { languages: languages.size, wordTimed };
}

export interface AutoTagInput {
  metadata: TTMLMetadata;
  lines: readonly LyricLine[];
}

/** 识别应自动添加的标签，顺序稳定；无命中返回空数组 */
export function detectAutoTags({ metadata, lines }: AutoTagInput): string[] {
  const tags = creatorTags(metadata);

  if (maxMetaEntries(metadata) > META_ENTRY_LIMIT) tags.push(AutoTag.Melon);

  const { languages, wordTimed } = lyricFeatures(lines);
  if (languages >= MULTI_LANG_MIN) tags.push(AutoTag.MultiLang);
  if (wordTimed) tags.push(AutoTag.WordTimed);

  return tags;
}
