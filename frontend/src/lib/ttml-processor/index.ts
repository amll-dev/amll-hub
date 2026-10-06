import { initProcessor, requireProcessor } from './wasm/processor';
import {
  DEFAULT_GENERATOR_CONFIG,
  type Agent,
  type GeneratorConfig,
  type LyricLine,
  type TTMLMetadata,
  type TTMLResult,
} from './types';

export * from './types';
export { initProcessor };

/** wasm 原生返回结构（Rust 侧 serde 约定） */
export type ProcessorResult<T> =
  | { success: true; data: T; error?: undefined }
  | { success: false; data?: undefined; error: { kind: string; message: string } };

/** Rust 侧对非法输入很宽容（空行/乱码也返回 success），因此前端要自己兜一层校验 */
function makeError<T>(message: string): ProcessorResult<T> {
  return { success: false, error: { kind: 'WasmError', message } };
}

/** 把 JS 侧的异常转成统一错误结构 */
function toFailure<T>(err: unknown): ProcessorResult<T> {
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, error: { kind: 'WasmError', message } };
}

/** 结构化深拷贝：确保送进 wasm 的是纯 JSON 数据（剥离 Map/函数等） */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 清理解析结果里可能存在的 undefined / 空数组噪声 */
function normalizeLines(lines: TTMLResult['lines']): TTMLResult['lines'] {
  return lines.filter((line) => typeof line?.text === 'string');
}

/** wasm 返回的 Map 转回普通对象，才能安全 JSON 化 / 进 React state / 反序列化回 wasm */
function fromWasmMap<T>(value: unknown): Record<string, T> | undefined {
  if (value instanceof Map) {
    const result: Record<string, T> = {};
    for (const [k, v] of value) result[String(k)] = v as T;
    return Object.keys(result).length ? result : undefined;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, T>;
    return Object.keys(obj).length ? obj : undefined;
  }
  return undefined;
}

/** 把 metadata 里的 Map 字段（agents / platformIds / rawProperties）归一成普通对象 */
/** 把 metadata 里的 Map 字段（agents / platformIds / rawProperties）归一成普通对象 */
function normalizeMetadata(metadata: TTMLMetadata): TTMLMetadata {
  const out: TTMLMetadata = { ...metadata };
  const agents = fromWasmMap<Agent>(metadata.agents);
  if (agents) out.agents = agents;
  else delete out.agents;

  const platformIds = fromWasmMap<string[]>(metadata.platformIds);
  if (platformIds) out.platformIds = platformIds as TTMLMetadata['platformIds'];
  else delete out.platformIds;

  const rawProperties = fromWasmMap<string[]>(metadata.rawProperties);
  if (rawProperties) out.rawProperties = rawProperties;
  else delete out.rawProperties;

  return out;
}

function backfillAgentIds(content: string, lines: LyricLine[]): void {
  // 匹配所有带 itunes:agent-id 的 <p ...> 标签，按出现顺序对应歌词行
  const agentIds: string[] = [];
  const pattern = /itunes:agent-id\s*=\s*"([^"]*)"/g;
  let match = pattern.exec(content);
  while (match !== null) {
    agentIds.push(match[1] ?? '');
    match = pattern.exec(content);
  }
  if (!agentIds.length) return;
  lines.forEach((line, i) => {
    if (line.agentId) return;
    const fromSource = agentIds[i];
    if (fromSource) line.agentId = fromSource;
  });
}

/**
 * 解析 TTML 文本为结构化数据。
 * @param content TTML 原文
 */
export async function parseTTML(content: string): Promise<ProcessorResult<TTMLResult>> {
  if (!content.trim()) return makeError('TTML 内容为空');
  try {
    await initProcessor();
    const raw = requireProcessor().parseTtml(content) as ProcessorResult<TTMLResult>;
    if (!raw?.success) return raw?.error ? raw : makeError('TTML 解析失败');
    const lines = normalizeLines(raw.data?.lines ?? []);
    if (!lines.length) return makeError('TTML 中没有可解析的歌词行');
    backfillAgentIds(content, lines);
    const metadata = normalizeMetadata(raw.data.metadata ?? {});
    return { success: true, data: { metadata, lines } };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * 将结构化数据生成为 TTML 文本。
 * @param result 歌词数据
 * @param config 生成配置，默认为 Apple Music 风格 + 格式化
 */
export async function generateTTML(
  result: TTMLResult,
  config: GeneratorConfig = DEFAULT_GENERATOR_CONFIG
): Promise<ProcessorResult<string>> {
  if (!Array.isArray(result?.lines)) return makeError('歌词数据格式错误：lines 必须是数组');
  try {
    await initProcessor();
    const payload: TTMLResult = {
      metadata: clone(result.metadata ?? {}),
      lines: clone(result.lines),
    };
    const raw = requireProcessor().generateTtml(payload, config) as ProcessorResult<string>;
    if (!raw?.success) return raw?.error ? raw : makeError('TTML 生成失败');
    if (typeof raw.data !== 'string' || !raw.data.trim()) {
      return makeError('TTML 生成结果为空');
    }
    return { success: true, data: raw.data };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * 解析 → 原地编辑 → 生成的文档封装。
 * 编辑器里所有改动都作用在 draft 上，original 保持只读供 diff 用。
 */
export class TTMLDocument {
  private constructor(
    /** 打开时的原始数据，只读，供 diff 使用 */
    private readonly original: TTMLResult,
    /** 当前编辑态 */
    private draft: TTMLResult,
    /** 打开时的 TTML 原文 */
    readonly sourceTtml: string
  ) {}

  /** 从 TTML 文本创建文档 */
  static async create(content: string): Promise<ProcessorResult<TTMLDocument>> {
    const parsed = await parseTTML(content);
    if (!parsed.success) return parsed;
    const original = parsed.data;
    // 深拷贝一份作为草稿；原始结构中 agents 等字段已归一为普通对象，可安全 JSON 化
    return {
      success: true,
      data: new TTMLDocument(original, clone(original), content),
    };
  }

  get lines(): LyricLine[] {
    return this.draft.lines;
  }

  get metadata(): TTMLMetadata {
    return this.draft.metadata;
  }

  /** 生成当前草稿的 TTML 文本 */
  async generate(config?: GeneratorConfig): Promise<ProcessorResult<string>> {
    return generateTTML(this.draft, config);
  }

  /** 是否相对打开时的内容有改动（用于离开确认与保存按钮态） */
  get dirty(): boolean {
    return JSON.stringify(this.original) !== JSON.stringify(this.draft);
  }

  /** 放弃所有改动，回到打开时的状态 */
  revert(): void {
    const fresh = clone(this.original);
    this.draft.metadata = fresh.metadata;
    this.draft.lines = fresh.lines;
  }
}
