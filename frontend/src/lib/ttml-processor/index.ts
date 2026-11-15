/**
 * 应用侧 TTML 处理入口。
 *
 * 实际实现只有一套：`editor/modules/ttml-processor`（vite-plugin-wasm 同步加载）。
 * 本文件保留异步签名与 Record 化的 metadata，只是为了不惊动既有调用点：
 *
 * - `parseTTML` / `generateTTML` 是 async（调用方已经 await，改成同步会是
 *   大面积改动，且导入路径上原来就是动态 import）
 * - metadata 的 Map 字段（agents / platformIds / rawProperties）在这里统一
 *   转成普通对象，才能安全 JSON 化、进 React state、做深比较
 *
 * 不要再在这里引入第二份 wasm 胶水：两套同名导出、不同返回类型，
 * 任何人 import 错地方都要调试半天（本目录原来的 `wasm/` 就是这么来的）。
 */
import {
  generateTTML as generateTTMLSync,
  parseTTML as parseTTMLSync,
} from '@/editor/modules/ttml-processor';
import {
  DEFAULT_GENERATOR_CONFIG,
  type Agent,
  type GeneratorConfig,
  type LyricLine,
  type TTMLMetadata,
  type TTMLResult,
} from './types';

export * from './types';

/** wasm 已随 editor 模块同步加载，保留空实现仅为兼容既有 `await initProcessor()` */
export async function initProcessor(): Promise<void> {
  // no-op
}

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
    const raw = parseTTMLSync(content) as ProcessorResult<TTMLResult>;
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
    // metadata 的 Map 字段在我们这层是普通对象，送进 wasm 前要还原成 Map
    const payload = {
      metadata: {
        ...clone(result.metadata ?? {}),
        agents: result.metadata?.agents
          ? new Map(Object.entries(result.metadata.agents))
          : undefined,
        platformIds: result.metadata?.platformIds
          ? new Map(Object.entries(result.metadata.platformIds))
          : undefined,
        rawProperties: result.metadata?.rawProperties
          ? new Map(Object.entries(result.metadata.rawProperties))
          : undefined,
      },
      lines: clone(result.lines),
    };
    const raw = generateTTMLSync(payload as never, config) as ProcessorResult<string>;
    if (!raw?.success) return raw?.error ? raw : makeError('TTML 生成失败');
    if (typeof raw.data !== 'string' || !raw.data.trim()) {
      return makeError('TTML 生成结果为空');
    }
    return { success: true, data: raw.data };
  } catch (err) {
    return toFailure(err);
  }
}
