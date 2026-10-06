export interface SubLyricContent {
  language?: string;
  text: string;
  words?: Syllable[];
}

export interface BackgroundVocal {
  text: string;
  startTime: number;
  endTime: number;
  words?: Syllable[];
  translations?: SubLyricContent[];
  romanizations?: SubLyricContent[];
}

export interface RubyTag {
  text: string;
  startTime: number;
  endTime: number;
}

export interface Syllable {
  text: string;
  startTime: number;
  endTime: number;
  endsWithSpace?: boolean;
  ruby?: RubyTag[];
  obscene?: boolean;
  emptyBeat?: number;
}

export interface LyricLine {
  text: string;
  startTime: number;
  endTime: number;
  words?: Syllable[];
  translations?: SubLyricContent[];
  romanizations?: SubLyricContent[];
  backgroundVocal?: BackgroundVocal;
  id?: string;
  agentId?: string;
  songPart?: string;
  blockIndex?: number;
}

export interface Agent {
  id: string;
  name?: string;
  type?: string;
}

export type PlatformId = 'ncmMusicId' | 'qqMusicId' | 'spotifyId' | 'appleMusicId';

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
  agents?: Map<string, Agent>;
  platformIds?: Map<PlatformId, string[]>;
  rawProperties?: Map<string, string[]>;
}

export interface TTMLResult {
  metadata: TTMLMetadata;
  lines: LyricLine[];
}

export interface GeneratorConfig {
  useAppleFormatRules: boolean;
  format: boolean;
}
