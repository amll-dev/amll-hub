/**
 * TTML 数据结构定义，与 ttml_processor WASM 的序列化格式一一对应。
 * 字段名保持 snake_case（与后端 metadata 落库格式一致），不做转换。
 */

/** 副歌词内容：翻译 / 音译 */
export interface SubLyricContent {
  language?: string;
  text: string;
  /** 逐字时间轴（音译通常逐字对齐） */
  words?: Syllable[];
}

/** 背景人声（x-bg） */
export interface BackgroundVocal {
  text: string;
  startTime: number;
  endTime: number;
  words?: Syllable[];
  translations?: SubLyricContent[];
  romanizations?: SubLyricContent[];
}

/** 注音（ruby） */
export interface RubyTag {
  text: string;
  startTime: number;
  endTime: number;
}

/** 逐字（音节） */
export interface Syllable {
  text: string;
  startTime: number;
  endTime: number;
  /** 该字后面是否跟随空格 */
  endsWithSpace?: boolean;
  ruby?: RubyTag[];
  /** 不雅用词（生成时可选择剔除括号内容） */
  obscene?: boolean;
  /** 空拍占位 */
  emptyBeat?: number;
}

/** 歌词行 */
export interface LyricLine {
  text: string;
  startTime: number;
  endTime: number;
  /** 逐字时间轴 */
  words?: Syllable[];
  translations?: SubLyricContent[];
  romanizations?: SubLyricContent[];
  backgroundVocal?: BackgroundVocal;
  id?: string;
  /** 对唱：所属 agent id；同一首歌多agent 即为对唱 */
  agentId?: string;
  /** 分段标记（P1/verse 等） */
  songPart?: string;
  /** 所属 block 序号 */
  blockIndex?: number;
}

/** 角色（对唱用） */
export interface Agent {
  id: string;
  name?: string;
  type?: string;
}

export type PlatformId = 'ncmMusicId' | 'qqMusicId' | 'spotifyId' | 'appleMusicId';

/** TTML metadata */
export interface TTMLMetadata {
  language?: string;
  timingMode?: string;
  songwriters?: string[];
  title?: string[];
  artist?: string[];
  album?: string[];
  isrc?: string[];
  authorIds?: string[];
  authorNames?: string[];
  /** WASM 侧是 Map，跨边界传输需转成普通对象，这里统一用 Record */
  agents?: Record<string, Agent>;
  platformIds?: Partial<Record<PlatformId, string[]>>;
  rawProperties?: Record<string, string[]>;
}

export interface TTMLResult {
  metadata: TTMLMetadata;
  lines: LyricLine[];
}

export interface GeneratorConfig {
  /** 是否套用 Apple Music 格式规则 */
  useAppleFormatRules: boolean;
  /** 是否做格式化（缩进换行） */
  format: boolean;
}

/** 生成 TTML 的默认配置：对齐 Apple Music 风格 + 格式化输出 */
export const DEFAULT_GENERATOR_CONFIG: GeneratorConfig = {
  useAppleFormatRules: true,
  format: true,
};
