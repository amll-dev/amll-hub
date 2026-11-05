/** 投稿标签自动识别 */
import type { LyricLine, TTMLMetadata } from '@/lib/ttml-processor';

/** 自动标签文案（与投稿标签字段同一套字符串，重复提交会被去重） */
export const AutoTag = {
  HoyoMix: 'HOYO-MiX',
  HoyoFair: 'HoYoFair',
  Msr: 'MSR',
  Wuthering: '鸣潮先约电台',
  Proseka: 'プロセカ',
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

/** 网易云音乐 ID 数量达到该值即打「地瓜藤」 */
const MELON_NCM_ID_MIN = 5;

/** 「プロセカ」判定集合 */
const PROSEKA_KEYWORDS = [
  // Virtual Singer
  'Virtual Singer',
  'バーチャル・シンガー',
  '虛擬歌手',
  '虚拟歌手',
  '巡音ルカ',
  '巡音流歌',
  'MEGURINE LUKA',
  '初音未来',
  'Hatsune Miku',
  '鏡音リン',
  'Kagamine Rin',
  '鏡音鈴',
  '镜音铃',
  '鏡音レン',
  'Kagamine Len',
  '鏡音連',
  '镜音连',
  'MEIKO',
  'メイコ',
  'KAITO',
  'カイト',
  // Leo/need
  'Leo/need',
  '星乃一歌',
  'Hoshino Ichika',
  '天馬咲希',
  '天马咲希',
  'Tenma Saki',
  '望月穂波',
  'Mochizuki Honami',
  '日野森志歩',
  '日野森志步',
  'Hinomori Shiho',
  // MORE MORE JUMP!
  'MORE MORE JUMP!',
  '花里实乃理',
  '花里實乃理',
  '花里みのり',
  'Hanasato Minori',
  '桐谷遥',
  '桐谷遙',
  'Kiritani Haruka',
  '桃井爱莉',
  '桃井愛莉',
  'Momoi Airi',
  '日野森雫',
  'Hinomori Shizuku',
  // Vivid Bad Squad
  'Vivid Bad Squad',
  'Azusawa Kohane',
  '小豆沢こはね',
  '小豆澤心羽',
  '小豆泽心羽',
  'Shiraishi An',
  '白石杏',
  'Shinonome Akito',
  '東雲彰人',
  '东云彰人',
  'Aoyagi Toya',
  '青柳冬弥',
  '青柳冬彌',
  // Wonderlands×Showtime
  'Wonderlands×Showtime',
  'Tenma Tsukasa',
  '天馬司',
  '天马司',
  'Otori Emu',
  '鳳えむ',
  '鳳笑夢',
  '凤笑梦',
  'Kusanagi Nene',
  '草薙寧々',
  '草薙寧寧',
  '草薙宁宁',
  'Kamishiro Rui',
  '神代類',
  '神代类',
  // 25-ji, Nightcord de.
  '25-ji, Nightcord de.',
  '25時、ナイトコードで。',
  '25点，Nightcord见。',
  'Nightcord at 25:00',
  'Yoisaki Kanade',
  '宵崎奏',
  'Asahina Mafuyu',
  '朝比奈まふゆ',
  '朝比奈真冬',
  'Shinonome Ena',
  '東雲絵名',
  '東雲繪名',
  '东云绘名',
  'Akiyama Mizuki',
  '暁山瑞希',
  '曉山瑞希',
  '晓山瑞希',
];

const PROSEKA_KEYWORD_SET = new Set(PROSEKA_KEYWORDS.map((name) => name.toLowerCase()));

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

/** artists 是否属于 プロセカ：按条目完全相等 */
function isProsekaArtist(metadata: TTMLMetadata): boolean {
  return (metadata.artist ?? []).some((artist) =>
    PROSEKA_KEYWORD_SET.has(artist.trim().toLowerCase())
  );
}

/** 网易云音乐 ID 数量 */
function ncmIdCount(metadata: TTMLMetadata): number {
  return (metadata.platformIds?.ncmMusicId ?? []).filter((id) => id.trim() !== '').length;
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

  if (isProsekaArtist(metadata)) tags.push(AutoTag.Proseka);

  if (ncmIdCount(metadata) >= MELON_NCM_ID_MIN) tags.push(AutoTag.Melon);

  const { languages, wordTimed } = lyricFeatures(lines);
  if (languages >= MULTI_LANG_MIN) tags.push(AutoTag.MultiLang);
  if (wordTimed) tags.push(AutoTag.WordTimed);

  return tags;
}
