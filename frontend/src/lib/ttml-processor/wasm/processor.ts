import * as bg from './ttml_processor_wasm_bg.js';
import wasmUrl from './ttml_processor_wasm_bg.wasm?url';

/** bg.js 暴露的高层处理器 API */
export type ProcessorApi = typeof bg;

/** wasm 裸导出中本胶水层实际使用的部分 */
interface RawExports {
  __wbindgen_start: () => void;
}

/**
 * 命名空间对象本身是冻结的，不能直接当 wasm import 对象用；
 * wasm 运行时只按 key 读取，这里摊平成普通对象。
 */
const bgImports = { ...bg } as unknown as WebAssembly.ModuleImports;

/** 已初始化的处理器；未初始化为 null（供同步读取） */
let cached: ProcessorApi | null = null;
let pending: Promise<ProcessorApi> | null = null;

/**
 * 初始化处理器。并发调用只会真正实例化一次；
 * 失败后清空缓存，允许下次重试。
 */
export function initProcessor(): Promise<ProcessorApi> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;

  pending = (async () => {
    const res = await fetch(wasmUrl);
    if (!res.ok) throw new Error(`加载 TTML 处理器失败: HTTP ${res.status}`);
    const bytes = await res.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {
      './ttml_processor_wasm_bg.js': bgImports,
    });
    const exps = instance.exports as unknown as RawExports;
    // wasm-bindgen glue 通过该函数拿到 exports 实例，之后高层 API 才能用
    bg.__wbg_set_wasm(exps);
    exps.__wbindgen_start();
    cached = bg;
    return bg;
  })().catch((err) => {
    pending = null;
    throw err;
  });

  return pending;
}

/** 同步读取已初始化的处理器；未初始化返回 null */
export function getProcessor(): ProcessorApi | null {
  return cached;
}

/** 取处理器，未初始化则抛错。调用方需先 await initProcessor() */
export function requireProcessor(): ProcessorApi {
  if (!cached) throw new Error('TTML 处理器尚未初始化，请先 await initProcessor()');
  return cached;
}
