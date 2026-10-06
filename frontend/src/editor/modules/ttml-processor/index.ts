import type {
  LyricLine as AppLyricLine,
  LyricWord as AppLyricWord,
  TTMLAgent as AppTTMLAgent,
  TTMLLyric as AppTTMLLyric,
  TTMLMetadata as AppTTMLMetadata,
  TTMLRomanWord as AppTTMLRomanWord,
} from '$/types/ttml';
import { uid } from 'uid';
import type {
  Agent,
  AmllLyricLine,
  AmllLyricResult,
  AmllLyricWord,
  AmllMetadata,
  AmllToTtmlOptions,
  BackgroundVocal,
  GeneratorConfig,
  JsError,
  LyricLine,
  PlatformId,
  SubLyricContent,
  Syllable,
  TTMLResult,
  TtmlToAmllOptions,
} from './types';
import {
  amllToTtml as rawAmllToTtml,
  amllToTtmlResult as rawAmllToTtmlResult,
  generateTtml as rawGenerateTtml,
  parseTtml as rawParseTtml,
  ttmlResultToAmll as rawTtmlResultToAmll,
  ttmlToAmll as rawTtmlToAmll,
} from './wasm/ttml_processor_wasm';

//#region 类型定义
export type Result<T> = { success: true; data: T } | { success: false; error: JsError };

/** 需要在导入时剔除的元数据键 */
const IGNORED_METADATA_KEYS = new Set(['timingMode', 'language']);

/** 导入时需要重命名的元数据键 */
const RENAMED_METADATA_KEYS: Record<string, string> = {
  songwriters: 'songwriter',
  title: 'musicName',
};

/** 导出时需要重命名的元数据键 */
const EXPORT_RENAMED_METADATA_KEYS: Record<string, string> = {
  songwriter: 'songwriters',
};

const PLATFORM_METADATA_KEYS: PlatformId[] = [
  'ncmMusicId',
  'qqMusicId',
  'spotifyId',
  'appleMusicId',
];
//#endregion

function appendMetadata(metadata: AppTTMLMetadata[], key: string, values: string[] | undefined) {
  if (!values?.length) return;
  const filtered = values.filter((value) => value.trim().length > 0);
  if (!filtered.length) return;
  const current = metadata.find((item) => item.key === key);
  if (current) current.value.push(...filtered);
  else metadata.push({ key, value: [...filtered] });
}

function processorMetadataToApp(metadata: TTMLResult['metadata']): AppTTMLMetadata[] {
  const result: AppTTMLMetadata[] = [];
  appendMetadata(result, 'musicName', metadata.title);
  appendMetadata(result, 'artists', metadata.artist);
  appendMetadata(result, 'album', metadata.album);
  appendMetadata(result, 'songwriter', metadata.songwriters);
  appendMetadata(result, 'isrc', metadata.isrc);
  appendMetadata(result, 'ttmlAuthorGithub', metadata.authorIds);
  appendMetadata(result, 'ttmlAuthorGithubLogin', metadata.authorNames);

  for (const [key, values] of metadata.platformIds ?? []) {
    appendMetadata(result, key, values);
  }
  for (const [key, values] of metadata.rawProperties ?? []) {
    appendMetadata(result, key, values);
  }
  return result;
}

function appMetadataToProcessor(metadata: AppTTMLMetadata[]): TTMLResult['metadata'] {
  const result: TTMLResult['metadata'] = {};
  const rawProperties = new Map<string, string[]>();
  const platformIds = new Map<PlatformId, string[]>();

  for (const item of metadata) {
    const values = item.value.map((value) => value.trim()).filter((value) => value.length > 0);
    if (!values.length) continue;

    switch (item.key) {
      case 'musicName':
      case 'title':
        result.title = [...(result.title ?? []), ...values];
        break;
      case 'artists':
        result.artist = [...(result.artist ?? []), ...values];
        break;
      case 'album':
        result.album = [...(result.album ?? []), ...values];
        break;
      case 'songwriter':
      case 'songwriters':
        result.songwriters = [...(result.songwriters ?? []), ...values];
        break;
      case 'isrc':
        result.isrc = [...(result.isrc ?? []), ...values];
        break;
      case 'ttmlAuthorGithub':
        result.authorIds = [...(result.authorIds ?? []), ...values];
        break;
      case 'ttmlAuthorGithubLogin':
        result.authorNames = [...(result.authorNames ?? []), ...values];
        break;
      default:
        if (PLATFORM_METADATA_KEYS.includes(item.key as PlatformId)) {
          platformIds.set(item.key as PlatformId, values);
        } else if (!IGNORED_METADATA_KEYS.has(item.key)) {
          rawProperties.set(item.key, values);
        }
    }
  }

  if (platformIds.size) result.platformIds = platformIds;
  if (rawProperties.size) result.rawProperties = rawProperties;
  return result;
}

function normalizeAgentType(type: string | undefined): AppTTMLAgent['type'] {
  if (type === 'group' || type === 'other') return type;
  return 'person';
}

function processorAgentsToApp(agents: TTMLResult['metadata']['agents']): AppTTMLAgent[] {
  if (!agents) return [];
  return Array.from(agents, ([id, agent]) => ({
    id,
    type: normalizeAgentType(agent.type),
    names: agent.name ? [agent.name] : [],
  }));
}

function appAgentsToProcessor(agents: AppTTMLAgent[]): Map<string, Agent> | undefined {
  if (!agents.length) return undefined;
  return new Map(
    agents.map((agent) => [
      agent.id,
      {
        id: agent.id,
        name: agent.names.find((name) => name.trim().length > 0),
        type: agent.type,
      },
    ])
  );
}

function subLyricsToTextMap(
  contents: SubLyricContent[] | undefined
): Record<string, string> | undefined {
  if (!contents?.length) return undefined;
  const result: Record<string, string> = {};
  for (const content of contents) {
    result[content.language ?? 'und'] = content.text;
  }
  return Object.keys(result).length ? result : undefined;
}

function subLyricsToWordMap(
  contents: SubLyricContent[] | undefined
): Record<string, AppTTMLRomanWord[]> | undefined {
  if (!contents?.length) return undefined;
  const result: Record<string, AppTTMLRomanWord[]> = {};
  for (const content of contents) {
    if (!content.words?.length) continue;
    result[content.language ?? 'und'] = content.words.map((word) => ({
      startTime: word.startTime,
      endTime: word.endTime,
      text: word.text,
    }));
  }
  return Object.keys(result).length ? result : undefined;
}

function amllWordToApp(word: AmllLyricWord): AppLyricWord {
  return {
    ...word,
    id: uid(),
    romanWord: word.romanWord ?? '',
    obscene: word.obscene ?? false,
    emptyBeat: word.emptyBeat ?? 0,
  };
}

function createAppLine(
  rawLine: LyricLine | BackgroundVocal,
  amllLine: AmllLyricLine,
  options: {
    isBG: boolean;
    agentId?: string;
    songPart?: string;
    romanizationLanguage?: string;
  }
): AppLyricLine {
  const translatedLyricByLang = subLyricsToTextMap(rawLine.translations);
  const romanLyricByLang = subLyricsToTextMap(rawLine.romanizations);
  const wordRomanizationByLang = subLyricsToWordMap(rawLine.romanizations);
  const wordRomanizationLang =
    options.romanizationLanguage ??
    rawLine.romanizations?.find((item) => item.words?.length)?.language;

  return {
    ...amllLine,
    id: uid(),
    words: amllLine.words.map(amllWordToApp),
    ignoreSync: false,
    isBG: options.isBG,
    vocal: [],
    agent: options.agentId,
    songPart: options.songPart,
    translatedLyricByLang,
    romanLyricByLang,
    wordRomanizationByLang,
    wordRomanizationLang,
  };
}

function splitTrailingSpaces(amllResult: AmllLyricResult): AmllLyricResult {
  return {
    ...amllResult,
    lyricLines: amllResult.lyricLines.map((line) => {
      const words: AmllLyricWord[] = [];
      for (const word of line.words) {
        const trailingSpaceMatch = word.word.match(/(\s+)$/);
        if (trailingSpaceMatch && word.word !== trailingSpaceMatch[0]) {
          const spaces = trailingSpaceMatch[0];
          words.push({ ...word, word: word.word.slice(0, -spaces.length) });
          words.push({ startTime: 0, endTime: 0, word: spaces });
        } else {
          words.push(word);
        }
      }
      return { ...line, words };
    }),
  };
}

function normalizeImportedAmllResult(amllResult: AmllLyricResult): AmllLyricResult {
  const result = splitTrailingSpaces(amllResult);
  return {
    ...result,
    metadata: result.metadata
      .filter((meta) => !IGNORED_METADATA_KEYS.has(meta.key))
      .map((meta) => ({
        ...meta,
        key: RENAMED_METADATA_KEYS[meta.key] ?? meta.key,
      })),
  };
}

//#region 底层 API
/**
 * 解析 TTML 字符串为 TTMLResult
 * @param ttmlContent 原始 TTML 文本
 * @returns Result 包含 TTMLResult
 */
export function parseTTML(ttmlContent: string): Result<TTMLResult> {
  return rawParseTtml(ttmlContent) as Result<TTMLResult>;
}

/**
 * 将解析后的 TTML 结构体生成为 TTML 字符串
 * @param result TTMLResult 数据模型
 * @param config TTML 生成器配置
 * @returns Result 包含生成的 TTML 字符串
 */
export function generateTTML(
  result: TTMLResult,
  config?: Partial<GeneratorConfig>
): Result<string> {
  return rawGenerateTtml(result, config) as Result<string>;
}

function invalidProcessorResult(message: string): Result<never> {
  return {
    success: false,
    error: { kind: 'SerializationError', message },
  };
}

/**
 * 将 Rust 解析器的完整模型转换为编辑器模型。
 *
 * 对唱、背景行展开、罗马音匹配等降级规则仍由 Rust 负责；本函数只负责
 * 补充编辑器 ID 和保留完整模型中可编辑的 agent、songPart、多语言字段。
 */
export function ttmlResultToEditorLyric(
  ttmlResult: TTMLResult,
  options?: Partial<TtmlToAmllOptions>
): Result<AppTTMLLyric> {
  const converted = rawTtmlResultToAmll(ttmlResult, options) as Result<AmllLyricResult>;
  if (!converted.success) return converted;

  const amllResult = normalizeImportedAmllResult(converted.data);
  const lyricLines: AppLyricLine[] = [];
  let amllIndex = 0;

  for (const rawLine of ttmlResult.lines) {
    const mainLine = amllResult.lyricLines[amllIndex++];
    if (!mainLine) {
      return invalidProcessorResult(
        'TTML processor returned fewer AMLL lines than the parsed TTML model'
      );
    }

    lyricLines.push(
      createAppLine(rawLine, mainLine, {
        isBG: false,
        agentId: rawLine.agentId,
        songPart: rawLine.songPart,
        romanizationLanguage: options?.romanizationLanguage,
      })
    );

    if (rawLine.backgroundVocal) {
      const backgroundLine = amllResult.lyricLines[amllIndex++];
      if (!backgroundLine) {
        return invalidProcessorResult('TTML processor did not return the parsed background vocal');
      }
      lyricLines.push(
        createAppLine(rawLine.backgroundVocal, backgroundLine, {
          isBG: true,
          romanizationLanguage: options?.romanizationLanguage,
        })
      );
    }
  }

  return {
    success: true,
    data: {
      metadata: processorMetadataToApp(ttmlResult.metadata),
      lyricLines,
      agents: processorAgentsToApp(ttmlResult.metadata.agents),
      vocalTags: [],
    },
  };
}

/** 解析 TTML 文本并转换为编辑器使用的完整歌词模型。 */
export function parseTTMLLyric(
  ttmlContent: string,
  options?: Partial<TtmlToAmllOptions>
): Result<AppTTMLLyric> {
  const parsed = parseTTML(ttmlContent);
  if (!parsed.success) return parsed;
  return ttmlResultToEditorLyric(parsed.data, options);
}

function normalizeTime(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function appWordsToSyllables(words: AppLyricWord[]): Syllable[] | undefined {
  const result: Syllable[] = [];

  for (const word of words) {
    const rawText = word.word;
    if (!rawText.trim()) {
      const previous = result.at(-1);
      if (previous) previous.endsWithSpace = true;
      continue;
    }

    const hasLeadingSpace = /^\s/.test(rawText);
    const hasTrailingSpace = /\s$/.test(rawText);
    if (hasLeadingSpace) {
      const previous = result.at(-1);
      if (previous) previous.endsWithSpace = true;
    }

    const text = rawText.replace(/^\s+/, '').replace(/\s+$/, '');
    if (!text) continue;
    result.push({
      text,
      startTime: normalizeTime(word.startTime),
      endTime: normalizeTime(word.endTime),
      endsWithSpace: hasTrailingSpace || undefined,
      obscene: word.obscene || undefined,
      emptyBeat: word.emptyBeat > 0 ? word.emptyBeat : undefined,
      ruby: word.ruby?.map((ruby) => ({
        text: ruby.word,
        startTime: normalizeTime(ruby.startTime),
        endTime: normalizeTime(ruby.endTime),
      })),
    });
  }

  return result.length ? result : undefined;
}

function textMapToSubLyrics(
  values: Record<string, string> | undefined,
  fallback: string
): SubLyricContent[] | undefined {
  const result: SubLyricContent[] = Object.entries(values ?? {})
    .filter(([, text]) => text.length > 0)
    .map(([language, text]) => ({
      language: language === 'und' ? undefined : language,
      text,
    }));

  if (fallback && !result.some((item) => item.text === fallback)) {
    result.unshift({ text: fallback });
  }
  return result.length ? result : undefined;
}

function romanWordsFromEditor(line: AppLyricLine): Syllable[] | undefined {
  const words = line.words
    .filter((word) => word.romanWord.trim().length > 0)
    .map((word) => ({
      text: word.romanWord,
      startTime: normalizeTime(word.startTime),
      endTime: normalizeTime(word.endTime),
    }));
  return words.length ? words : undefined;
}

function romanizationsFromEditor(line: AppLyricLine): SubLyricContent[] | undefined {
  const liveRomanWords = romanWordsFromEditor(line);
  const liveWordLanguage = line.wordRomanizationLang ?? (liveRomanWords ? 'und' : undefined);
  const languages = new Set([
    ...Object.keys(line.romanLyricByLang ?? {}),
    ...Object.keys(line.wordRomanizationByLang ?? {}),
  ]);
  if (liveWordLanguage) languages.add(liveWordLanguage);
  if (!line.romanLyricByLang && line.romanLyric) languages.add('und');

  const result: SubLyricContent[] = [];
  for (const language of languages) {
    const storedWords = line.wordRomanizationByLang?.[language];
    const words =
      language === liveWordLanguage
        ? liveRomanWords
        : storedWords?.map((word) => ({
            text: word.text,
            startTime: normalizeTime(word.startTime),
            endTime: normalizeTime(word.endTime),
          }));
    const text =
      line.romanLyricByLang?.[language] ??
      (!line.romanLyricByLang && language === 'und' ? line.romanLyric : '');

    if (!text && !words?.length) continue;
    result.push({
      language: language === 'und' ? undefined : language,
      text,
      words,
    });
  }
  return result.length ? result : undefined;
}

function editorLineToProcessor(
  line: AppLyricLine,
  options: { blockIndex: number; agentId?: string }
): LyricLine {
  return {
    text: line.words.map((word) => word.word).join(''),
    startTime: normalizeTime(line.startTime),
    endTime: normalizeTime(line.endTime),
    words: appWordsToSyllables(line.words),
    translations: textMapToSubLyrics(line.translatedLyricByLang, line.translatedLyric),
    romanizations: romanizationsFromEditor(line),
    agentId: options.agentId,
    songPart: line.songPart,
    blockIndex: options.blockIndex,
  };
}

function editorBackgroundToProcessor(line: AppLyricLine): BackgroundVocal {
  return {
    text: line.words.map((word) => word.word).join(''),
    startTime: normalizeTime(line.startTime),
    endTime: normalizeTime(line.endTime),
    words: appWordsToSyllables(line.words),
    translations: textMapToSubLyrics(line.translatedLyricByLang, line.translatedLyric),
    romanizations: romanizationsFromEditor(line),
  };
}

/** 将编辑器模型转换为 Rust 生成器使用的完整 TTMLResult。 */
export function ttmlLyricToTTMLResult(ttmlLyric: AppTTMLLyric): TTMLResult {
  const metadata = appMetadataToProcessor(ttmlLyric.metadata);
  metadata.agents = appAgentsToProcessor(ttmlLyric.agents);
  if (!metadata.agents) {
    metadata.agents = new Map([['v1', { id: 'v1', type: 'person' }]]);
    if (ttmlLyric.lyricLines.some((line) => !line.isBG && line.isDuet)) {
      metadata.agents.set('v2', { id: 'v2', type: 'other' });
    }
  }

  const lines: LyricLine[] = [];
  let blockIndex = 0;
  let hasMainLine = false;

  for (let index = 0; index < ttmlLyric.lyricLines.length; index++) {
    const line = ttmlLyric.lyricLines[index]!;
    if (line.isBG) continue;
    if (hasMainLine && line.songPart) blockIndex += 1;
    hasMainLine = true;

    const agentId = line.agent ?? (ttmlLyric.agents.length ? undefined : line.isDuet ? 'v2' : 'v1');
    const processorLine = editorLineToProcessor(line, { blockIndex, agentId });
    processorLine.id = `L${lines.length + 1}`;
    const backgroundLine = ttmlLyric.lyricLines[index + 1];
    if (backgroundLine?.isBG) {
      processorLine.backgroundVocal = editorBackgroundToProcessor(backgroundLine);
      index += 1;
    }
    lines.push(processorLine);
  }

  return { metadata, lines };
}

/** 使用 Rust 生成器导出编辑器中的 TTML 歌词。 */
export function generateTTMLLyric(
  ttmlLyric: AppTTMLLyric,
  config?: Partial<GeneratorConfig>
): Result<string> {
  return generateTTML(ttmlLyricToTTMLResult(ttmlLyric), config);
}

/**
 * 使用 Rust 的 agent 状态机重算编辑器中所有行的对唱状态。
 * 背景行继承其前一个主行的状态。
 */
export function recalculateDuetStates(ttmlLyric: AppTTMLLyric): Result<void> {
  const agents = appAgentsToProcessor(ttmlLyric.agents);
  const mainLines = ttmlLyric.lyricLines.filter((line) => !line.isBG);
  const converted = rawTtmlResultToAmll(
    {
      metadata: { agents },
      lines: mainLines.map((line) => ({
        text: '',
        startTime: 0,
        endTime: 0,
        agentId: line.agent,
      })),
    } satisfies TTMLResult,
    undefined
  ) as Result<AmllLyricResult>;
  if (!converted.success) return converted;

  let mainIndex = 0;
  let lastMainLineIsDuet = false;
  for (const line of ttmlLyric.lyricLines) {
    if (line.isBG) {
      line.isDuet = lastMainLineIsDuet;
      continue;
    }
    line.isDuet = converted.data.lyricLines[mainIndex]?.isDuet ?? false;
    lastMainLineIsDuet = line.isDuet;
    mainIndex += 1;
  }
  return { success: true, data: undefined };
}
//#endregion

//#region AMLL 转换相关
/**
 * 便捷方法，将 TTML 字符串转换并降级为 AMLL 所使用的较简单的结构
 * @param ttmlContent 原始 TTML 文本
 * @param options 提取时的语言首选项
 * @returns Result 包含 AmllLyricResult
 */
export function ttmlToAmll(
  ttmlContent: string,
  options?: Partial<TtmlToAmllOptions>
): Result<AmllLyricResult> {
  const result = rawTtmlToAmll(ttmlContent, options) as Result<AmllLyricResult>;
  if (!result.success) return result;
  return {
    success: true,
    data: normalizeImportedAmllResult(result.data),
  };
}

/**
 * 将编辑器内部的单个歌词单词降级为 AMLL 简化结构
 *
 * 会丢弃 `id`、`romanWarning` 等编辑器专用字段
 */
function normalizeExportWord(word: AppLyricWord): AmllLyricWord {
  return {
    startTime: word.startTime,
    endTime: word.endTime,
    word: word.word,
    romanWord: word.romanWord,
    obscene: word.obscene,
    emptyBeat: word.emptyBeat,
    ruby: word.ruby,
  };
}

/**
 * 将编辑器内部的单行歌词降级为 AMLL 简化结构
 *
 * 会丢弃 `id`、`ignoreSync`、`endTimeLink` 等编辑器专用字段
 */
function normalizeExportLine(line: AppLyricLine): AmllLyricLine {
  return {
    words: line.words.map(normalizeExportWord),
    translatedLyric: line.translatedLyric,
    romanLyric: line.romanLyric,
    isBG: line.isBG,
    isDuet: line.isDuet,
    startTime: line.startTime,
    endTime: line.endTime,
  };
}

/**
 * 将编辑器内部的元数据降级为 AMLL 简化结构
 */
function normalizeExportMetadata(metadata: AppTTMLMetadata[]): AmllMetadata[] {
  return metadata.map((meta) => ({
    key: EXPORT_RENAMED_METADATA_KEYS[meta.key] ?? meta.key,
    value: [...meta.value],
  }));
}

/**
 * 将编辑器内部使用的 `TTMLLyric` 结构转换为 AMLL 所使用的较简单的结构
 * @param ttmlLyric 编辑器内部的歌词数据
 * @returns AmllLyricResult 结构
 */
export function ttmlLyricToAmllResult(ttmlLyric: AppTTMLLyric): AmllLyricResult {
  return {
    lyricLines: ttmlLyric.lyricLines.map(normalizeExportLine),
    metadata: normalizeExportMetadata(ttmlLyric.metadata),
  };
}

function postProcessLyricLines(amllResult: AmllLyricResult): AmllLyricResult {
  return {
    ...amllResult,
    lyricLines: amllResult.lyricLines.map((line) => ({
      ...line,
      startTime: Math.round(line.startTime),
      endTime: Math.round(line.endTime),
      words: line.words.map((word) => {
        const processedWord: AmllLyricWord = {
          ...word,
          startTime: Math.round(word.startTime),
          endTime: Math.round(word.endTime),
          ruby: word.ruby
            ? word.ruby.map((r) => ({
                ...r,
                startTime: Math.round(r.startTime),
                endTime: Math.round(r.endTime),
              }))
            : undefined,
        };

        if (processedWord.emptyBeat == null || processedWord.emptyBeat === 0) {
          processedWord.emptyBeat = undefined;
        }

        if (!processedWord.romanWord || processedWord.romanWord.trim() === '') {
          processedWord.romanWord = undefined;
        }

        return processedWord;
      }),
    })),
  };
}

/**
 * 便捷方法，将 AMLL 格式的歌词和元数据生成为 TTML 字符串
 *
 * 会对文本进行规范化，例如清理空格、移除背景人声括号等
 * @param amllResult AMLL 结构体数据
 * @param options 语言配置
 * @param config TTML 生成器配置
 * @returns Result 包含生成的 TTML 字符串
 */
export function amllToTTML(
  amllResult: AmllLyricResult,
  options?: Partial<AmllToTtmlOptions>,
  config?: Partial<GeneratorConfig>
): Result<string> {
  const processedAmllResult = postProcessLyricLines(amllResult);
  return rawAmllToTtml(processedAmllResult, options, config) as Result<string>;
}

/**
 * 工具方法，将复杂的 TTMLResult 结构降级为 AMLL 所使用的较简单的数据结构
 * @param ttmlResult 复杂的 TTMLResult 数据树
 * @param options 提取时的语言首选项
 * @returns Result 包含 AmllLyricResult
 */
export function ttmlResultToAmll(
  ttmlResult: TTMLResult,
  options?: Partial<TtmlToAmllOptions>
): Result<AmllLyricResult> {
  return rawTtmlResultToAmll(ttmlResult, options) as Result<AmllLyricResult>;
}

/**
 * 工具方法，将 AMLL 格式的歌词和元数据转换为 TTMLResult 结构
 *
 * 会对文本进行规范化，例如清理空格、移除背景人声括号等
 * @param amllResult AMLL 结构体数据
 * @param options 语言配置
 * @returns Result 包含 TTMLResult
 */
export function amllToTTMLResult(
  amllResult: AmllLyricResult,
  options?: Partial<AmllToTtmlOptions>
): Result<TTMLResult> {
  const processedAmllResult = postProcessLyricLines(amllResult);
  return rawAmllToTtmlResult(processedAmllResult, options) as Result<TTMLResult>;
}
//#endregion
