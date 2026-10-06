export interface LyricWordBase {
  startTime: number;
  endTime: number;
  word: string;
}

export interface AmllLyricWord {
  startTime: number;
  endTime: number;
  word: string;
  romanWord?: string;
  obscene?: boolean;
  emptyBeat?: number;
  ruby?: LyricWordBase[];
}

export interface AmllLyricLine {
  words: AmllLyricWord[];
  translatedLyric: string;
  romanLyric: string;
  isBG: boolean;
  isDuet: boolean;
  startTime: number;
  endTime: number;
}

export interface AmllMetadata {
  key: string;
  value: string[];
}

export interface AmllLyricResult {
  lyricLines: AmllLyricLine[];
  metadata: AmllMetadata[];
}

export interface TtmlToAmllOptions {
  translationLanguage?: string;
  romanizationLanguage?: string;
}

export interface AmllToTtmlOptions {
  translationLanguage?: string;
  romanizationLanguage?: string;
}
