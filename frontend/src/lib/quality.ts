import { NCM_QUALITY_LABEL, NCM_QUALITY_ORDER, type NcmQuality } from '@/atoms/player';

/** 精确匹配上游 FormatLevel 的输出 */
const EXACT_MAP: Record<string, NcmQuality> = {
  标准: 'standard',
  '极高(HQ)': 'exhigh',
  '无损(SQ)': 'lossless',
  '高解析度无损(Hi-Res)': 'hires',
  '高清臻音(Spatial Audio)': 'jyeffect',
  '超清母带(Master)': 'jymaster',
  '沉浸环绕声(Surround Audio)': 'sky',
  '杜比全景声(Dolby Atmos)': 'dolby',
};

const KEYWORD_RULES: [RegExp, NcmQuality][] = [
  [/杜比|dolby|atmos/i, 'dolby'],
  [/沉浸|环绕|surround/i, 'sky'],
  [/母带|master/i, 'jymaster'],
  [/臻音|jyeffect|spatial/i, 'jyeffect'],
  [/hi-?res| hires|解析度/i, 'hires'],
  [/无损|lossless|\bsq\b|\bflac\b/i, 'lossless'],
  [/母带|jymaster/i, 'jymaster'],
  [/极高|exhigh|hq/i, 'exhigh'],
  [/标准|standard/i, 'standard'],
];

/** 上游认不出来时的占位文案，出现即视为「无效」 */
const PLACEHOLDERS = ['未知音质', '未知', 'unknown', 'none', 'null', 'undefined'];

function qualityFromBitrate(value: string): NcmQuality | null {
  const match = /^(\d{2,5})\s*(k|kb|kbps|bps)$/i.exec(value);
  const digits = match?.[1];
  const unit = match?.[2];
  if (!digits || !unit) return null;
  const kbps = Number(digits) / (unit.toLowerCase() === 'bps' ? 1000 : 1);
  if (!Number.isFinite(kbps) || kbps <= 0) return null;
  if (kbps <= 145) return 'standard'; // 128k 附近
  if (kbps <= 345) return 'exhigh'; // 320k
  return 'lossless'; // 1000k+ 归到无损
}

export function normalizeNcmLevel(raw: string | undefined | null): NcmQuality | null {
  const value = (raw ?? '').trim();
  if (!value) return null;

  const lower = value.toLowerCase();
  if (PLACEHOLDERS.includes(lower)) return null;

  // 1) 本身就是 NCM level key
  if (Object.prototype.hasOwnProperty.call(NCM_QUALITY_LABEL, value)) {
    return value as NcmQuality;
  }
  if (Object.prototype.hasOwnProperty.call(NCM_QUALITY_LABEL, lower)) {
    return lower as NcmQuality;
  }

  // 2) 上游 FormatLevel 的中文描述
  if (EXACT_MAP[value]) return EXACT_MAP[value];

  // 3) 码率字符串（128k / 320 kbps）
  const fromBitrate = qualityFromBitrate(value);
  if (fromBitrate) return fromBitrate;

  // 4) 关键词兜底
  for (const [pattern, quality] of KEYWORD_RULES) {
    if (pattern.test(value)) return quality;
  }
  return null;
}

/** 音质档位序号，越大越高；未知音质返回 -1 */
export function qualityRank(quality: NcmQuality | null): number {
  return quality ? NCM_QUALITY_ORDER.indexOf(quality) : -1;
}

/**
 * 判断实际音质是否低于用户选择的音质（上游拿不到时自动降级）。
 *
 * @param actual 实际拿到的音质（null = 上游没给 / 认不出）
 * @param selected 用户选择的音质
 */
export function isQualityDowngraded(actual: NcmQuality | null, selected: NcmQuality): boolean {
  if (!actual) return false;
  return qualityRank(actual) < qualityRank(selected);
}
